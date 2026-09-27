/**
 * Playlist detail — /playlist/[id] (Phase 9).
 * Songs list + Play All + remove song + delete playlist (confirm ke saath).
 * Songs add karne ke liye Home/Mood ke SongItem ka '+' button (global sheet).
 */
import { useCallback, useEffect } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Song } from '../../types';
import { usePlaylists } from '../../stores/playlistStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, warningFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import SongItem from '../../components/SongItem';

/** "12 Mar 2026" jaisa chhota date label */
function formatCreatedAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function PlaylistDetailScreen() {
  const insets = useSafeAreaInsets();
  // Route param deep link se galat bhi aa sakta hai — defensively handle
  const params = useLocalSearchParams<{ id?: string }>();
  const playlistId = typeof params.id === 'string' ? params.id : '';

  const playlists = usePlaylists(s => s.playlists);
  const loaded = usePlaylists(s => s.loaded);
  const load = usePlaylists(s => s.load);
  const deletePlaylist = usePlaylists(s => s.deletePlaylist);
  const removeSongFromPlaylist = usePlaylists(s => s.removeSongFromPlaylist);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  // Cold start pe playlists memory me nahi hote — AsyncStorage se laao (FR-4.6)
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const playlist = playlists.find(p => p.id === playlistId);

  const handlePlayAll = useCallback(() => {
    if (!playlist || playlist.songs.length === 0) return;
    // Poori playlist queue ban jaati hai (auto-next FR-2.6 ke liye)
    void playSong(playlist.songs[0], playlist.songs);
  }, [playSong, playlist]);

  const handleSongPress = useCallback(
    (song: Song) => {
      if (!playlist) return;
      void playSong(song, playlist.songs);
    },
    [playSong, playlist],
  );

  const handleRemove = useCallback(
    (song: Song) => {
      removeSongFromPlaylist(playlistId, song.id);
      successFeedback();
    },
    [removeSongFromPlaylist, playlistId],
  );

  /* Share playlist (Phase 14 — React Native Share API) */
  const handleShare = useCallback(() => {
    if (!playlist) return;
    const lines = playlist.songs.slice(0, 10).map(s => `• ${s.title} — ${s.artist}`);
    const more = playlist.songs.length > 10 ? `\n… aur ${playlist.songs.length - 10} songs` : '';
    const message =
      `Punjabi Beats playlist "${playlist.name}" (${playlist.songs.length} songs):\n` +
      `${lines.join('\n')}${more}`;
    Share.share({ message }).catch(err => console.warn('Share failed:', err));
  }, [playlist]);

  const confirmDelete = useCallback(() => {
    if (!playlist) return;
    Alert.alert(
      'Playlist delete karo?',
      `"${playlist.name}" aur uske ${playlist.songs.length} songs hamesha ke liye hat jaayenge.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deletePlaylist(playlistId);
            warningFeedback();
            Toast.show({ type: 'success', text1: 'Playlist delete ho gayi', text2: playlist.name });
            router.back();
          },
        },
      ],
    );
  }, [deletePlaylist, playlist, playlistId]);

  // Playlist na mili (ya async load pending) — crash ki jagah friendly screen
  if (!playlist) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <BackHeader title="Playlist" onDelete={null} />
        {loaded ? (
          <EmptyState
            icon="help-circle-outline"
            title="Playlist nahi mili"
            subtitle={`"${playlistId}" valid playlist id nahi hai`}
          />
        ) : (
          <LoadingSpinner label="Playlist load ho rahi hai…" />
        )}
      </View>
    );
  }

  const isEmpty = playlist.songs.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackHeader title={playlist.name} onDelete={confirmDelete} onShare={handleShare} />
      <Text style={styles.subtitle}>
        {playlist.songs.length} songs • {formatCreatedAt(playlist.createdAt)}
      </Text>

      {isEmpty ? null : (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handlePlayAll}
            accessibilityRole="button"
            accessibilityLabel="Poori playlist play karo"
            style={({ pressed }) => [styles.playAllButton, pressed && styles.pressed]}
          >
            <Ionicons name="play" size={18} color={colors.background} />
            <Text style={styles.playAllText}>Play All</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={playlist.songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={handleSongPress}
            isActive={item.id === currentSongId}
            onRemovePress={handleRemove}
          />
        )}
        contentContainerStyle={{ paddingBottom: contentPadding }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="musical-notes-outline"
            title="Playlist khaali hai"
            subtitle="Home ya Search se songs ke '+' button se add karo"
          />
        }
      />
    </View>
  );
}

/** Back header + optional share/delete actions (root layout me headerShown: false hai) */
function BackHeader({
  title,
  onDelete,
  onShare,
}: {
  title: string;
  onDelete: (() => void) | null;
  onShare?: () => void;
}) {
  return (
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
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {onShare ? (
        <Pressable
          onPress={onShare}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Playlist share karo"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="share-outline" size={22} color={colors.subtext} />
        </Pressable>
      ) : null}
      {onDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Playlist delete karo"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={22} color={colors.subtext} />
        </Pressable>
      ) : onShare ? null : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1 },
  headerSpacer: { width: 30 },
  subtitle: {
    ...typography.caption,
    color: colors.subtext,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  actionsRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  playAllText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
