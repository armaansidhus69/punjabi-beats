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
import Toast from 'react-native-toast-message';
import LyricsGate from '../components/LyricsGate';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import { lineAt, lyricsExcerpt, selectionRange, transliterateToGurmukhi } from '../core/lyrics/lyrics';
import { fetchLyrics, describeLyricsError, LyricsError } from '../services/lyricsApi';
import { shareLyrics } from '../services/shareComposerFacade';
import { usePlayer } from '../stores/playerStore';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { selectionFeedback, tapFeedback, warningFeedback } from '../utils/haptics';
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
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showGurmukhi, setShowGurmukhi] = useState(false);

  const listRef = useRef<FlatList<LyricsLine> | null>(null);
  const currentSongRef = useRef(currentSong);
  currentSongRef.current = currentSong;
  const requestId = useRef(0);
  const followBeforeSelection = useRef(true);
  const suppressedPressIndex = useRef<number | null>(null);
  /** last line already auto-scrolled — repeat scrollTo bachao */
  const scrolledTo = useRef(-1);

  const loadLyricsFor = useCallback(async (song: Song) => {
    const id = ++requestId.current;
    setState({ phase: 'loading' });
    setFollowing(true);
    setSelectionAnchor(null);
    setSelectedIndices([]);
    setSharing(false);
    followBeforeSelection.current = true;
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
  const selecting = selectionAnchor !== null;

  /* ---------- tap line → seek (synced hi; pehli line 0ms bhi valid) ---------- */
  const handleTapLine = useCallback(
    (line: LyricsLine) => {
      if (!canSeekLines) return;
      tapFeedback();
      void seek(line.timeMs);
    },
    [canSeekLines, seek],
  );

  const handleLongPressLine = useCallback(
    (index: number) => {
      if (state.phase !== 'ok') return;
      suppressedPressIndex.current = index;
      const excerpt = lyricsExcerpt(state.data.lines, [index], state.data.synced);
      if (!excerpt) {
        warningFeedback();
        Toast.show({ type: 'error', text1: 'Ye line share limit se badi hai' });
        return;
      }
      if (selectionAnchor === null) followBeforeSelection.current = following;
      setFollowing(false);
      setSelectionAnchor(index);
      setSelectedIndices([index]);
      selectionFeedback();
    },
    [following, selectionAnchor, state],
  );

  const handleSelectLine = useCallback(
    (index: number) => {
      if (state.phase !== 'ok' || selectionAnchor === null) return;
      const range = selectionRange(selectionAnchor, index, state.data.lines.length);
      const excerpt = range
        ? lyricsExcerpt(state.data.lines, range, state.data.synced)
        : null;
      if (!range || !excerpt) {
        warningFeedback();
        Toast.show({
          type: 'error',
          text1: 'Max 4 contiguous lines / 280 chars share kar sakte ho',
        });
        return;
      }
      selectionFeedback();
      setSelectedIndices(range);
    },
    [selectionAnchor, state],
  );

  const clearSelection = useCallback((restoreFollow: boolean) => {
    setSelectionAnchor(null);
    setSelectedIndices([]);
    suppressedPressIndex.current = null;
    if (restoreFollow) setFollowing(followBeforeSelection.current);
  }, []);

  const handleShareSelection = useCallback(async () => {
    if (state.phase !== 'ok' || !currentSong || sharing) return;
    const excerpt = lyricsExcerpt(state.data.lines, selectedIndices, state.data.synced);
    if (!excerpt) {
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Valid lyric lines select karo' });
      return;
    }
    setSharing(true);
    try {
      const shared = await shareLyrics(currentSong, excerpt.lines, excerpt.startMs);
      if (shared) clearSelection(true);
    } finally {
      setSharing(false);
    }
  }, [clearSelection, currentSong, selectedIndices, sharing, state]);

  const renderLine = useCallback(
    ({ item, index }: { item: LyricsLine; index: number }) => {
      const isActive = index === activeIndex;
      const isSelected = selectedIndices.includes(index);
      return (
        <Pressable
          onPress={() => {
            if (suppressedPressIndex.current === index) {
              suppressedPressIndex.current = null;
              return;
            }
            if (selecting) handleSelectLine(index);
            else handleTapLine(item);
          }}
          onLongPress={() => handleLongPressLine(index)}
          onPressOut={() => {
            setTimeout(() => {
              if (suppressedPressIndex.current === index) suppressedPressIndex.current = null;
            }, 0);
          }}
          delayLongPress={450}
          disabled={state.phase !== 'ok'}
          accessibilityRole="button"
          accessibilityLabel={
            selecting
              ? `Lyric line select karo: ${item.text}`
              : canSeekLines
                ? `Seek line: ${item.text}; long press to share`
                : `${item.text}; long press to share`
          }
          accessibilityState={{ selected: isSelected || isActive }}
          style={({ pressed }) => [
            styles.lineButton,
            isSelected && styles.lineSelected,
            pressed && styles.linePressed,
          ]}
        >
          <Text
            style={[
              isActive ? styles.lineActive : styles.lineRegular,
              isSelected && styles.lineSelectedText,
              showGurmukhi && styles.gurmukhiText,
            ]}
          >
            {showGurmukhi
              ? (item.gurmukhi || transliterateToGurmukhi(item.text))
              : item.text}
          </Text>
        </Pressable>
      );
    },
    [
      activeIndex,
      canSeekLines,
      handleLongPressLine,
      handleSelectLine,
      handleTapLine,
      selectedIndices,
      selecting,
      showGurmukhi,
      state.phase,
    ],
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
          {selecting ? (
            <Pressable
              onPress={() => {
                selectionFeedback();
                clearSelection(true);
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Lyrics selection cancel karo"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          ) : (
          <Pressable
            onPress={router.back}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Lyrics band karo"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-down" size={24} color={colors.text} />
          </Pressable>
          )}
          <View style={styles.headerInfo}>
            {selecting ? (
              <>
                <Text style={styles.title}>{selectedIndices.length}/4 lines</Text>
                <Text style={styles.artist}>Tap karke contiguous range adjust karo</Text>
              </>
            ) : (
              <>
                <Text style={styles.title} numberOfLines={2}>
                  {currentSong?.title ?? 'Lyrics'}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {currentSong?.artist ?? ''}
                </Text>
              </>
            )}
          </View>
          {selecting ? (
            <Pressable
              onPress={() => void handleShareSelection()}
              disabled={sharing || selectedIndices.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Selected lyrics share karo"
              style={({ pressed }) => [
                styles.shareButton,
                pressed && styles.pressed,
                (sharing || selectedIndices.length === 0) && styles.disabled,
              ]}
            >
              <Ionicons name="share-outline" size={18} color={colors.background} />
              <Text style={styles.shareText}>{sharing ? 'Wait…' : 'Share'}</Text>
            </Pressable>
          ) : (
            <View style={styles.headerRightControls}>
              <Pressable
                onPress={() => {
                  tapFeedback();
                  setShowGurmukhi(prev => !prev);
                }}
                accessibilityRole="button"
                accessibilityLabel="Gurmukhi script toggle"
                style={({ pressed }) => [
                  styles.scriptChip,
                  showGurmukhi && styles.scriptChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.scriptText, showGurmukhi && styles.scriptTextActive]}>
                  {showGurmukhi ? 'ਪੰਜਾਬੀ' : 'EN'}
                </Text>
              </Pressable>

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
          )}
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
  headerRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scriptChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  scriptChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scriptText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  scriptTextActive: {
    color: colors.background,
  },
  gurmukhiText: {
    fontSize: 22,
    lineHeight: 34,
  },
  iconButton: { padding: spacing.xs },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
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
  lineSelected: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
  },
  lineRegular: { ...typography.h2, color: colors.subtext },
  lineActive: { ...typography.h2, color: colors.text },
  lineSelectedText: { color: colors.primary },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  shareText: { ...typography.caption, color: colors.background, fontWeight: '700' },
  retryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 22,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background },
});
