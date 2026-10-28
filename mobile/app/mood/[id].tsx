/**
 * Mood screen — /mood/[id] (Phase 4).
 * Mood id se query leke iTunes IN store se songs laata hai (FR-3.2, FR-3.4).
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../../types';
import { getMoodById } from '../../constants/moods';
import { getSongsByMood } from '../../services/musicApi';
import { usePlayer } from '../../stores/playerStore';
import { useLikedSongs } from '../../stores/likedSongsStore';
import { promptAddSong } from '../../utils/songActions';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import SongItem from '../../components/SongItem';

const MOOD_LIMIT = 30;

export default function MoodScreen() {
  const insets = useSafeAreaInsets();
  // Route param kabhi bhi galat ho sakta hai (deep link) — defensively handle
  const params = useLocalSearchParams<{ id?: string }>();
  const moodId = typeof params.id === 'string' ? params.id : '';
  const mood = getMoodById(moodId);

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  // SongItem ke '+' se shared prompt — room me ho to "Add to Room Queue"
  // option, warna seedha add-to-playlist sheet (Phase 9)
  const handleAddPress = promptAddSong;
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const loadSongs = useCallback(
    async (isRefresh = false) => {
      if (!mood) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const list = await getSongsByMood(mood, MOOD_LIMIT);
        setSongs(list);
        if (list.length === 0) setError('Is mood ke songs nahi mile');
      } catch (err) {
        console.warn('Mood songs load failed:', err);
        setError('Songs load nahi ho paye');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [mood],
  );

  useEffect(() => {
    void loadSongs();
  }, [loadSongs]);

  const handleSongPress = useCallback(
    (song: Song) => {
      void playSong(song, songs);
    },
    [playSong, songs],
  );

  // Invalid/missing mood id — crash ki jagah friendly screen
  if (!mood) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <BackHeader title="Mood" color={colors.primary} />
        <EmptyState icon="help-circle-outline" title="Ye mood nahi mila" subtitle={`"${moodId}" valid mood id nahi hai`} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackHeader title={`${mood.emoji}  ${mood.title}`} color={mood.color ?? colors.primary} />
      <Text style={styles.subtitle}>{mood.query} • {songs.length} songs</Text>

      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={handleSongPress}
            isActive={item.id === currentSongId}
            onAddPress={handleAddPress}
            isLiked={likedSongs.some(song => song.id === item.id)}
            onLikePress={toggleLiked}
          />
        )}
        contentContainerStyle={{ paddingBottom: contentPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void loadSongs(true);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.card}
          />
        }
        ListEmptyComponent={
          loading ? (
            <LoadingSpinner label="Songs load ho rahe hain…" />
          ) : error ? (
            <EmptyState icon="cloud-offline-outline" title="Songs load nahi ho paye" subtitle={error}>
              <Pressable
                onPress={() => {
                  void loadSongs();
                }}
                accessibilityRole="button"
                accessibilityLabel="Dobara load karo"
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            </EmptyState>
          ) : (
            <EmptyState icon="musical-notes-outline" title="Koi song nahi mila" />
          )
        }
      />
    </View>
  );
}

/** Simple back header (root layout me headerShown: false hai) */
function BackHeader({ title, color }: { title: string; color: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Wapas jao"
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <View style={[styles.headerAccent, { backgroundColor: color }]} />
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
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
  backButton: { padding: spacing.xs },
  headerAccent: { width: 4, height: 22, borderRadius: 2 },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1 },
  subtitle: {
    ...typography.caption,
    color: colors.subtext,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'capitalize',
  },
  retryButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
