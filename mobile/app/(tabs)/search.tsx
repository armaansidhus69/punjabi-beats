/**
 * Search tab — live search (Phase 5, FR-1.1..FR-1.6).
 *
 * Flow:
 *   query (TextInput) → 400ms debounce → min 2 chars → searchSongs() (iTunes IN)
 *   → results (SongItem reuse) | 3 shimmer skeleton | "Kuch nahi mila"
 *   query khaali ya <2 chars → recent searches (searchStore + AsyncStorage)
 * Song ke '+' se global AddToPlaylistSheet khulti hai (Phase 9 — root layout me mounted).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../../types';
import { searchSongs } from '../../services/musicApi';
import { usePlayer } from '../../stores/playerStore';
import { promptAddSong } from '../../utils/songActions';
import { MAX_RECENT_SEARCHES, useSearch } from '../../stores/searchStore';
import { useDebounce } from '../../hooks/useDebounce';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { selectionFeedback, tapFeedback } from '../../utils/haptics';
import EmptyState from '../../components/EmptyState';
import RecentSearchRow from '../../components/RecentSearchRow';
import SongItem from '../../components/SongItem';

/** FR-1.3: max 30 results */
const RESULT_LIMIT = 30;
/** Design spec: 400ms debounce (purane CHECKLIST me 300ms likha tha) */
const DEBOUNCE_MS = 400;
/** 2 se kam chars pe search nahi chalta — recent searches dikhte hain */
const MIN_QUERY_LENGTH = 2;

/** Design ke filter chips (All/Songs pe songs hi milte hain — API song-level hai) */
const FILTERS = ['All', 'Songs', 'Artists', 'Albums', 'Playlists'] as const;
type SearchFilter = (typeof FILTERS)[number];

