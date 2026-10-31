/**
 * Artist Detail Screen — /artist/[name] (Phase 3 Catalogue).
 * Dynamic artist profile banner, bio, top tracks list, and Play All.
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
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlbumSummary, ArtistSummary, Song } from '../../types';
import { fetchArtistCatalogue } from '../../services/catalogueService';
import { usePlayer } from '../../stores/playerStore';
import { useLikedSongs } from '../../stores/likedSongsStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { promptAddSong } from '../../utils/songActions';
import { selectionFeedback, successFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import SongItem from '../../components/SongItem';

export default function ArtistDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name?: string }>();
  const rawName = typeof params.name === 'string' ? params.name : '';

  const [profile, setProfile] = useState<ArtistSummary | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const playSong = usePlayer(s => s.playSong);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const isShuffle = usePlayer(s => s.shuffle);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const loadArtist = useCallback(async (isRefresh = false) => {
    if (!rawName) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await fetchArtistCatalogue(rawName);
      setProfile(data.profile);
      setSongs(data.songs);
      setAlbums(data.albums);
    } catch (err) {
      console.warn('[ArtistDetail] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rawName]);

  useEffect(() => {
    void loadArtist();
  }, [loadArtist]);

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    successFeedback();
    void playSong(songs[0], songs);
  }, [playSong, songs]);

  const handleShufflePlay = useCallback(() => {
    if (songs.length === 0) return;
    selectionFeedback();
    if (!isShuffle) toggleShuffle();
    const randomIndex = Math.floor(Math.random() * songs.length);
    void playSong(songs[randomIndex], songs);
  }, [songs, isShuffle, toggleShuffle, playSong]);

  const listHeader = (
    <View style={styles.headerContainer}>
      {/* Hero Banner / Portrait */}
      <View style={styles.heroWrapper}>
        {profile?.image ? (
          <Image source={{ uri: profile.image }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, styles.heroFallback]}>
            <Ionicons name="person" size={80} color={colors.primary} />
          </View>
        )}
        <View style={styles.heroGradientOverlay} />
      </View>

      {/* Artist Info */}
      <View style={styles.artistInfo}>
        <View style={styles.badgeRow}>
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Text style={styles.verifiedText}>Verified Punjabi Artist</Text>
        </View>

        <Text style={styles.artistName} numberOfLines={2}>
          {profile?.name || rawName}
        </Text>

        {profile?.genre ? (
          <Text style={styles.genreText}>{profile.genre}</Text>
        ) : null}

        {profile?.monthlyListeners ? (
          <Text style={styles.listenerText}>{profile.monthlyListeners}</Text>
        ) : null}

        {profile?.bio ? (
          <Text style={styles.bioText} numberOfLines={3}>
            {profile.bio}
          </Text>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handlePlayAll}
            disabled={songs.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Artist de saare gaane chalao"
            style={({ pressed }) => [
              styles.playAllButton,
              pressed && styles.pressed,
              songs.length === 0 && styles.disabled,
            ]}
          >
            <Ionicons name="play" size={20} color={colors.background} />
            <Text style={styles.playAllText}>Play All</Text>
          </Pressable>

          <Pressable
            onPress={handleShufflePlay}
            disabled={songs.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Shuffle play"
            style={({ pressed }) => [
              styles.shuffleButton,
              pressed && styles.pressed,
              songs.length === 0 && styles.disabled,
            ]}
          >
            <Ionicons name="shuffle" size={20} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {albums.length > 0 && (
        <View style={styles.albumsSection}>
          <Text style={styles.sectionTitle}>Albums & EPs 💿</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.albumsRow}
          >
            {albums.map(album => (
              <Pressable
                key={album.id}
                style={({ pressed }) => [styles.albumCard, pressed && styles.pressed]}
                onPress={() => {
                  selectionFeedback();
                  router.push(`/album/${encodeURIComponent(album.id)}?title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist)}`);
                }}
              >
                {album.cover ? (
                  <Image source={{ uri: album.cover }} style={styles.albumArtwork} />
                ) : (
                  <View style={[styles.albumArtwork, styles.albumArtworkFallback]}>
                    <Ionicons name="disc" size={32} color={colors.primary} />
                  </View>
                )}
                <Text style={styles.albumTitle} numberOfLines={1}>
                  {album.title}
                </Text>
                <Text style={styles.albumYear}>
                  {album.year ? `${album.year} • ` : ''}{album.trackCount ? `${album.trackCount} songs` : 'Album'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <Text style={styles.sectionTitle}>Popular Tracks 🔥</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Top Floating Back Button */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={router.back}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Wapas jao"
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={song => void playSong(song, songs)}
            isActive={item.id === currentSongId}
            onAddPress={promptAddSong}
            isLiked={likedSongs.some(s => s.id === item.id)}
            onLikePress={toggleLiked}
          />
        )}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: contentPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadArtist(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.card}
          />
        }
        ListEmptyComponent={
          loading ? (
            <LoadingSpinner label={`${rawName} de gaane load ho rahe hain…`} />
          ) : (
            <EmptyState
              icon="musical-notes-outline"
              title="Koi track nahi mile"
              subtitle="Is artist ke gaane catalogue me uplabdh nahi hain"
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 15, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContainer: {
    marginBottom: spacing.md,
  },
  heroWrapper: {
    width: '100%',
    height: 280,
    position: 'relative',
    backgroundColor: colors.surface,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  heroGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 15, 0.4)',
  },
  artistInfo: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  verifiedText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  artistName: {
    ...typography.h1,
    fontSize: 32,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  genreText: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  listenerText: {
    ...typography.caption,
    color: colors.subtext,
    marginBottom: spacing.sm,
  },
  bioText: {
    ...typography.body,
    fontSize: 13,
    color: colors.subtext,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  playAllButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  playAllText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '700',
    fontSize: 16,
  },
  shuffleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  albumsSection: {
    marginBottom: spacing.sm,
  },
  albumsRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  albumCard: {
    width: 120,
  },
  albumArtwork: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: colors.card,
    marginBottom: spacing.xs,
  },
  albumArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  albumTitle: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  albumYear: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
});
