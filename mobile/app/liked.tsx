/**
 * Liked Songs — locally saved favourites.
 * Songs are persisted by likedSongsStore and played through the shared player.
 */
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../types';
import { useLikedSongs } from '../stores/likedSongsStore';
import { usePlayer } from '../stores/playerStore';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { successFeedback, warningFeedback } from '../utils/haptics';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import SongItem from '../components/SongItem';

function shuffleSongs(songs: Song[]): Song[] {
  const shuffled = [...songs];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

export default function LikedSongsScreen() {
  const insets = useSafeAreaInsets();
  const songs = useLikedSongs(s => s.songs);
  const loaded = useLikedSongs(s => s.loaded);
  const load = useLikedSongs(s => s.load);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleSongPress = useCallback(
    (song: Song) => {
      void playSong(song, songs);
    },
    [playSong, songs],
  );

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    void playSong(songs[0], songs);
  }, [playSong, songs]);

  const handleShuffle = useCallback(() => {
    const shuffled = shuffleSongs(songs);
    if (shuffled.length === 0) return;
    void playSong(shuffled[0], shuffled);
  }, [playSong, songs]);

  const handleToggleLiked = useCallback(
    (song: Song) => {
      const liked = toggleLiked(song);
      if (liked) successFeedback();
      else warningFeedback();
    },
    [toggleLiked],
  );

  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
    >
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
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Liked Songs</Text>
          <Text style={styles.subtitle}>
            {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          </Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="heart" size={22} color={colors.primary} />
        </View>
      </View>

      {songs.length > 0 ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handlePlayAll}
            accessibilityRole="button"
            accessibilityLabel="Liked songs play karo"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Ionicons name="play" size={18} color={colors.background} />
            <Text style={styles.primaryButtonText}>Play All</Text>
          </Pressable>
          <Pressable
            onPress={handleShuffle}
            accessibilityRole="button"
            accessibilityLabel="Liked songs shuffle karo"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Ionicons name="shuffle" size={18} color={colors.text} />
            <Text style={styles.secondaryButtonText}>Shuffle</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={handleSongPress}
            isActive={item.id === currentSongId}
            isLiked
            onLikePress={handleToggleLiked}
          />
        )}
        contentContainerStyle={[{ paddingBottom: contentPadding }, styles.listContent]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loaded ? (
            <EmptyState
              icon="heart-outline"
              title="Abhi koi liked song nahi"
              subtitle="Kisi song ke heart button par tap karke yahan save karo"
            />
          ) : (
            <LoadingSpinner label="Liked songs load ho rahe hain…" />
          )
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerInfo: { flex: 1 },
  headerIcon: { padding: spacing.xs },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { ...typography.body, color: colors.background, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  listContent: { flexGrow: 1 },
  pressed: { opacity: 0.7 },
});
