/**
 * Downloads screen — /downloads (Phase 6 v1, flag-gated).
 *
 * Library ke "Downloads" row se khulti hai (`downloads_enabled` flag on ho to;
 * off ho to library row hi nahi dikhta). List: downloaded/queued/failed songs,
 * per-item play/delete/retry, header me total storage. Play seedha player me
 * (playerStore.resolveTrack downloads ko first check karta hai — offline bhi).
 */
import { useEffect } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Song } from '../types';
import { useDownloads, getTotalBytes } from '../services/downloadsService';
import { usePlayer } from '../stores/playerStore';
import { useLikedSongs } from '../stores/likedSongsStore';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { tapFeedback, successFeedback, warningFeedback } from '../utils/haptics';
import { formatDuration } from '../utils/format';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const insets = useSafeAreaInsets();
  const items = useDownloads(s => s.items);
  const hydrated = useDownloads(s => s.hydrated);
  const hydrate = useDownloads(s => s.hydrate);
  const remove = useDownloads(s => s.remove);
  const retry = useDownloads(s => s.retry);
  const clearAll = useDownloads(s => s.clearAll);
  const playSong = usePlayer(s => s.playSong);
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const playable = items.filter(item => item.status === 'downloaded');

  const handlePlay = (song: Song) => {
    tapFeedback();
    void playSong(song, playable.map(entry => entry.song));
  };

  const handleRemove = (songId: string, title: string) => {
    Alert.alert('Download hatao?', `"${title}" device se delete ho jayega.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(songId) },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert('Sab downloads hatao?', 'Saari downloaded files delete ho jayengi.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sab delete', style: 'destructive', onPress: () => void clearAll() },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Wapas jao"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Downloads</Text>
        <Pressable
          onPress={handleClearAll}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Sab downloads delete karo"
          disabled={items.length === 0}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons
            name="trash-outline"
            size={20}
            color={items.length > 0 ? colors.text : colors.subtext}
          />
        </Pressable>
      </View>

      <Text style={styles.storageInfo}>
        {playable.length} songs • {formatBytes(getTotalBytes(items))} storage • offline chalte hain
      </Text>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              onPress={() => item.status === 'downloaded' && handlePlay(item.song)}
              style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={
                item.status === 'downloaded' ? `${item.song.title} bajao` : item.song.title
              }
              disabled={item.status !== 'downloaded'}
            >
              <Image source={{ uri: item.song.cover }} style={styles.rowArt} />
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.song.title}</Text>
                <Text style={styles.rowArtist} numberOfLines={1}>{item.song.artist}</Text>
                <Text style={styles.rowStatus}>
                  {item.status === 'downloaded'
                    ? `${formatDuration(item.song.duration)} • offline ready`
                    : item.status === 'downloading'
                      ? `Downloading… ${item.progress}%`
                      : item.status === 'queued'
                        ? 'Queue me hai'
                        : `Fail: ${item.error ?? 'unknown'}`}
                </Text>
              </View>
              {item.status === 'failed' ? (
                <Pressable
                  onPress={() => {
                    warningFeedback();
                    void retry(item.id);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dobara try karo"
                  style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
                >
                  <Ionicons name="refresh" size={20} color={colors.warning} />
                </Pressable>
              ) : item.status === 'downloaded' ? (
                <Pressable
                  onPress={() => {
                    successFeedback();
                    void toggleLiked(item.song);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Like toggle"
                  style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={likedSongs.some(song => song.id === item.id) ? 'heart' : 'heart-outline'}
                    size={20}
                    color={likedSongs.some(song => song.id === item.id) ? colors.primary : colors.text}
                  />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => handleRemove(item.id, item.song.title)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Download delete karo"
                style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={20} color={colors.subtext} />
              </Pressable>
            </Pressable>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: contentPadding, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="cloud-download-outline"
            title={hydrated ? 'Koi download nahi' : 'Downloads load ho rahe hain…'}
            subtitle={
              hydrated
                ? 'Player me Download button dabao — gaana offline bajega'
                : undefined
            }
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1, textAlign: 'center' },
  pressed: { opacity: 0.7 },
  storageInfo: {
    ...typography.caption,
    color: colors.subtext,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  rowArt: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surface },
  rowMeta: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowArtist: { ...typography.caption, color: colors.subtext },
  rowStatus: { ...typography.caption, fontSize: 11, color: colors.subtext, marginTop: 2 },
  rowAction: { padding: spacing.xs },
});
