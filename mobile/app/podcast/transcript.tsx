/**
 * Publisher transcript — /podcast/transcript (Phase 7b).
 *
 * Screen render/input only: fetch/search/jump/persist transcriptStore me,
 * format parsing pure core me. PodcastGate flag-off pe child mount nahi karta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PodcastGate from '../../components/PodcastGate';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import { positionForTranscript, segmentAt } from '../../core/podcast/transcript';
import { useTranscript } from '../../stores/transcriptStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { formatDuration } from '../../utils/format';
import { tapFeedback } from '../../utils/haptics';
import type { PodcastTranscriptMime, TranscriptSegment } from '../../types';

interface TranscriptRow {
  index: number;
  segment: TranscriptSegment;
}

function mimeLabel(value: PodcastTranscriptMime): string {
  switch (value) {
    case 'text/vtt':
      return 'VTT';
    case 'application/x-subrip':
      return 'SRT';
    case 'application/json':
      return 'JSON';
    case 'text/html':
      return 'HTML';
    case 'text/plain':
      return 'Plain';
  }
}

export default function PodcastTranscriptScreen() {
  return (
    <PodcastGate>
      <TranscriptContent />
    </PodcastGate>
  );
}

function TranscriptContent() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const episode = useTranscript(s => s.episode);
  const transcript = useTranscript(s => s.transcript);
  const loading = useTranscript(s => s.loading);
  const error = useTranscript(s => s.error);
  const query = useTranscript(s => s.query);
  const matches = useTranscript(s => s.matches);
  const retry = useTranscript(s => s.retry);
  const close = useTranscript(s => s.close);
  const setQuery = useTranscript(s => s.setQuery);
  const jumpToSegment = useTranscript(s => s.jumpToSegment);

  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const position = usePlayer(s => s.position);

  const [following, setFollowing] = useState(false);
  const listRef = useRef<FlatList<TranscriptRow> | null>(null);
  const scrolledTo = useRef(-1);
  const restoredKey = useRef('');
  const userScrolled = useRef(false);
  const queryRef = useRef(query);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  queryRef.current = query;

  useEffect(() => close, [close]);

  const activeIndex = useMemo(() => {
    if (!episode || !transcript || currentSongId !== episode.id || !transcript.timed) return -1;
    return segmentAt(transcript.segments, position);
  }, [currentSongId, episode, position, transcript]);

  const hasSearch = query.trim().length >= 2;
  const rows = useMemo<TranscriptRow[]>(() => {
    if (!transcript) return [];
    const indices = hasSearch
      ? matches
      : transcript.segments.map((_segment, index) => index);
    return indices
      .map(index => ({ index, segment: transcript.segments[index] }))
      .filter(row => row.segment !== undefined);
  }, [hasSearch, matches, transcript]);

  const scrollTo = useCallback((index: number, animated: boolean) => {
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.35 });
  }, []);

  /* transcript load pe current playback warna source-matched reading position */
  const sourceUrl = transcript?.sourceUrl ?? '';
  const episodeId = episode?.id ?? '';
  useEffect(() => {
    const key = `${episodeId}\u0000${sourceUrl}`;
    if (sourceUrl.length === 0 || episodeId.length === 0 || restoredKey.current === key) {
      return;
    }
    restoredKey.current = key;
    const state = useTranscript.getState();
    const player = usePlayer.getState();
    const selected = state.transcript;
    if (!selected) return;
    const playing = player.currentSong?.id === episodeId;
    const target = playing
      ? segmentAt(selected.segments, player.position)
      : positionForTranscript(
          state.positions,
          episodeId,
          selected.sourceUrl,
          selected.segments.length,
        );
    setFollowing(playing);
    if (target !== null && target >= 0) scrollTo(target, false);
  }, [episodeId, scrollTo, sourceUrl]);

  /* current segment follow — search mode me user ke results ko hijack nahi */
  useEffect(() => {
    if (!following || hasSearch || activeIndex < 0 || scrolledTo.current === activeIndex) return;
    scrolledTo.current = activeIndex;
    scrollTo(activeIndex, true);
  }, [activeIndex, following, hasSearch, scrollTo]);

  const handleScrollBegin = useCallback(() => {
    userScrolled.current = true;
    setFollowing(false);
  }, []);

  const handleFollow = useCallback(() => {
    tapFeedback();
    userScrolled.current = false;
    scrolledTo.current = -1;
    setFollowing(true);
    if (activeIndex >= 0) scrollTo(activeIndex, true);
  }, [activeIndex, scrollTo]);

  const handleJump = useCallback(
    async (index: number) => {
      tapFeedback();
      const jumped = await jumpToSegment(index);
      if (jumped) {
        userScrolled.current = false;
        scrolledTo.current = -1;
        setFollowing(true);
      }
    },
    [jumpToSegment],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<TranscriptRow>[] }) => {
      if (!userScrolled.current || queryRef.current.trim().length >= 2) return;
      const first = viewableItems.find(item => item.isViewable && item.item !== undefined);
      if (first?.item) useTranscript.getState().saveReadingIndex(first.item.index);
    },
  ).current;

  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<TranscriptRow>) => {
      const timed = item.segment.startMs !== null;
      const active = item.index === activeIndex;
      return (
        <Pressable
          onPress={() => void handleJump(item.index)}
          disabled={!timed}
          accessibilityRole={timed ? 'button' : 'text'}
          accessibilityLabel={
            timed
              ? `${formatDuration(item.segment.startMs ?? 0)} pe jump: ${item.segment.text}`
              : item.segment.text
          }
          accessibilityState={{ selected: active, disabled: !timed }}
          style={({ pressed }) => [
            styles.segment,
            active && styles.segmentActive,
            pressed && timed && styles.pressed,
          ]}
        >
          <View style={styles.segmentMeta}>
            {item.segment.speaker ? (
              <Text style={active ? styles.speakerActive : styles.speaker} numberOfLines={1}>
                {item.segment.speaker}
              </Text>
            ) : (
              <View />
            )}
            {timed ? (
              <Text style={styles.time}>{formatDuration(item.segment.startMs ?? 0)}</Text>
            ) : null}
          </View>
          <Text style={active ? styles.segmentTextActive : styles.segmentText}>
            {item.segment.text}
          </Text>
        </Pressable>
      );
    },
    [activeIndex, handleJump],
  );

  const handleScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, index * averageItemLength),
        animated: true,
      });
    },
    [],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={router.back}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Transcript band karo"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.title} numberOfLines={1}>
            {episode?.title ?? 'Transcript'}
          </Text>
          {transcript ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {mimeLabel(transcript.mimeType)}
              {transcript.language ? ` · ${transcript.language}` : ''}
              {transcript.timed ? ' · Synced' : ' · Untimed'}
            </Text>
          ) : null}
        </View>
        {!following && activeIndex >= 0 && !hasSearch ? (
          <Pressable
            onPress={handleFollow}
            accessibilityRole="button"
            accessibilityLabel="Transcript follow on karo"
            style={({ pressed }) => [styles.followChip, pressed && styles.pressed]}
          >
            <Ionicons name="locate" size={14} color={colors.primary} />
            <Text style={styles.followText}>Follow</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {transcript ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.subtext} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Transcript me search…"
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Transcript search"
          />
          {hasSearch ? <Text style={styles.hitCount}>{matches.length} hits</Text> : null}
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                tapFeedback();
                setQuery('');
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Transcript search clear karo"
            >
              <Ionicons name="close-circle" size={19} color={colors.subtext} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {loading ? <LoadingSpinner label="Transcript load ho raha hai…" /> : null}

      {!loading && error ? (
        <EmptyState
          icon={error.code === 'unavailable' ? 'document-text-outline' : 'cloud-offline-outline'}
          title={error.code === 'unavailable' ? 'Transcript available nahi' : 'Transcript nahi khula'}
          subtitle={error.message}
        >
          <Pressable
            onPress={() => {
              tapFeedback();
              void retry();
            }}
            accessibilityRole="button"
            accessibilityLabel="Transcript dobara load karo"
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </EmptyState>
      ) : null}

      {!loading && !error && !episode ? (
        <EmptyState
          icon="document-text-outline"
          title="Episode select nahi hua"
          subtitle="Podcast show se transcript icon tap karo"
        />
      ) : null}

      {!loading && !error && transcript ? (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={row => row.segment.id}
          renderItem={renderRow}
          extraData={activeIndex}
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={9}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={handleScrollBegin}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: contentPadding,
            flexGrow: rows.length === 0 ? 1 : undefined,
          }}
          ListEmptyComponent={
            hasSearch ? (
              <EmptyState
                icon="search-outline"
                title="Transcript me match nahi"
                subtitle="Doosre words try karo"
              />
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerInfo: { flex: 1 },
  headerSpacer: { width: 54 },
  title: { ...typography.h2, color: colors.text },
  subtitle: { ...typography.caption, color: colors.subtext },
  pressed: { opacity: 0.7 },
  followChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  followText: { ...typography.caption, color: colors.primary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: spacing.sm + 2,
  },
  hitCount: { ...typography.caption, color: colors.subtext },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: 12,
  },
  segmentActive: { backgroundColor: colors.card },
  segmentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 18,
    marginBottom: 3,
  },
  speaker: { ...typography.caption, color: colors.subtext, flex: 1 },
  speakerActive: { ...typography.caption, color: colors.primary, flex: 1 },
  time: { ...typography.caption, color: colors.subtext },
  segmentText: { ...typography.body, color: colors.subtext, lineHeight: 21 },
  segmentTextActive: { ...typography.body, color: colors.text, lineHeight: 21 },
  retryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background, fontWeight: '700' },
});
