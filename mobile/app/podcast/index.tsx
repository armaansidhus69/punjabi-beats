/**
 * Podcasts home — /podcast/index (Phase 12a roadmap).
 * Continue-listening + saved shows + search (shows/episodes sections).
 * Entry point Library tab ke Podcasts card. Render-only: logic podcastStore.
 * Lists chhote hain (v1 caps) — ScrollView sufficient, FlatList hack nahi.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PodcastGate from '../../components/PodcastGate';
import EpisodeRow from '../../components/EpisodeRow';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import { PodcastProgressEntry, PodcastShow } from '../../types';
import { selectContinueListening, usePodcast } from '../../stores/podcastStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { tapFeedback } from '../../utils/haptics';

export default function PodcastHomeScreen() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.lg);

  const progressMap = usePodcast(s => s.progressMap);
  const savedShows = usePodcast(s => s.savedShows);
  const loadSaved = usePodcast(s => s.loadSaved);
  const searchResultsShows = usePodcast(s => s.searchResultsShows);
  const searchResultsEpisodes = usePodcast(s => s.searchResultsEpisodes);
  const searching = usePodcast(s => s.searching);
  const search = usePodcast(s => s.search);
  const clearSearch = usePodcast(s => s.clearSearch);
  const resumeFromProgress = usePodcast(s => s.resumeFromProgress);
  const playEpisode = usePodcast(s => s.playEpisode);

  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);

  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const continueRows = useMemo(() => selectContinueListening(progressMap), [progressMap]);

  // Focus pe saved + progress refresh (roop: naya save detail se bhi aayega)
  useFocusEffect(
    useCallback(() => {
      void loadSaved();
      void usePodcast.getState().loadProgress();
    }, [loadSaved]),
  );

  // Unmount pe search state clear
  useEffect(() => clearSearch, [clearSearch]);

  // Debounced search (350ms) — min 2 chars (AddSongSearchModal pattern)
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      clearSearch();
      return;
    }
    debounceRef.current = setTimeout(() => {
      void search(trimmed).catch(() => undefined);
    }, 350);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query, search, clearSearch]);

  const handleShowPress = useCallback((show: PodcastShow) => {
    tapFeedback();
    router.push(`/podcast/${show.id}`);
  }, []);

  const handleContinuePress = useCallback(
    (row: PodcastProgressEntry & { id: string }) => {
      void resumeFromProgress(row.id).catch(() => undefined);
    },
    [resumeFromProgress],
  );

  const hasQuery = query.trim().length >= 2;
  const hasResults = searchResultsShows.length > 0 || searchResultsEpisodes.length > 0;

  return (
    <PodcastGate>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={router.back}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Wapas jao"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Podcasts</Text>
          <View style={styles.iconSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: contentPadding }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Podcast search karo…"
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Podcast search"
          />

          {searching && <LoadingSpinner label="Search ho raha hai…" />}

          {/* search results pehle — active search me home sections upar */}
          {hasQuery && searchResultsShows.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Shows</Text>
              {searchResultsShows.map(show => (
                <Pressable
                  key={show.id}
                  onPress={() => handleShowPress(show)}
                  accessibilityRole="button"
                  accessibilityLabel={`${show.title} kholo`}
                  style={({ pressed }) => [styles.showRow, pressed && styles.pressed]}
                >
                  <Image source={{ uri: show.artworkUrl }} style={styles.showArt} />
                  <View style={styles.showInfo}>
                    <Text style={styles.showTitle} numberOfLines={1}>
                      {show.title}
                    </Text>
                    <Text style={styles.showMeta} numberOfLines={1}>
                      {show.artist}
                      {show.primaryGenre ? ` · ${show.primaryGenre}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
                </Pressable>
              ))}
            </View>
          )}

          {hasQuery && searchResultsEpisodes.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Episodes</Text>
              {searchResultsEpisodes.map(episode => (
                <EpisodeRow
                  key={episode.id}
                  title={episode.title}
                  publishedLabel={episode.showTitle}
                  durationMs={episode.durationMs}
                  progress={progressMap[episode.id] ?? null}
                  playing={currentSongId === episode.id}
                  onPress={() => void playEpisode(episode).catch(() => undefined)}
                />
              ))}
            </View>
          )}

          {hasQuery && !searching && !hasResults && (
            <EmptyState icon="mic-outline" title="Kuch nahi mila" subtitle="Doosre words try karo" />
          )}

          {/* home sections — active search me niche chal jate hain */}
          {continueRows.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Continue Listening</Text>
              {continueRows.map(row => (
                <EpisodeRow
                  key={row.id}
                  title={row.title}
                  publishedLabel={row.showTitle}
                  durationMs={row.durationMs}
                  progress={row}
                  playing={currentSongId === row.id}
                  onPress={() => handleContinuePress(row)}
                />
              ))}
            </View>
          )}

          {savedShows.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saved Shows</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.savedRow}
                nestedScrollEnabled
              >
                {savedShows.map(show => (
                  <Pressable
                    key={show.id}
                    onPress={() => handleShowPress(show)}
                    accessibilityRole="button"
                    accessibilityLabel={`${show.title} kholo`}
                    style={({ pressed }) => [styles.savedCard, pressed && styles.pressed]}
                  >
                    <Image source={{ uri: show.artworkUrl }} style={styles.savedArt} />
                    <Text style={styles.savedTitle} numberOfLines={2}>
                      {show.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      </View>
    </PodcastGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.h2, color: colors.text },
  iconButton: { padding: spacing.xs, marginRight: spacing.md },
  iconSpacer: { width: 36 },
  pressed: { opacity: 0.7 },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    color: colors.text,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...typography.body,
  },
  section: { marginTop: spacing.sm, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  savedRow: { gap: spacing.md },
  savedCard: { width: 108, gap: spacing.xs },
  savedArt: {
    width: 108,
    height: 108,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  savedTitle: { ...typography.caption, color: colors.text, textAlign: 'center' },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  showArt: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  showInfo: { flex: 1, gap: 2 },
  showTitle: { ...typography.body, color: colors.text },
  showMeta: { ...typography.caption, color: colors.subtext },
});
