/**
 * Queue screen — /queue (Phase 5 completion: dedicated queue management).
 *
 * Player ke "Queue me N songs" link se khulti hai. Current track upar, uske
 * baad upcoming list: tap = jump, arrows = reorder, X = remove, top-right
 * broom = clear all. Neeche "Save as playlist" — playlistStore ke existing
 * create/dedupe path reuse (naya ledger nahi).
 */
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Song } from '../types';
import { usePlayer } from '../stores/playerStore';
import { usePlaylists } from '../stores/playlistStore';
import { validatePlaylistName } from '../utils/playlistValidation';
import { formatDuration } from '../utils/format';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { tapFeedback } from '../utils/haptics';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';

export default function QueueScreen() {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');

  const queue = usePlayer(s => s.queue);
  const index = usePlayer(s => s.index);
  const currentSong = usePlayer(s => s.currentSong);
  const isPlaying = usePlayer(s => s.isPlaying);
  const playSong = usePlayer(s => s.playSong);
  const removeFromQueue = usePlayer(s => s.removeFromQueue);
  const moveInQueue = usePlayer(s => s.moveInQueue);
  const clearUpcoming = usePlayer(s => s.clearUpcoming);

  const playlists = usePlaylists(s => s.playlists);
  const createPlaylist = usePlaylists(s => s.createPlaylist);
  const addSongToPlaylist = usePlaylists(s => s.addSongToPlaylist);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const upcoming = queue.slice(index + 1);

  const handleClear = useCallback(() => {
    Alert.alert('Queue clear karo?', 'Current ke baad ke saare songs hat jayenge.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clearUpcoming() },
    ]);
  }, [clearUpcoming]);

  const handleSave = useCallback(() => {
    const name = draft.trim();
    const existingNames = playlists.map(playlist => playlist.name);
    const error = validatePlaylistName(name, existingNames);
    if (error) {
      Alert.alert('Playlist', error);
      return;
    }
    const playlist = createPlaylist(name);
    const songsToSave = [currentSong, ...upcoming].filter((song): song is Song => Boolean(song));
    void (async () => {
      for (const song of songsToSave) {
        await addSongToPlaylist(playlist.id, song);
      }
    })();
    setDraft('');
    Alert.alert('Save ho gaya ✅', `"${name}" me ${songsToSave.length} songs add ho gaye.`);
  }, [draft, playlists, createPlaylist, addSongToPlaylist, currentSong, upcoming]);

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
        <Text style={styles.headerTitle}>Queue</Text>
        <Pressable
          onPress={handleClear}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Aage ke saare songs clear karo"
          disabled={upcoming.length === 0}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons
            name="trash-outline"
            size={20}
            color={upcoming.length > 0 ? colors.text : colors.subtext}
          />
        </Pressable>
      </View>

      {currentSong ? (
        <View style={styles.nowPlaying}>
          <Image source={{ uri: currentSong.cover }} style={styles.nowArt} />
          <View style={styles.nowMeta}>
            <Text style={styles.nowLabel}>{isPlaying ? 'Ab baj raha hai' : 'Paused'}</Text>
            <Text style={styles.nowTitle} numberOfLines={1}>{currentSong.title}</Text>
            <Text style={styles.nowArtist} numberOfLines={1}>{currentSong.artist}</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>
        {upcoming.length > 0 ? `Aage kya hai (${upcoming.length})` : 'Aage kya hai'}
      </Text>

      <FlatList
        data={upcoming}
        keyExtractor={song => song.id}
        renderItem={({ item, index: listIndex }) => (
          <View style={styles.row}>
            <Pressable
              onPress={() => void playSong(item, queue)}
              style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title} bajao`}
            >
              <Image source={{ uri: item.cover }} style={styles.rowArt} />
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowArtist} numberOfLines={1}>{item.artist}</Text>
              </View>
              <Text style={styles.rowDuration}>{formatDuration(item.duration)}</Text>
            </Pressable>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => {
                  tapFeedback();
                  void moveInQueue(item.id, 'up');
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Upar move karo"
                disabled={listIndex === 0}
              >
                <Ionicons
                  name="chevron-up"
                  size={18}
                  color={listIndex === 0 ? colors.subtext : colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  tapFeedback();
                  void moveInQueue(item.id, 'down');
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Neeche move karo"
                disabled={listIndex === upcoming.length - 1}
              >
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={listIndex === upcoming.length - 1 ? colors.subtext : colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  tapFeedback();
                  void removeFromQueue(item.id);
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Queue se hatao"
              >
                <Ionicons name="close" size={18} color={colors.subtext} />
              </Pressable>
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: contentPadding, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="list-outline"
            title="Queue khaali hai"
            subtitle="Player me '+' se ya song ke menu se queue me add karo"
          />
        }
      />

      <View style={[styles.saveBar, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Playlist ka naam…"
          placeholderTextColor={colors.subtext}
          style={styles.saveInput}
          maxLength={40}
        />
        <Pressable
          onPress={handleSave}
          disabled={!currentSong}
          accessibilityRole="button"
          accessibilityLabel="Queue ko playlist me save karo"
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.pressed,
            !currentSong && styles.saveDisabled,
          ]}
        >
          <Ionicons name="save-outline" size={16} color={colors.background} />
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>
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
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1, textAlign: 'center' },
  pressed: { opacity: 0.7 },
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  nowArt: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.surface },
  nowMeta: { flex: 1 },
  nowLabel: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  nowTitle: { ...typography.body, color: colors.text, fontWeight: '700', marginTop: 2 },
  nowArtist: { ...typography.caption, color: colors.subtext },
  sectionTitle: {
    ...typography.caption,
    color: colors.subtext,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  rowArt: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surface },
  rowMeta: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowArtist: { ...typography.caption, color: colors.subtext },
  rowDuration: { ...typography.caption, color: colors.subtext, marginRight: spacing.xs },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surface,
  },
  saveInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { ...typography.body, color: colors.background, fontWeight: '700' },
});