export default function SearchScreen() {
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('All');
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  /** current query ke liye search poori ho chuki? ("Kuch nahi mila" ke liye) */
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  /** stale (purane) response ignore karne ke liye run id */
  const runIdRef = useRef(0);
  /** jis term ke results abhi screen pe hain (duplicate fetch rokne ke liye) */
  const resultsTermRef = useRef<string | null>(null);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  // SongItem ke '+' se shared prompt — room me ho to "Add to Room Queue"
  // option, warna seedha add-to-playlist sheet (Phase 9)
  const handleAddPress = promptAddSong;

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

  // Cold start pe recent searches AsyncStorage se laao (FR-1.6)
  useEffect(() => {
    if (!historyLoaded) void loadHistory();
  }, [historyLoaded, loadHistory]);

  const runSearch = useCallback(
    async (term: string) => {
      const runId = ++runIdRef.current;
      setLoading(true);
      const list = await searchSongs(term, RESULT_LIMIT);
      // Beech me naya search chala gaya to ye response bekaar hai (race guard)
      if (runId !== runIdRef.current) return;
      setResults(list);
      setLoading(false);
      setSearched(true);
      resultsTermRef.current = term;
      // Recent me sirf tab daalo jab actually kuch mila ho
      if (list.length > 0) addRecentSearch(term);
    },
    [addRecentSearch],
  );

  // Debounced query badalne pe hi search — rapid typing pe API spam nahi hota
  useEffect(() => {
    if (!isSearchable) {
      runIdRef.current += 1; // in-flight response ignore
      resultsTermRef.current = null;
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    // Same term ke results pehle se screen pe hain? (recent tap ya Enter ke baad
    // debounce wahi request dobara na bheje — warna skeleton flash hota hai)
    if (resultsTermRef.current === activeQuery) return;
    void runSearch(activeQuery);
  }, [activeQuery, isSearchable, runSearch]);
  /** Checklist: "Search on Enter key" — debounce ka wait nahi */
  const handleSubmit = useCallback(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;
    Keyboard.dismiss();
    void runSearch(trimmedQuery);
  }, [runSearch, trimmedQuery]);

  const handleClear = useCallback(() => {
    tapFeedback();
    setQuery('');
  }, []);

  const handleRecentPress = useCallback(
    (term: string) => {
      setQuery(term);
      // Recent tap pe turant search (debounce wait karne ka matlab nahi)
      void runSearch(term.trim());
    },
    [runSearch],
  );

  const handleRecentRemove = useCallback(
    (term: string) => {
      removeRecentSearch(term);
    },
    [removeRecentSearch],
  );

  const handleClearAll = useCallback(() => {
    selectionFeedback();
    clearRecentSearches();
  }, [clearRecentSearches]);

  const handleFilterPress = useCallback((next: SearchFilter) => {
    selectionFeedback();
    setFilter(next);
  }, []);

  const handleSongPress = useCallback(
    (song: Song) => {
      // Poori result list queue ban jaati hai (auto-next ke liye)
      void playSong(song, results);
    },
    [playSong, results],
  );

  const showResults = isSearchable && !loading && results.length > 0;

  const idleContent =
    recentSearches.length > 0 ? (
      <View style={styles.recentSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
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
            onPress={handleRecentPress}
            onRemove={handleRecentRemove}
          />
        ))}
      </View>
    ) : (
      <EmptyState emoji="🎤" title="Kuch type karo" subtitle="Punjabi songs, artists ya albums" />
    );
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Search 🔍</Text>

      <View style={styles.searchBarWrap}>
        <View style={[styles.searchBar, focused && styles.searchBarFocused]}>
          <Ionicons name="search" size={20} color={colors.subtext} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={handleSubmit}
            placeholder="Punjabi songs, artists search karo..."
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chipsRow}
      >
        {FILTERS.map(item => {
          const active = item === filter;
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
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={showResults ? results : []}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem
            song={item}
            onPress={handleSongPress}
            isActive={item.id === currentSongId}
            onAddPress={handleAddPress}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: contentPadding },
          !showResults && styles.listContentGrow,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isSearchable ? (
            loading ? (
              <SkeletonRows />
            ) : searched ? (
              <EmptyState emoji="😕" title="Kuch nahi mila" subtitle="Doosra try karo" />
            ) : null
          ) : (
            idleContent
          )
        }
      />
    </View>
  );
}
/** Loading state — 3 shimmer rows (design reference) */
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
      {[0, 1, 2].map(index => (
        <Animated.View key={index} style={[styles.skeletonRow, { opacity: shimmer }]}>
          <View style={styles.skeletonArt} />
          <View style={styles.skeletonInfo}>
            <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
            <View style={[styles.skeletonBar, styles.skeletonBarNarrow]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchBarWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.card,
  },
  searchBarFocused: { borderColor: colors.primary },
  input: { flex: 1, ...typography.body, color: colors.text, padding: 0 },
  clearButton: { padding: spacing.xs },
  chipsRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipInactive: { backgroundColor: 'transparent', borderColor: colors.border },
  /** Base me hi explicit color — fallback text kabhi invisible nahi hoga (bg pe contrast guaranteed) */
  chipText: { ...typography.caption, fontWeight: '700', color: colors.subtext },
  chipTextActive: { color: colors.background, fontWeight: '700' },
  chipTextInactive: { color: colors.subtext },
  listContent: { paddingTop: spacing.xs },
  listContentGrow: { flexGrow: 1 },
  recentSection: { paddingTop: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { ...typography.body, fontWeight: '700', color: colors.subtext },
  clearAll: { ...typography.body, fontWeight: '700', color: colors.primary },
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  skeletonArt: { width: 45, height: 45, borderRadius: 10, backgroundColor: colors.card },
  skeletonInfo: { flex: 1, gap: spacing.sm },
  skeletonBar: { height: 12, borderRadius: 6, backgroundColor: colors.card },
  skeletonBarWide: { width: '70%' },
  skeletonBarNarrow: { width: '40%' },
  pressed: { opacity: 0.6 },
});
