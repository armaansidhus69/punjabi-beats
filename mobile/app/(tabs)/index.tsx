/**
 * Home tab — 8 mood cards + New Songs + Trending (Phase 3).
 * FR-3.1..FR-3.4 (moods), feed launch pe auto-fetch hota hai.
 * New Songs section "all new song" requirement — getNewSongs latest releases
 * laata hai (JioSaavn <year> queries → YouTube Music → Audius trending week).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Mood, Song } from '../../types';
import { MOODS } from '../../constants/moods';
import { POPULAR_ARTISTS } from '../../constants/artists';
import { getNewSongs, getTrendingSongs } from '../../services/musicApi';
import { getMadeForYou } from '../../services/recommendationService';
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
const MADE_FOR_YOU_LIMIT = 12;
const NEW_SONGS_LIMIT = 12;

interface HomeSection {
  key: 'made' | 'new' | 'trending';
  title: string;
  data: Song[];
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [songs, setSongs] = useState<Song[]>([]);
  const [newSongs, setNewSongs] = useState<Song[]>([]);
  const [madeSongs, setMadeSongs] = useState<Song[]>([]);
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

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const loadFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // New + trending parallel — dono independent feeds hain
      const [trending, fresh] = await Promise.all([
        getTrendingSongs(TRENDING_LIMIT).catch(err => {
          console.warn('Trending load failed:', err);
          return [] as Song[];
        }),
        getNewSongs(NEW_SONGS_LIMIT).catch(err => {
          console.warn('New songs load failed:', err);
          return [] as Song[];
        }),
      ]);
      setSongs(trending);
      setNewSongs(fresh);
      // Phase 13 v1 — signals-based "Made for you" (best-effort, non-blocking)
      getMadeForYou(MADE_FOR_YOU_LIMIT)
        .then(recos => {
          if (!cancelledRef.current) setMadeSongs(recos);
        })
        .catch(() => undefined);
      // Dono feeds khaali = service fail — user ko batao
      if (trending.length === 0 && fresh.length === 0) setError('Songs nahi mile');
    } catch (err) {
      console.warn('Feed load failed:', err);
      setError('Songs load nahi ho paye');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // Har section apna queue banata hai (New pe tap → New queue, Trending → Trending)
  const sections = useMemo<HomeSection[]>(() => {
    const list: HomeSection[] = [];
    if (madeSongs.length > 0) list.push({ key: 'made', title: 'Made for You ✨', data: madeSongs });
    if (newSongs.length > 0) list.push({ key: 'new', title: 'New Songs 🆕', data: newSongs });
    if (songs.length > 0) list.push({ key: 'trending', title: 'Trending Now 🔥', data: songs });
    return list;
  }, [madeSongs, newSongs, songs]);

  const handleSongPress = useCallback(
    (song: Song, sectionQueue: Song[]) => {
      // Section ki poori list queue ban jaati hai (auto-next ke liye)
      void playSong(song, sectionQueue);
    },
    [playSong],
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

      {/* Hero Mehfil Card — sunset gradient identity */}
      <LinearGradient
        colors={[colors.gradientFrom, colors.gradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
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
              <Ionicons name="play" size={16} color={colors.primaryDark} />
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
      </LinearGradient>

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
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={song => song.id}
        renderItem={({ section, item }) => (
          <SongItem
            song={item}
            onPress={selected => handleSongPress(selected, section.data)}
            isActive={item.id === currentSongId}
            onAddPress={handleAddPress}
            isLiked={likedSongs.some(song => song.id === item.id)}
            onLikePress={toggleLiked}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: contentPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void loadFeed(true);
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
                  void loadFeed();
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
    borderRadius: 22,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  heroCopy: {
    gap: spacing.xs + 2,
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
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
    backgroundColor: '#FFFFFF',
  },
  heroPlayText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  heroRoomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
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
    borderColor: 'rgba(255, 65, 108, 0.45)',
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
