/**
 * Full player - /player route (Phase 8, modal).
 *
 * MiniPlayer yahin route karta hai. Native-stack modal hone ki wajah se:
 *  - iOS pe native swipe-down-to-close milta hai (gestureEnabled default true)
 *  - Android pe native gesture nahi hai, isliye neeche PanResponder se
 *    "swipe down to close" implement kiya (FR-6.6 - dono platforms pe kaam)
 *
 * Seek yahan se jaata hai -> playerStore.seek() -> store ka action listener
 * (Phase 11 room sync) automatically broadcast kar deta hai, isliye is file me
 * real-time ka koi code nahi hai.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../stores/playerStore';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';
import PlayerControls from '../components/PlayerControls';
import ProgressBar from '../components/ProgressBar';
import SongArtwork from '../components/SongArtwork';
import { handleOpenOnYouTube, isYouTubeMatchConfigured } from '../utils/youtubeLink';

/** Swipe-down close threshold (px aur velocity) */
const CLOSE_SWIPE_THRESHOLD = 110;
const CLOSE_SWIPE_VELOCITY = 1.2;
/** Album art ke ek full chakkar ka time (FR-6.7) */
const ROTATION_DURATION_MS = 14000;
/** CHECKLIST Phase 8: large album art (250x250) — chhoti screens pe width se clamp */
const ARTWORK_MAX_SIZE = 250;

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const currentSong = usePlayer(s => s.currentSong);
  const queueLength = usePlayer(s => s.queue.length);
  const isPlaying = usePlayer(s => s.isPlaying);
  const position = usePlayer(s => s.position);
  const duration = usePlayer(s => s.duration);
  const shuffle = usePlayer(s => s.shuffle);
  const repeat = usePlayer(s => s.repeat);

  const togglePlay = usePlayer(s => s.togglePlay);
  const playNext = usePlayer(s => s.playNext);
  const playPrev = usePlayer(s => s.playPrev);
  const seek = usePlayer(s => s.seek);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const cycleRepeat = usePlayer(s => s.cycleRepeat);
  const volume = usePlayer(s => s.volume);
  const setVolume = usePlayer(s => s.setVolume);

  /* ---------- Album art rotation (sirf playing me ghoomta hai) ---------- */
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isPlaying) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: ROTATION_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [isPlaying, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  /* ---------- Swipe down to close (Android + iOS dono) ---------- */
  const close = useCallback(() => {
    router.back();
  }, []);

  /* ---------- Share song (Phase 14 — React Native Share API) ---------- */
  const handleShare = useCallback(() => {
    if (!currentSong) return;
    const message =
      `"${currentSong.title}" — ${currentSong.artist}\n` +
      `Punjabi Beats pe suno: ${currentSong.preview}`;
    Share.share({ message }).catch(err => console.warn('Share failed:', err));
  }, [currentSong]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Sirf clear neeche-wale drag pe claim karo, warna ProgressBar ka
        // horizontal drag/tap bhi hijack ho jaayega
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > CLOSE_SWIPE_THRESHOLD || gesture.vy > CLOSE_SWIPE_VELOCITY) close();
        },
      }),
    [close],
  );

  const handleSeek = useCallback(
    (positionMs: number) => {
      void seek(positionMs);
    },
    [seek],
  );

  /* ---------- Koi song nahi (deep link se seedha /player khula) ---------- */
  if (!currentSong) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
        <PlayerHeader onClose={close} />
        <EmptyState
          icon="musical-notes-outline"
          title="Abhi kuch play nahi ho raha"
          subtitle="Home ya Search se koi song chuno"
        />
      </View>
    );
  }

  const artworkSize = Math.min(width - spacing.xl * 2, ARTWORK_MAX_SIZE);
  const repeatActive = repeat !== 'off';

  return (
    <View
      style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
      {...panResponder.panHandlers}
    >
      <PlayerHeader onClose={close} onShare={handleShare} />

      {/* Drag handle - swipe down ka visual hint (FR-6.6) */}
      <View style={styles.handle} />

      {/* Album art - disc ki tarah ghoomta hai jab song chal raha ho */}
      <View style={styles.artworkWrap}>
        <Animated.View style={[styles.artworkDisc, { transform: [{ rotate }] }]}>
          <SongArtwork uri={currentSong.cover} size={artworkSize} radius={artworkSize / 2} />
        </Animated.View>
      </View>

      {/* Song title + artist */}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {currentSong.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {currentSong.artist}
        </Text>
        {queueLength > 1 ? (
          <Text style={styles.queueInfo}>Queue me {queueLength} songs</Text>
        ) : null}
      </View>

      {/* Seek bar - drag to seek (FR-2.5) + current/total time (FR-2.6) */}
      <View style={styles.progressSection}>
        <ProgressBar position={position} duration={duration} onSeek={handleSeek} showTimes />
      </View>

      {/* iTunes 30s preview note (FR-2.8 ke alawa full song nahi milta).
          Ab YouTube link-out bhi yahan hai — scored match (exact/partial) se
          full version kholta hai. WebView player NAHI (room sync + background
          play bachane ke liye — utils/youtubeLink.ts header dekho). */}
      {currentSong.previewOnly ? (
        <View style={styles.previewNoteWrap}>
          <Text style={styles.previewNote}>Preview mode — full song abhi available nahi</Text>
          {isYouTubeMatchConfigured() ? (
            <Pressable
              onPress={() => handleOpenOnYouTube(currentSong)}
              accessibilityRole="button"
              accessibilityLabel="YouTube pe full version kholo"
              style={({ pressed }) => [styles.youtubeButton, pressed && styles.pressed]}
            >
              <Ionicons name="logo-youtube" size={18} color={colors.background} />
              <Text style={styles.youtubeButtonText}>Full version on YouTube</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Volume slider (FR-2.11) — sirf local device, room sync me kabhi broadcast nahi */}
      <VolumeSlider value={volume} onChange={setVolume} />

      {/* Play/pause/next/prev + shuffle/repeat (FR-2.9, FR-2.10).
          Shuffle/repeat buttons PlayerControls khud render karta hai (haptics bhi wahi). */}
      <View style={styles.controls}>
        <PlayerControls
          isPlaying={isPlaying}
          onPlayPause={() => {
            void togglePlay();
          }}
          onNext={() => {
            void playNext();
          }}
          onPrev={() => {
            void playPrev();
          }}
          onToggleShuffle={toggleShuffle}
          onToggleRepeat={cycleRepeat}
          shuffleOn={shuffle}
          repeatOn={repeatActive}
        />
      </View>
    </View>
  );
}



/** Header — chevron down se close (modal feel) + share (Phase 14, optional) */
function PlayerHeader({ onClose, onShare }: { onClose: () => void; onShare?: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Player band karo"
        hitSlop={12}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-down" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.headerCenter}>
        <Text style={styles.headerLabel}>Now Playing</Text>
      </View>
      {onShare ? (
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Song share karo"
          hitSlop={12}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="share-outline" size={20} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.iconButton} />
      )}
    </View>
  );
}

/**
 * Volume slider (FR-2.11 — Phase 14) — thin bar, tap/drag se 0..1.
 * PanResponder pattern (ProgressBar jaisa) — koi nayi dependency nahi.
 * Horizontal drag close-gesture (vertical swipe) ko hijack nahi karta.
 */
function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const widthRef = useRef(0);

  const updateFromX = useCallback(
    (x: number) => {
      const width = widthRef.current;
      if (width <= 0) return;
      onChange(Math.min(1, Math.max(0, x / width)));
    },
    [onChange],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true, // tap se bhi set ho (grant me update)
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 3 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: event => updateFromX(event.nativeEvent.locationX),
        onPanResponderMove: event => updateFromX(event.nativeEvent.locationX),
      }),
    [updateFromX],
  );

  const clamped = Math.min(1, Math.max(0, value));

  return (
    <View style={styles.volumeRow}>
      <Ionicons
        name={
          clamped < 0.05
            ? 'volume-mute-outline'
            : clamped < 0.5
              ? 'volume-low-outline'
              : 'volume-high-outline'
        }
        size={18}
        color={colors.subtext}
      />
      <View
        style={styles.volumeTrackWrap}
        onLayout={event => {
          widthRef.current = event.nativeEvent.layout.width;
          setTrackWidth(event.nativeEvent.layout.width);
        }}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Volume"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      >
        <View style={styles.volumeTrack} />
        <View style={[styles.volumeFill, { width: `${Math.round(clamped * 100)}%` }]} />
        <View
          style={[styles.volumeThumb, { left: Math.max(0, trackWidth * clamped - 7) }]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLabel: { ...typography.caption, color: colors.subtext, letterSpacing: 1.5 },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  artworkWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artworkDisc: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    backgroundColor: colors.surface,
    shadowColor: colors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  meta: { paddingHorizontal: spacing.xl, alignItems: 'center' },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  artist: { ...typography.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.xs },
  queueInfo: { ...typography.caption, color: colors.primary, marginTop: spacing.sm },
  progressSection: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  previewNote: {
    ...typography.caption,
    color: colors.subtext,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  previewNoteWrap: { alignItems: 'center', gap: spacing.sm },
  youtubeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  youtubeButtonText: { ...typography.caption, color: colors.background, fontWeight: '700' },
  controls: { marginTop: spacing.xl, marginBottom: spacing.xl },
  /* Volume slider (FR-2.11) */
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  volumeTrackWrap: { flex: 1, height: 28, justifyContent: 'center' },
  volumeTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  volumeFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  volumeThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.text,
  },
  pressed: { opacity: 0.6 },
});
