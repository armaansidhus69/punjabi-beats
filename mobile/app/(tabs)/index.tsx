/**
 * Home tab — 8 mood cards + trending Punjabi songs (Phase 3).
 * FR-3.1..FR-3.4 (moods), trending launch pe auto-fetch hota hai.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mood, Song } from '../../types';
import { MOODS } from '../../constants/moods';
import { getTrendingSongs } from '../../services/musicApi';
import { usePlayer } from '../../stores/playerStore';
import { promptAddSong } from '../../utils/songActions';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import MoodCard from '../../components/MoodCard';
import SongItem from '../../components/SongItem';

const TRENDING_LIMIT = 20;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  // SongItem ke '+' se shared prompt — room me ho to "Add to Room Queue"
  // option, warna seedha add-to-playlist sheet (Phase 9)
  const handleAddPress = promptAddSong;
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const loadTrending = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const trending = await getTrendingSongs(TRENDING_LIMIT);
      setSongs(trending);
      // Service API fail pe [] deti hai — user ko batao
      if (trending.length === 0) setError('Trending songs nahi mile');
    } catch (err) {
      console.warn('Trending load failed:', err);
      setError('Trending load nahi ho paya');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTrending();
  }, [loadTrending]);

  const handleSongPress = useCallback(
    (song: Song) => {
      // Poori trending list queue ban jaati hai (auto-next ke liye)
      void playSong(song, songs);
    },
    [playSong, songs],
  );

  const handleMoodPress = useCallback((mood: Mood) => {
    router.push(`/mood/${mood.id}`);
  }, []);

  const listHeader = (
    <View>
      <View style={styles.greetingRow}>
        <View style={styles.greetingTexts}>
          <Text style={styles.greeting}>Punjabi Beats 🎵</Text>
          <Text style={styles.tagline}>Dil se Punjabi — har mood ke liye</Text>
        </View>
        {/* Phase 14 — Recently played screen ka entry (last 20 history) */}
        <Pressable
          onPress={() => router.push('/recent')}
          accessibilityRole="button"
          accessibilityLabel="Recently played khole"
          hitSlop={12}
          style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
        >
          <Ionicons name="time-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Moods</Text>
      <View style={styles.moodGrid}>
        {MOODS.map(mood => (
          <View key={mood.id} style={styles.moodCell}>
            <MoodCard mood={mood} onPress={handleMoodPress} />
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Trending Now 🔥</Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={handleSongPress}
            isActive={item.id === currentSongId}
            onAddPress={handleAddPress}
          />
        )}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: contentPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void loadTrending(true);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.card}
          />
        }
        ListEmptyComponent={
          loading ? (
            <LoadingSpinner label="Punjabi hits load ho rahe hain…" />
          ) : error ? (
            <EmptyState icon="cloud-offline-outline" title="Songs load nahi ho paye" subtitle={error}>
              <Pressable
                onPress={() => {
                  void loadTrending();
                }}
                accessibilityRole="button"
                accessibilityLabel="Dobara load karo"
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            </EmptyState>
          ) : (
            <EmptyState
              icon="musical-notes-outline"
              title="Abhi koi song nahi"
              subtitle="Upar wale mood card se shuru karo"
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  greetingTexts: { flex: 1 },
  historyButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  greeting: {
    ...typography.h1,
    color: colors.text,
  },
  tagline: {
    ...typography.body,
    color: colors.subtext,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  moodCell: { flexBasis: '47%', flexGrow: 1 },
  retryButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

