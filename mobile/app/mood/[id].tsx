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
import { tapFeedback } from '../../utils/haptics';
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

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    tapFeedback();
    void playSong(songs[0], songs);
  }, [playSong, songs]);

  const handleShuffle = useCallback(() => {
    if (songs.length === 0) return;
    tapFeedback();
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    void playSong(shuffled[0], shuffled);
  }, [playSong, songs]);

  // Invalid/missing mood id — crash ki jagah friendly screen
  if (!mood) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <BackHeader title="Mood" color={colors.primary} />
        <EmptyState icon="help-circle-outline" title="Ye mood nahi mila" subtitle={`"${moodId}" valid mood id nahi hai`} />
      </View>
    );
  }

  const moodColor = mood.color ?? colors.primary;

  const listHeader = (
    <View style={styles.headerBlock}>
      {mood.punjabi || mood.note ? (
        <View style={styles.kickerRow}>
          {mood.punjabi ? (
            <View style={[styles.punjabiPill, { borderColor: `${moodColor}50` }]}>
              <Text style={[styles.punjabiPillText, { color: moodColor }]}>{mood.punjabi}</Text>
            </View>
          ) : null}
          {mood.note ? (
            <Text style={styles.noteText} numberOfLines={1}>
              {mood.note}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          onPress={handlePlayAll}
          disabled={songs.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Play all songs in this mood"
          style={({ pressed }) => [
            styles.playBtn,
            { backgroundColor: moodColor },
            pressed && styles.pressed,
            songs.length === 0 && styles.disabled,
          ]}
        >
          <Ionicons name="play" size={18} color="#07070c" />
          <Text style={styles.playBtnText}>Play mood</Text>
        </Pressable>

        <Pressable
          onPress={handleShuffle}
          disabled={songs.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Shuffle songs in this mood"
          style={({ pressed }) => [
            styles.shuffleBtn,
            pressed && styles.pressed,
            songs.length === 0 && styles.disabled,
          ]}
        >
          <Ionicons name="shuffle" size={18} color={colors.text} />
          <Text style={styles.shuffleBtnText}>Shuffle</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>
        {mood.query} • {songs.length} songs
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackHeader title={`${mood.emoji}  ${mood.title}`} color={moodColor} />

      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        ListHeaderComponent={listHeader}
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
  headerBlock: {
    paddingBottom: spacing.xs,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  punjabiPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
  },
  punjabiPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  noteText: {
    ...typography.caption,
    color: colors.subtext,
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    borderRadius: 999,
  },
  playBtnText: {
    ...typography.body,
    fontWeight: '700',
    color: '#07070c',
  },
  shuffleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#1b1b29',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  shuffleBtnText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  disabled: {
    opacity: 0.4,
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
