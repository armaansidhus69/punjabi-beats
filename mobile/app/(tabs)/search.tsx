/**
 * Search tab — live search (Phase 5, FR-1.1..FR-1.6 + Phase 29 Cultural Polish).
 *
 * Flow:
 *   query (TextInput) → 400ms debounce → min 2 chars → searchSongs()
 *   → results (SongItem / Artist / Album / Playlist filters)
 *   query khaali ya <2 chars → rich Punjabi discovery:
 *     - Recent Searches (with individual remove & Clear all)
 *     - 🔥 Trending Punjabi Searches (Sidhu, Aujla, Diljit, etc.)
 *     - ⭐ Punjabi Music Legends (circular artist avatars)
 *     - 🎭 Browse by Mood (Bhangra, Romantic, Sufi, etc.)
 *
 * Results enhancements:
 *   - "Top Result" spotlight hero card on 'All' tab
 *   - Real functional filter chips: All, Songs, Artists, Albums, Playlists
 *   - Play All & Shuffle action buttons
 *   - Instant error recovery suggestions on empty search
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../../types';
import { searchSongs } from '../../services/musicApi';
import { usePlayer } from '../../stores/playerStore';
import { useLikedSongs } from '../../stores/likedSongsStore';
import { usePlaylists } from '../../stores/playlistStore';
import { promptAddSong } from '../../utils/songActions';
import { MAX_RECENT_SEARCHES, useSearch } from '../../stores/searchStore';
import { useDebounce } from '../../hooks/useDebounce';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors, sourceColor } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { selectionFeedback, successFeedback, tapFeedback, warningFeedback } from '../../utils/haptics';
import { POPULAR_ARTISTS } from '../../constants/artists';
import { MOODS } from '../../constants/moods';
import { buildSearchIndex, type SearchFilter } from '../../utils/searchFilters';
import EmptyState from '../../components/EmptyState';
import PlaylistRow from '../../components/PlaylistRow';
import RecentSearchRow from '../../components/RecentSearchRow';
import SongArtwork from '../../components/SongArtwork';
import SongItem from '../../components/SongItem';

const RESULT_LIMIT = 100;
const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

const FILTERS = ['All', 'Songs', 'Artists', 'Albums', 'Playlists'] as const;

/**
 * SOURCE FILTERS — multi-source picker (2026-11 redesign).
 * Results ko music source ke hisaab se filter karta hai; har chip ka apna
 * source color (constants/colors.ts). 'All sources' default — poori chain.
 */
const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'jiosaavn', label: 'JioSaavn' },
  { key: 'youtube_music', label: 'YT Music' },
  { key: 'audius', label: 'Audius' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'itunes', label: 'iTunes' },
] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number]['key'];

/** Trending search queries for Punjabi music discovery */
const TRENDING_SEARCHES = [
  'Sidhu Moose Wala',
  'Karan Aujla',
  'Diljit Dosanjh',
  'AP Dhillon',
  'Shubh',
  'Amrinder Gill',
  'Arjan Dhillon',
  'Softly',
  'Winning Speech',
  'Cheques',
  'Born to Shine',
  '295',
];

