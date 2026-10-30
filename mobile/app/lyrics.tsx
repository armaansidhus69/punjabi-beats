/**
 * Lyrics screen — /lyrics (Phase 7a roadmap).
 * Synced LRC lines current position pe highlight + tap-line seek +
 * scroll-follow latch. Render-only: parse core me, fetch service me,
 * player selectors usePlayer store se. Gate flag `lyrics_enabled`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LyricsGate from '../components/LyricsGate';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import { lineAt } from '../core/lyrics/lyrics';
import { fetchLyrics, describeLyricsError, LyricsError } from '../services/lyricsApi';
import { usePlayer } from '../stores/playerStore';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback } from '../utils/haptics';
import type { LyricsData, LyricsErrorCode, LyricsLine, Song } from '../types';

type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; data: LyricsData }
  | { phase: 'error'; code: LyricsErrorCode; message: string };


/** item minHeight — FlatList tap target consistent */
const LineButtonMinHeight = 48;

export default function LyricsScreen() {
  return (
    <LyricsGate>
      <LyricsContent />
    </LyricsGate>
  );
}

function LyricsContent() {
  const insets = useSafeAreaInsets();

  const currentSong = usePlayer(s => s.currentSong);
  const position = usePlayer(s => s.position);
  const duration = usePlayer(s => s.duration);
  const seek = usePlayer(s => s.seek);

  const [state, setState] = useState<LoadState>({ phase: 'idle' });
  const [following, setFollowing] = useState(true);

  const listRef = useRef<FlatList<LyricsLine> | null>(null);
  const currentSongRef = useRef(currentSong);
  currentSongRef.current = currentSong;
  const requestId = useRef(0);
  /** last line already auto-scrolled — repeat scrollTo bachao */
  const scrolledTo = useRef(-1);

  const loadLyricsFor = useCallback(async (song: Song) => {
    const id = ++requestId.current;
    setState({ phase: 'loading' });
    setFollowing(true);
    scrolledTo.current = -1;
    try {
      const data = await fetchLyrics(song);
      if (id !== requestId.current) return;
      setState({ phase: 'ok', data });
    } catch (err) {
      if (id !== requestId.current) return;
      setState({
        phase: 'error',
        code: err instanceof LyricsError ? err.code : 'network',
        message: describeLyricsError(err),
      });
    }
  }, []);

  /* ---------- fetch (song-id change pe hi) ---------- */
  const songId = currentSong?.id ?? '';
  useEffect(() => {
    const song = currentSongRef.current;
    if (!song) {
      requestId.current += 1;
      setState({ phase: 'idle' });
      return;
    }
    void loadLyricsFor(song);
    return () => {
      requestId.current += 1;
    };
  }, [loadLyricsFor, songId]);

  /* ---------- current line (synced) / approx share (plain) ---------- */
  const activeIndex = useMemo(() => {
    if (state.phase !== 'ok') return -1;
    if (state.data.synced) return lineAt(state.data.lines, position);
    // unsynced — progress-share approx (duration 0 pe line 0 hi)
    if (duration <= 0 || state.data.lines.length === 0) return 0;
    const share = Math.min(1, Math.max(0, position / duration));
    return Math.min(state.data.lines.length - 1, Math.floor(share * state.data.lines.length));
  }, [state, position, duration]);

  /* ---------- scroll-follow latch ---------- */
  useEffect(() => {
    if (!following || activeIndex < 0 || state.phase !== 'ok') return;
    if (scrolledTo.current === activeIndex) return;
    scrolledTo.current = activeIndex;
    listRef.current?.scrollToIndex({
      index: activeIndex,
      animated: true,
      viewPosition: 0.5,
    });
  }, [activeIndex, following, state.phase]);

  const handleScrollBeginDrag = useCallback(() => {
    setFollowing(false); // user ne khud scroll ki — follow rukta
  }, []);

  const canSeekLines = state.phase === 'ok' && state.data.synced;

  /* ---------- tap line → seek (synced hi; pehli line 0ms bhi valid) ---------- */
  const handleTapLine = useCallback(
    (line: LyricsLine) => {
      if (!canSeekLines) return;
      tapFeedback();
      void seek(line.timeMs);
    },
    [canSeekLines, seek],
  );

  const renderLine = useCallback(
    ({ item, index }: { item: LyricsLine; index: number }) => {
      const isActive = index === activeIndex;
      return (
        <Pressable
          onPress={() => handleTapLine(item)}
          disabled={!canSeekLines}
          accessibilityRole={canSeekLines ? 'button' : 'text'}
          accessibilityLabel={canSeekLines ? `Seek line: ${item.text}` : item.text}
          accessibilityState={{ selected: isActive, disabled: !canSeekLines }}
          style={({ pressed }) => [
            styles.lineButton,
            pressed && styles.linePressed,
          ]}
        >
          <Text style={isActive ? styles.lineActive : styles.lineRegular}>
            {item.text}
          </Text>
        </Pressable>
      );
    },
    [activeIndex, canSeekLines, handleTapLine],
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

  const handleRetry = useCallback(() => {
    tapFeedback();
    if (!currentSong) return;
    void loadLyricsFor(currentSong);
  }, [currentSong, loadLyricsFor]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.header}>
          <Pressable
            onPress={router.back}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Lyrics band karo"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-down" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.title} numberOfLines={2}>
              {currentSong?.title ?? 'Lyrics'}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {currentSong?.artist ?? ''}
            </Text>
          </View>
          {!following ? (
            <Pressable
              onPress={() => {
                tapFeedback();
                scrolledTo.current = -1;
                setFollowing(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Follow wapas on karo"
              style={({ pressed }) => [styles.followChip, pressed && styles.pressed]}
            >
              <Ionicons name="locate" size={14} color={colors.primary} />
              <Text style={styles.followText}>Follow</Text>
            </Pressable>
          ) : null}
        </View>

        {state.phase === 'loading' && <LoadingSpinner label="Lyrics dhoond rahe…" />}

        {state.phase === 'error' && (
          <EmptyState
            icon={state.code === 'not_found' ? 'document-text-outline' : 'cloud-offline-outline'}
            title={state.code === 'not_found' ? 'Lyrics nahi mile' : 'Lyrics load nahi hue'}
            subtitle={state.message}
          >
            <Pressable
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Dobara try karo"
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </EmptyState>
        )}

        {state.phase === 'ok' && (
          <>
            {!state.data.synced && (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={15} color={colors.subtext} />
                <Text style={styles.noticeText}>
                  Synced timing nahi mili — approx highlight. Line tap se seek nahi hota.
                </Text>
              </View>
            )}
            <FlatList
              ref={listRef}
              data={state.data.lines}
              keyExtractor={(item, index) => `${index}-${item.timeMs}`}
              renderItem={renderLine}
              extraData={activeIndex}
              initialNumToRender={16}
              maxToRenderPerBatch={12}
              windowSize={9}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              contentContainerStyle={{
                paddingBottom: insets.bottom + spacing.xl,
                paddingHorizontal: spacing.xl,
              }}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}

        {state.phase === 'idle' && (
          <EmptyState
            icon="musical-notes-outline"
            title="Abhi kuch play nahi ho raha"
            subtitle="Player me song chuna — lyrics usi song ke dikhenge"
          />
        )}
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
    paddingBottom: spacing.sm,
  },
  headerInfo: { flex: 1 },
  iconButton: { padding: spacing.xs },
  pressed: { opacity: 0.7 },
  title: { ...typography.h2, color: colors.text },
  artist: { ...typography.caption, color: colors.subtext },
  followChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  followText: { ...typography.caption, color: colors.primary },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  noticeText: { ...typography.caption, color: colors.subtext, flex: 1 },
  lineButton: {
    paddingVertical: spacing.sm,
    minHeight: LineButtonMinHeight,
  },
  linePressed: { opacity: 0.8 },
  lineRegular: { ...typography.h2, color: colors.subtext },
  lineActive: { ...typography.h2, color: colors.text },
  retryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 22,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background },
});
