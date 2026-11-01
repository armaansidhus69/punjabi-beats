/**
 * Home tab — 8 mood cards + trending Punjabi songs (Phase 3).
 * FR-3.1..FR-3.4 (moods), trending launch pe auto-fetch hota hai.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mood, Song } from '../../types';
import { MOODS } from '../../constants/moods';
import { POPULAR_ARTISTS } from '../../constants/artists';
import { getTrendingSongs } from '../../services/musicApi';
import { usePlayer } from '../../stores/playerStore';
import { useLikedSongs } from '../../stores/likedSongsStore';
import { promptAddSong } from '../../utils/songActions';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { tapFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { useAuthStore } from '../../stores/authStore';
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
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const authStatus = useAuthStore(s => s.status);
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

  const handleAccountPress = useCallback(() => {
    router.push(authStatus === 'authenticated' ? '/auth/profile' : '/auth/login');
  }, [authStatus]);

  const listHeader = (
    <View>
      <View style={styles.greetingRow}>
        <View style={styles.greetingTexts}>
          <Text style={styles.greeting}>Punjabi Beats 🎵</Text>
          <Text style={styles.tagline}>Dil se Punjabi — har mood ke liye</Text>
        </View>
        {/* Phase 14 — Recently played screen ka entry (last 20 history) */}
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/recent')}
            accessibilityRole="button"
            accessibilityLabel="Recently played khole"
            hitSlop={12}
            style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
          >
            <Ionicons name="time-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={handleAccountPress}
            accessibilityRole="button"
            accessibilityLabel="Account khole"
            hitSlop={12}
            style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
          >
            <Ionicons
              name={authStatus === 'authenticated' ? 'person' : 'person-outline'}
              size={22}
              color={authStatus === 'authenticated' ? colors.primary : colors.text}
            />
          </Pressable>
        </View>
      </View>

      {/* Hero Mehfil Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroKicker}>🥁 A Mehfil In Your Pocket</Text>
          <Text style={styles.heroTitle}>The room is already playing.</Text>
          <Text style={styles.heroLede}>
            Punjabi hits by mood, 320kbps streams, and live rooms for friends across cities.
          </Text>
          <View style={styles.heroActions}>
            <Pressable
              onPress={() => {
                if (songs.length > 0) {
                  tapFeedback();
                  void playSong(songs[0], songs);
                }
              }}
              disabled={songs.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Play trending songs"
              style={({ pressed }) => [
                styles.heroPlayBtn,
                pressed && styles.pressed,
                songs.length === 0 && styles.disabled,
              ]}
            >
              <Ionicons name="play" size={16} color="#07070c" />
              <Text style={styles.heroPlayText}>Play trending</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tapFeedback();
                router.push('/(tabs)/room');
              }}
              accessibilityRole="button"
              accessibilityLabel="Open a group room"
              style={({ pressed }) => [styles.heroRoomBtn, pressed && styles.pressed]}
            >
              <Ionicons name="radio-outline" size={16} color={colors.text} />
              <Text style={styles.heroRoomText}>Open a room</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Popular Artists Carousel */}
      <Text style={styles.sectionTitle}>Popular Artists 🎤</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.artistsScroll}
      >
        {POPULAR_ARTISTS.map(artist => (
          <Pressable
            key={artist.id}
            onPress={() => {
              tapFeedback();
              router.push(`/artist/${encodeURIComponent(artist.name)}`);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${artist.name} artist profile`}
            style={({ pressed }) => [styles.artistCard, pressed && styles.pressed]}
          >
            <View style={styles.avatarWrapper}>
              <Image source={{ uri: artist.image }} style={styles.avatarImage} />
              <View style={styles.verifiedDot}>
                <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              </View>
            </View>
            <Text style={styles.artistCardName} numberOfLines={1}>
              {artist.name}
            </Text>
            <Text style={styles.artistCardGenre} numberOfLines={1}>
              {artist.genre ? artist.genre.split('·')[0].trim() : 'Punjabi'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
            isLiked={likedSongs.some(song => song.id === item.id)}
            onLikePress={toggleLiked}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  heroCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: 20,
    backgroundColor: '#141420',
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 71, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  heroCopy: {
    gap: spacing.xs + 2,
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  heroTitle: {
    ...typography.h2,
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  heroLede: {
    ...typography.caption,
    color: colors.subtext,
    lineHeight: 18,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
  },
  heroPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  heroPlayText: {
    ...typography.caption,
    fontWeight: '700',
    color: '#07070c',
  },
  heroRoomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroRoomText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
  disabled: {
    opacity: 0.4,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  artistsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  artistCard: {
    alignItems: 'center',
    width: 82,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: spacing.xs,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'rgba(255, 179, 71, 0.45)',
  },
  verifiedDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.background,
    borderRadius: 10,
  },
  artistCardName: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  artistCardGenre: {
    fontSize: 10,
    color: colors.subtext,
    textAlign: 'center',
    width: '100%',
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