export default function SearchScreen() {
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('All');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [results, setResults] = useState<Song[]>([]);
  const [resultsTerm, setResultsTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [focused, setFocused] = useState(false);

  const runIdRef = useRef(0);
  const resultsTermRef = useRef<string | null>(null);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);
  const handleAddPress = promptAddSong;

  const playlists = usePlaylists(s => s.playlists);
  const recentSearches = useSearch(s => s.recentSearches);
  const historyLoaded = useSearch(s => s.loaded);
  const loadHistory = useSearch(s => s.load);
  const addRecentSearch = useSearch(s => s.addRecentSearch);
  const removeRecentSearch = useSearch(s => s.removeRecentSearch);
  const clearRecentSearches = useSearch(s => s.clearRecentSearches);

  const contentPadding = useMiniPlayerPadding(spacing.xl);
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);

  const trimmedQuery = query.trim();
  const activeQuery = debouncedQuery.trim();
  const isSearchable = activeQuery.length >= MIN_QUERY_LENGTH;

  // Cold start pe recent searches AsyncStorage se load karo
  useEffect(() => {
    if (!historyLoaded) void loadHistory();
  }, [historyLoaded, loadHistory]);

  const runSearch = useCallback(
    async (term: string) => {
      const runId = ++runIdRef.current;
      const normalizedTerm = term.trim();
      if (normalizedTerm.length < MIN_QUERY_LENGTH) return;
      setLoading(true);
      setSearchError(false);
      try {
        const list = await searchSongs(normalizedTerm, RESULT_LIMIT);
        if (runId !== runIdRef.current) return;
        setResults(list);
        setResultsTerm(normalizedTerm);
        resultsTermRef.current = normalizedTerm.toLowerCase();
        if (list.length > 0) addRecentSearch(normalizedTerm);
      } catch (error) {
        if (runId !== runIdRef.current) return;
        console.warn('[Search] search failed:', error);
        setResults([]);
        setResultsTerm(normalizedTerm);
        setSearchError(true);
        resultsTermRef.current = normalizedTerm.toLowerCase();
      } finally {
        if (runId === runIdRef.current) {
          setLoading(false);
          setSearched(true);
        }
      }
    },
    [addRecentSearch],
  );

  useEffect(() => {
    if (!isSearchable) {
      runIdRef.current += 1;
      resultsTermRef.current = null;
      setResults([]);
      setResultsTerm('');
      setLoading(false);
      setSearched(false);
      setSearchError(false);
      return;
    }
    if (resultsTermRef.current === activeQuery.toLowerCase()) return;
    void runSearch(activeQuery);
  }, [activeQuery, isSearchable, runSearch]);

  const handleSubmit = useCallback(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;
    Keyboard.dismiss();
    void runSearch(trimmedQuery);
  }, [runSearch, trimmedQuery]);

  const handleClear = useCallback(() => {
    tapFeedback();
    setQuery('');
  }, []);

  const handleApplyTerm = useCallback(
    (term: string) => {
      tapFeedback();
      setQuery(term);
      Keyboard.dismiss();
      void runSearch(term.trim());
    },
    [runSearch],
  );

  const handleClearAll = useCallback(() => {
    warningFeedback();
    clearRecentSearches();
  }, [clearRecentSearches]);

  const handleFilterPress = useCallback((next: SearchFilter) => {
    selectionFeedback();
    setFilter(next);
  }, []);

  const handleSourceFilterPress = useCallback((next: SourceFilter) => {
    selectionFeedback();
    setSourceFilter(next);
  }, []);

  const searchIndex = useMemo(
    () => buildSearchIndex(results, playlists, resultsTerm, POPULAR_ARTISTS),
    [playlists, results, resultsTerm],
  );

  /** Source-filtered songs — source chips sirf song categories par apply hote hain. */
  const visibleSongs = useMemo(
    () =>
      sourceFilter === 'all'
        ? searchIndex.songs
        : searchIndex.songs.filter(song => song.source === sourceFilter),
    [searchIndex.songs, sourceFilter],
  );

  const handleSongPress = useCallback(
    (song: Song) => {
      void playSong(song, visibleSongs);
    },
    [playSong, visibleSongs],
  );

  const handlePlayAll = useCallback(() => {
    if (visibleSongs.length === 0) return;
    successFeedback();
    void playSong(visibleSongs[0], visibleSongs);
  }, [playSong, visibleSongs]);

  const handleShuffleAll = useCallback(() => {
    if (visibleSongs.length === 0) return;
    successFeedback();
    const shuffled = [...visibleSongs].sort(() => Math.random() - 0.5);
    void playSong(shuffled[0], shuffled);
  }, [playSong, visibleSongs]);

  const showResults =
    isSearchable &&
    !loading &&
    (searchIndex.songs.length > 0 ||
      searchIndex.artists.length > 0 ||
      searchIndex.albums.length > 0 ||
      searchIndex.playlists.length > 0);

  // Filter badge count label
  const getFilterBadge = (item: SearchFilter): string | null => {
    if (!showResults) return null;
    if (item === 'Songs') return `${visibleSongs.length}`;
    if (item === 'Artists') return `${searchIndex.artists.length}`;
    if (item === 'Albums') return `${searchIndex.albums.length}`;
    if (item === 'Playlists') return `${searchIndex.playlists.length}`;
    return null;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Punjabi Beats Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSubtitle}>ਲੱਭੋ • Discover</Text>
          <Text style={styles.title}>Search</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="sparkles" size={12} color={colors.primary} />
          <Text style={styles.headerBadgeText}>Live Catalogue</Text>
        </View>
      </View>

      {/* Modern Search Input Bar */}
      <View style={styles.searchBarWrap}>
        <View style={[styles.searchBar, focused && styles.searchBarFocused]}>
          <Ionicons
            name="search"
            size={20}
            color={focused || query.length > 0 ? colors.primary : colors.subtext}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={handleSubmit}
            placeholder="Search songs, artists, albums (e.g. Sidhu, Diljit)..."
            placeholderTextColor={colors.subtext}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Songs search karo"
            style={styles.input}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={handleClear}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Search clear karo"
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <Ionicons name="close-circle" size={20} color={colors.subtext} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        style={styles.filterScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chipsRow}
      >
        {FILTERS.map(item => {
          const active = item === filter;
          const badge = getFilterBadge(item);
          return (
            <Pressable
              key={item}
              onPress={() => handleFilterPress(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
            >
              <Text
                style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}
              >
                {item}
              </Text>
              {badge ? (
                <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                  <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Active Search Mode */}
      {isSearchable ? (
        loading ? (
          <SkeletonRows />
        ) : showResults ? (
          <View style={styles.resultsContainer}>
            {/* Action Bar (Result Count + Play All + Shuffle) */}
            <View style={styles.actionBar}>
              <Text style={styles.resultCountText}>
                {filter === 'Artists'
                  ? `${searchIndex.artists.length} ${searchIndex.artists.length === 1 ? 'artist' : 'artists'} found`
                  : filter === 'Albums'
                  ? `${searchIndex.albums.length} ${searchIndex.albums.length === 1 ? 'album' : 'albums'} found`
                  : filter === 'Playlists'
                  ? `${searchIndex.playlists.length} ${searchIndex.playlists.length === 1 ? 'playlist' : 'playlists'} found`
                  : `${visibleSongs.length} tracks found`}
              </Text>

              {(filter === 'All' || filter === 'Songs') && (
                <View style={styles.actionButtonsRow}>
                  <Pressable
                    onPress={handlePlayAll}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.playAllBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="play" size={13} color={colors.background} />
                    <Text style={styles.playAllBtnText}>Play all</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleShuffleAll}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.shuffleBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="shuffle" size={14} color={colors.text} />
                    <Text style={styles.shuffleBtnText}>Shuffle</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Source filter chips — multi-source picker (sirf song lists pe) */}
            {(filter === 'All' || filter === 'Songs') && (
              <ScrollView
                style={styles.sourceFilterScroll}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sourceChipRow}
              >
                {SOURCE_FILTERS.map(source => {
                  const active = sourceFilter === source.key;
                  const count =
                    source.key === 'all'
                      ? searchIndex.songs.length
                      : searchIndex.songs.filter(song => song.source === source.key).length;
                  const tint =
                    source.key === 'all'
                      ? colors.text
                      : sourceColor[source.key] ?? colors.subtext;
                  return (
                    <Pressable
                      key={source.key}
                      onPress={() => handleSourceFilterPress(source.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`${source.label} source filter`}
                      accessibilityState={{ selected: active }}
                      style={({ pressed }) => [
                        styles.sourceChip,
                        active && styles.sourceChipActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      {source.key !== 'all' ? (
                        <View
                          style={[styles.sourceDot, { backgroundColor: tint }]}
                        />
                      ) : (
                        <Ionicons name="layers-outline" size={11} color={tint} />
                      )}
                      <Text style={[styles.sourceChipLabel, active && { color: tint }]}>
                        {source.label}
                      </Text>
                      <Text style={[styles.sourceChipCount, active && { color: tint }]}>
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {/* Tab: Artists */}
            {filter === 'Artists' ? (
              <FlatList
                data={searchIndex.artists}
                keyExtractor={item => item.name}
                contentContainerStyle={[styles.listContent, { paddingBottom: contentPadding }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      tapFeedback();
                      router.push(`/artist/${encodeURIComponent(item.name)}`);
                    }}
                    style={({ pressed }) => [styles.artistRow, pressed && styles.pressed]}
                  >
                    <View style={styles.artistAvatarWrap}>
                      {item.image ? (
                        <Image source={{ uri: item.image }} style={styles.artistAvatar} />
                      ) : (
                        <View style={styles.artistPlaceholder}>
                          <Text style={styles.artistInitial}>
                            {item.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.artistInfo}>
                      <Text style={styles.artistName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.artistMeta} numberOfLines={1}>
                        {item.count} {item.count === 1 ? 'track' : 'tracks'} • Tap for catalogue
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <EmptyState
                    emoji="🎤"
                    title="No matching artists"
                    subtitle="Try searching with a different artist name"
                  />
                }
              />
            ) : filter === 'Albums' ? (
              /* Tab: Albums */
              <FlatList
                data={searchIndex.albums}
                keyExtractor={item => item.id}
                contentContainerStyle={[styles.listContent, { paddingBottom: contentPadding }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      tapFeedback();
                      router.push(
                        `/album/${encodeURIComponent(item.id)}?title=${encodeURIComponent(
                          item.title,
                        )}&artist=${encodeURIComponent(item.artist)}`,
                      );
                    }}
                    style={({ pressed }) => [styles.albumRow, pressed && styles.pressed]}
                  >
                    <SongArtwork uri={item.cover} size={52} radius={8} />
                    <View style={styles.albumInfo}>
                      <Text style={styles.albumTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.albumArtist} numberOfLines={1}>
                        {item.artist}
                      </Text>
                      <Text style={styles.albumMeta}>
                        {item.count} {item.count === 1 ? 'track' : 'tracks'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <EmptyState
                    emoji="💿"
                    title="No matching albums"
                    subtitle="Try searching by album or artist title"
                  />
                }
              />
            ) : filter === 'Playlists' ? (
              /* Tab: Playlists */
              <FlatList
                data={searchIndex.playlists}
                keyExtractor={item => item.id}
                contentContainerStyle={[styles.listContent, { paddingBottom: contentPadding }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                  <Pressable
                    onPress={() => {
                      tapFeedback();
                      router.push(`/ai-playlist?prompt=${encodeURIComponent(activeQuery)}`);
                    }}
                    style={({ pressed }) => [styles.aiMixCard, pressed && styles.pressed]}
                  >
                    <View style={styles.aiMixIcon}>
                      <Ionicons name="sparkles" size={22} color={colors.background} />
                    </View>
                    <View style={styles.aiMixInfo}>
                      <Text style={styles.aiMixTitle}>Generate AI Punjabi Mix</Text>
                      <Text style={styles.aiMixSubtitle}>
                        Auto-curate songs around "{activeQuery}"
                      </Text>
                    </View>
                    <Ionicons name="arrow-forward-circle" size={24} color={colors.primary} />
                  </Pressable>
                }
                renderItem={({ item }) => (
                  <PlaylistRow
                    playlist={item}
                    onPress={p => router.push(`/playlist/${p.id}`)}
                  />
                )}
                ListEmptyComponent={
                  <View style={styles.emptyPlaylistWrap}>
                    <Text style={styles.emptyPlaylistText}>
                      No personal playlists match "{activeQuery}". Use AI Mix above to create one!
                    </Text>
                  </View>
                }
              />
            ) : (
              /* Tab: All / Songs */
              <FlatList
                data={visibleSongs}
                keyExtractor={song => song.id}
                contentContainerStyle={[styles.listContent, { paddingBottom: contentPadding }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                  filter === 'All' && visibleSongs.length > 0 ? (
                    <View style={styles.spotlightCard}>
                      <View style={styles.spotlightBadge}>
                        <Ionicons name="flame" size={12} color="#000" />
                        <Text style={styles.spotlightBadgeText}>TOP MATCH</Text>
                      </View>
                      <Pressable
                        onPress={() => handleSongPress(visibleSongs[0])}
                        style={styles.spotlightContent}
                      >
                        <SongArtwork uri={visibleSongs[0].cover} size={64} radius={12} />
                        <View style={styles.spotlightInfo}>
                          <Text style={styles.spotlightTitle} numberOfLines={1}>
                            {visibleSongs[0].title}
                          </Text>
                          <Text style={styles.spotlightArtist} numberOfLines={1}>
                            {visibleSongs[0].artist}
                          </Text>
                          <Text style={styles.spotlightMeta}>
                            Punjabi Beats • {Math.round(visibleSongs[0].duration / 1000)}s
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            successFeedback();
                            void playSong(visibleSongs[0], visibleSongs);
                          }}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Play ${visibleSongs[0].title}`}
                          style={styles.spotlightPlayBtn}
                        >
                          <Ionicons
                            name="play"
                            size={20}
                            color={colors.background}
                            style={{ marginLeft: 2 }}
                          />
                        </Pressable>
                      </Pressable>
                    </View>
                  ) : null
                }
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
              />
            )}
          </View>
        ) : searchError ? (
          <View style={styles.noResultsWrap}>
            <Text style={styles.noResultsEmoji}>⚠️</Text>
            <Text style={styles.noResultsTitle}>Search load nahi ho paayi</Text>
            <Text style={styles.noResultsSubtitle}>Network check karke dobara try karo.</Text>
            <Pressable
              onPress={() => void runSearch(trimmedQuery)}
              accessibilityRole="button"
              accessibilityLabel="Search dobara try karo"
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Ionicons name="refresh" size={15} color={colors.background} />
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : searched ? (
          /* Empty Search Recovery */
          <View style={styles.noResultsWrap}>
            <Text style={styles.noResultsEmoji}>🔍</Text>
            <Text style={styles.noResultsTitle}>ਕੋਈ ਗੀਤ ਨਹੀਂ ਮਿਲਿਆ</Text>
            <Text style={styles.noResultsSubtitle}>
              "{trimmedQuery}" ਲਈ ਕੁਝ ਨਹੀਂ ਮਿਲਿਆ. ਸਪੈਲਿੰਗ ਚੈੱਕ ਕਰੋ ਜਾਂ ਇਹਨਾਂ ਕਲਾਕਾਰਾਂ ਨੂੰ ਅਜ਼ਮਾਓ:
            </Text>
            <View style={styles.suggestChipsWrap}>
              {['Sidhu Moose Wala', 'Karan Aujla', 'Diljit Dosanjh', 'AP Dhillon', 'Shubh'].map(
                name => (
                  <Pressable
                    key={name}
                    onPress={() => handleApplyTerm(name)}
                    style={({ pressed }) => [styles.suggestChip, pressed && styles.pressed]}
                  >
                    <Ionicons name="search" size={12} color={colors.primary} />
                    <Text style={styles.suggestChipText}>{name}</Text>
                  </Pressable>
                ),
              )}
            </View>
          </View>
        ) : null
      ) : (
        /* Idle Punjabi Discovery View */
        <ScrollView
          style={styles.idleScroll}
          contentContainerStyle={[styles.idleContent, { paddingBottom: contentPadding }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <View style={styles.sectionWrap}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>Recent Searches</Text>
                </View>
                <Pressable
                  onPress={handleClearAll}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Saari recent searches hatao"
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Text style={styles.clearAll}>Clear all</Text>
                </Pressable>
              </View>
              {recentSearches.slice(0, MAX_RECENT_SEARCHES).map(term => (
                <RecentSearchRow
                  key={term}
                  query={term}
                  onPress={handleApplyTerm}
                  onRemove={removeRecentSearch}
                />
              ))}
            </View>
          )}

          {/* Trending Punjabi Searches */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="flame" size={16} color="#ff9500" />
                <Text style={styles.sectionTitle}>Trending Searches • ਟਰੈਂਡਿੰਗ ਖੋਜਾਂ</Text>
              </View>
            </View>
            <View style={styles.trendingGrid}>
              {TRENDING_SEARCHES.map(item => (
                <Pressable
                  key={item}
                  onPress={() => handleApplyTerm(item)}
                  style={({ pressed }) => [styles.trendingTag, pressed && styles.pressed]}
                >
                  <Ionicons name="trending-up" size={13} color={colors.primary} />
                  <Text style={styles.trendingTagText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Punjabi Music Legends (Curated Artists) */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="star" size={15} color="#ffd60a" />
                <Text style={styles.sectionTitle}>Punjabi Legends • ਮਸ਼ਹੂਰ ਕਲਾਕਾਰ</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.artistsScrollRow}
            >
              {POPULAR_ARTISTS.map(artist => (
                <Pressable
                  key={artist.id}
                  onPress={() => {
                    tapFeedback();
                    router.push(`/artist/${encodeURIComponent(artist.name)}`);
                  }}
                  style={({ pressed }) => [styles.artistCircleCard, pressed && styles.pressed]}
                >
                  <Image source={{ uri: artist.image }} style={styles.artistCircleImg} />
                  <Text style={styles.artistCircleName} numberOfLines={1}>
                    {artist.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Explore by Mood */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="musical-notes" size={15} color={colors.primary} />
                <Text style={styles.sectionTitle}>Explore by Mood • ਗੀਤਾਂ ਦਾ ਮੂਡ</Text>
              </View>
            </View>
            <View style={styles.moodsGrid}>
              {MOODS.map(mood => (
                <Pressable
                  key={mood.id}
                  onPress={() => {
                    tapFeedback();
                    router.push(`/mood/${mood.id}`);
                  }}
                  style={({ pressed }) => [
                    styles.moodPill,
                    { borderColor: mood.color || colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.moodEmoji}>{mood.emoji}</Text>
                  <View>
                    <Text style={styles.moodTitle}>{mood.title}</Text>
                    {mood.punjabi ? (
                      <Text style={styles.moodPunjabi}>{mood.punjabi}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/** Loading state — 4 shimmer rows with breathing pulse */
function SkeletonRows() {
  const shimmer = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 0.85, duration: 650, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [shimmer]);

  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2, 3].map(index => (
        <Animated.View key={index} style={[styles.skeletonRow, { opacity: shimmer }]}>
          <View style={styles.skeletonArt} />
          <View style={styles.skeletonInfo}>
            <View
              style={[
                styles.skeletonBar,
                index % 2 === 0 ? styles.skeletonBarWide : styles.skeletonBarMid,
              ]}
            />
            <View style={[styles.skeletonBar, styles.skeletonBarNarrow]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 153, 51, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 153, 51, 0.25)',
  },
  headerBadgeText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },

  /* Search Input */
  searchBarWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 50,
    borderRadius: 25,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBarFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(30, 30, 36, 0.95)',
  },
  input: {
    flex: 1,
    ...typography.body,
    fontSize: 14,
    color: colors.text,
    padding: 0,
  },
  clearButton: { padding: spacing.xs },

  /* Filter Chips */
  filterScroll: { flexGrow: 0, height: 48 },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    minHeight: 34,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipInactive: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: colors.border },
  chipText: { ...typography.caption, fontWeight: '700', color: colors.subtext },
  chipTextActive: { color: colors.background, fontWeight: '800' },
  chipTextInactive: { color: colors.subtext },
  filterBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterBadgeActive: { backgroundColor: 'rgba(0, 0, 0, 0.25)' },
  filterBadgeText: { fontSize: 10, fontWeight: '700', color: colors.subtext },
  filterBadgeTextActive: { color: colors.background },

  /* Results Action Bar */
  resultsContainer: { flex: 1 },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  /* Source filter chips (multi-source picker) */
  sourceFilterScroll: { flexGrow: 0, height: 38 },
  sourceChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sourceChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  sourceChipLabel: { ...typography.caption, color: colors.subtext, fontWeight: '600' },
  sourceChipCount: { ...typography.caption, color: colors.subtext, opacity: 0.7 },
  resultCountText: {
    ...typography.caption,
    color: colors.subtext,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  playAllBtn: { backgroundColor: colors.primary },
  playAllBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.background,
  },
  shuffleBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shuffleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },

  /* Top Match Spotlight */
  spotlightCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 153, 51, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 153, 51, 0.25)',
  },
  spotlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: spacing.sm,
  },
  spotlightBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },
  spotlightContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  spotlightInfo: { flex: 1 },
  spotlightTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  spotlightArtist: {
    ...typography.caption,
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  spotlightMeta: {
    ...typography.caption,
    fontSize: 11,
    color: colors.subtext,
    marginTop: 2,
  },
  spotlightPlayBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Artist & Album Rows */
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  artistAvatarWrap: { width: 50, height: 50, borderRadius: 25, overflow: 'hidden' },
  artistAvatar: { width: '100%', height: '100%' },
  artistPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistInitial: { fontSize: 20, fontWeight: '800', color: colors.primary },
  artistInfo: { flex: 1 },
  artistName: { fontSize: 15, fontWeight: '700', color: colors.text },
  artistMeta: { fontSize: 12, color: colors.subtext, marginTop: 2 },

  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  albumInfo: { flex: 1 },
  albumTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  albumArtist: { fontSize: 12, color: colors.primary, marginTop: 2 },
  albumMeta: { fontSize: 11, color: colors.subtext, marginTop: 1 },

  /* AI Mix Card */
  aiMixCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 153, 51, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 153, 51, 0.3)',
    gap: spacing.md,
  },
  aiMixIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiMixInfo: { flex: 1 },
  aiMixTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  aiMixSubtitle: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  emptyPlaylistWrap: { padding: spacing.xl, alignItems: 'center' },
  emptyPlaylistText: { ...typography.body, color: colors.subtext, textAlign: 'center' },

  /* Empty Search Recovery */
  noResultsWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  noResultsEmoji: { fontSize: 44, marginBottom: spacing.sm },
  noResultsTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  noResultsSubtitle: {
    fontSize: 13,
    color: colors.subtext,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  retryButtonText: { ...typography.caption, color: colors.background, fontWeight: '800' },
  suggestChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestChipText: { fontSize: 12, fontWeight: '600', color: colors.text },

  /* Idle View */
  idleScroll: { flex: 1 },
  idleContent: { paddingTop: spacing.xs },
  sectionWrap: { marginTop: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, letterSpacing: 0.2 },
  clearAll: { ...typography.caption, fontWeight: '700', color: colors.primary },

  /* Trending Chips */
  trendingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  trendingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trendingTagText: { fontSize: 12, fontWeight: '600', color: colors.text },

  /* Punjabi Legends */
  artistsScrollRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  artistCircleCard: { alignItems: 'center', width: 72 },
  artistCircleImg: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 153, 51, 0.4)',
    backgroundColor: colors.card,
  },
  artistCircleName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
    textAlign: 'center',
  },

  /* Moods Grid */
  moodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  moodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    width: '48%',
  },
  moodEmoji: { fontSize: 20 },
  moodTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  moodPunjabi: { fontSize: 10, color: colors.primary, fontWeight: '600' },

  /* Skeleton Loader */
  listContent: { paddingTop: spacing.xs },
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  skeletonArt: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.card },
  skeletonInfo: { flex: 1, gap: spacing.sm },
  skeletonBar: { height: 12, borderRadius: 6, backgroundColor: colors.card },
  skeletonBarWide: { width: '75%' },
  skeletonBarMid: { width: '55%' },
  skeletonBarNarrow: { width: '35%' },
  pressed: { opacity: 0.65 },
});
