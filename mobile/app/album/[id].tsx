/**
 * Album Detail Screen — /album/[id] (Phase 3 Catalogue).
 * Album cover, title, artist, year, tracklist, and Play All.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlbumSummary, Song } from '../../types';
import { fetchAlbumCatalogue } from '../../services/catalogueService';
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

export default function AlbumDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; title?: string; artist?: string }>();
  const albumTitle = params.title || params.id || 'Album';
  const artistName = params.artist || '';

  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const playSong = usePlayer(s => s.playSong);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const isShuffle = usePlayer(s => s.shuffle);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const loadAlbum = useCallback(async (isRefresh = false) => {
    if (!albumTitle) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await fetchAlbumCatalogue(albumTitle, artistName);
      setAlbum(data.album);
      setSongs(data.songs);
    } catch (err) {
      console.warn('[AlbumDetail] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [albumTitle, artistName]);

  useEffect(() => {
    void loadAlbum();
  }, [loadAlbum]);

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
    <View style={[styles.headerContainer, { paddingTop: insets.top + spacing.xl }]}>
      {/* Album Artwork */}
      <View style={styles.coverWrapper}>
        {album?.cover ? (
          <Image source={{ uri: album.cover }} style={styles.coverImage} />
        ) : (
          <View style={[styles.coverImage, styles.coverFallback]}>
            <Ionicons name="disc" size={64} color={colors.primary} />
          </View>
        )}
      </View>

      {/* Album Info */}
      <View style={styles.albumInfo}>
        <Text style={styles.albumTitle} numberOfLines={2}>
          {album?.title || albumTitle}
        </Text>

        <Pressable
          onPress={() => {
            if (album?.artist) {
              router.push(`/artist/${encodeURIComponent(album.artist)}`);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={`Artist: ${album?.artist ?? 'Unknown'}`}
        >
          <Text style={styles.artistName} numberOfLines={1}>
            {album?.artist || artistName}
          </Text>
        </Pressable>

        <Text style={styles.metaText}>
          {album?.year ? `${album.year} · ` : ''}
          {songs.length} tracks
        </Text>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handlePlayAll}
            disabled={songs.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Album de saare gaane chalao"
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
            accessibilityLabel="Shuffle album"
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

      <Text style={styles.sectionTitle}>Tracks</Text>
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
            onRefresh={() => void loadAlbum(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.card}
          />
        }
        ListEmptyComponent={
          loading ? (
            <LoadingSpinner label="Album de gaane load ho rahe hain…" />
          ) : (
            <EmptyState
              icon="disc-outline"
              title="Tracks nahi mile"
              subtitle="Is album ke songs search result me nahi aaye"
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
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  coverWrapper: {
    width: 200,
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: spacing.lg,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  albumInfo: {
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  albumTitle: {
    ...typography.h1,
    fontSize: 26,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  artistName: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
    fontSize: 16,
    marginBottom: spacing.xs,
  },
  metaText: {
    ...typography.caption,
    color: colors.subtext,
    marginBottom: spacing.lg,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    paddingHorizontal: spacing.md,
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
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
});
