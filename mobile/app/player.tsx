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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../stores/playerStore';
import { useLikedSongs } from '../stores/likedSongsStore';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';
import PlayerControls from '../components/PlayerControls';
import ProgressBar from '../components/ProgressBar';
import SongArtwork from '../components/SongArtwork';
import { isYouTubeMatchConfigured, openYouTubeSearch, resolveYouTubeMatch } from '../utils/youtubeLink';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { shareTrack } from '../services/shareComposerFacade';

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
  const likedSongs = useLikedSongs(s => s.songs);
  const toggleLiked = useLikedSongs(s => s.toggleLiked);

  const togglePlay = usePlayer(s => s.togglePlay);
  const playNext = usePlayer(s => s.playNext);
  const playPrev = usePlayer(s => s.playPrev);
  const seek = usePlayer(s => s.seek);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const cycleRepeat = usePlayer(s => s.cycleRepeat);
  const volume = usePlayer(s => s.volume);
  const setVolume = usePlayer(s => s.setVolume);

  const isLiked = currentSong ? likedSongs.some(song => song.id === currentSong.id) : false;
  const lyricsEnabled = isFeatureEnabled('lyrics_enabled');

  const [inAppYouTubeVideoId, setInAppYouTubeVideoId] = useState<string | null>(null);
  const [isResolvingYouTube, setIsResolvingYouTube] = useState(false);
  const [youTubeDuration, setYouTubeDuration] = useState<number | null>(null);
  const [youTubePosition, setYouTubePosition] = useState(0);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState(false);
  const iframeRef = useRef<any>(null);

  // Auto-resolve YouTube match for preview tracks
  useEffect(() => {
    let active = true;
    setInAppYouTubeVideoId(null);
    setYouTubeDuration(null);
    setYouTubePosition(0);
    setIsYouTubePlaying(false);

    if (currentSong?.previewOnly) {
      setIsResolvingYouTube(true);
      resolveYouTubeMatch(currentSong)
        .then(match => {
          if (!active) return;
          setIsResolvingYouTube(false);
          if (match?.videoId) {
            if (Platform.OS === 'web') {
              // Pause 30s preview so full YouTube version plays cleanly
              void usePlayer.getState().pause();
              setInAppYouTubeVideoId(match.videoId);
              setIsYouTubePlaying(true);
              if (match.durationSec) {
                setYouTubeDuration(match.durationSec * 1000);
              }
              Toast.show({
                type: 'success',
                text1: 'Full version auto-playing (YouTube)',
                text2: match.title ?? currentSong.title,
                visibilityTime: 2500,
              });
            }
          }
        })
        .catch(err => {
          if (!active) return;
          setIsResolvingYouTube(false);
          console.warn('[player] Auto YouTube match failed:', err);
        });
    }

    return () => {
      active = false;
    };
  }, [currentSong]);

  // Listen to YouTube player state changes via postMessage (Web)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.event === 'onStateChange') {
          if (data.info === 0) {
            // Track ended -> play next
            void playNext();
          } else if (data.info === 1) {
            setIsYouTubePlaying(true);
          } else if (data.info === 2) {
            setIsYouTubePlaying(false);
          }
        } else if (data?.event === 'infoDelivery' && typeof data.info?.currentTime === 'number') {
          setYouTubePosition(data.info.currentTime * 1000);
          if (typeof data.info.duration === 'number' && data.info.duration > 0) {
            setYouTubeDuration(data.info.duration * 1000);
          }
        }
      } catch {
        // ignore non-json messages
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [playNext]);

  // Position increment ticker while YouTube is playing
  useEffect(() => {
    if (!inAppYouTubeVideoId || !isYouTubePlaying || Platform.OS !== 'web') return;
    const interval = setInterval(() => {
      setYouTubePosition(pos => {
        if (youTubeDuration && pos >= youTubeDuration) {
          void playNext();
          return pos;
        }
        return pos + 500;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [inAppYouTubeVideoId, isYouTubePlaying, youTubeDuration, playNext]);

  const handlePlayFullInApp = useCallback(async () => {
    if (!currentSong) return;
    tapFeedback();
    setIsResolvingYouTube(true);
    void usePlayer.getState().pause();

    try {
      const match = await resolveYouTubeMatch(currentSong);
      if (match?.videoId) {
        if (Platform.OS === 'web') {
          setInAppYouTubeVideoId(match.videoId);
          setIsYouTubePlaying(true);
          if (match.durationSec) {
            setYouTubeDuration(match.durationSec * 1000);
          }
          successFeedback();
        } else {
          await WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${match.videoId}`, {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
            toolbarColor: colors.background,
            controlsColor: colors.primary,
          });
        }
      } else {
        warningFeedback();
        Toast.show({
          type: 'info',
          text1: 'Full version match nahi mila',
          text2: 'YouTube pe search khol rahe hain...',
        });
        openYouTubeSearch(currentSong);
      }
    } catch (err) {
      console.warn('[player] In-app YouTube match failed:', err);
      openYouTubeSearch(currentSong);
    } finally {
      setIsResolvingYouTube(false);
    }
  }, [currentSong]);

  const handleToggleLiked = useCallback(() => {
    if (!currentSong) return;
    const liked = toggleLiked(currentSong);
    if (liked) successFeedback();
    else warningFeedback();
  }, [currentSong, toggleLiked]);

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

  /* ---------- Share song (Phase 8a signed link; flag-off legacy fallback) ---------- */
  const handleShare = useCallback(() => {
    if (!currentSong) return;
    void shareTrack(currentSong);
  }, [currentSong]);

  const handleLyrics = useCallback(() => {
    tapFeedback();
    router.push('/lyrics');
  }, []);

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
      if (inAppYouTubeVideoId && Platform.OS === 'web') {
        setYouTubePosition(positionMs);
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'seekTo', args: [positionMs / 1000, true] }),
            '*',
          );
        }
      } else {
        void seek(positionMs);
      }
    },
    [inAppYouTubeVideoId, seek],
  );

  const handlePlayPause = useCallback(() => {
    if (inAppYouTubeVideoId && Platform.OS === 'web') {
      const nextPlaying = !isYouTubePlaying;
      setIsYouTubePlaying(nextPlaying);
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: nextPlaying ? 'playVideo' : 'pauseVideo',
            args: [],
          }),
          '*',
        );
      }
    } else {
      void togglePlay();
    }
  }, [inAppYouTubeVideoId, isYouTubePlaying, togglePlay]);

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
  const embedWidth = Math.min(width - spacing.xl * 2, 380);
  const embedHeight = Math.round((embedWidth * 9) / 16) + 38;
  const repeatActive = repeat !== 'off';

  const activePosition = inAppYouTubeVideoId ? youTubePosition : position;
  const activeDuration =
    inAppYouTubeVideoId && youTubeDuration
      ? youTubeDuration
      : currentSong?.previewOnly && youTubeDuration
        ? youTubeDuration
        : currentSong?.previewOnly
          ? 161_000
          : duration;
  const activePlaying = inAppYouTubeVideoId ? isYouTubePlaying : isPlaying;

  return (
    <View
      style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
      {...panResponder.panHandlers}
    >
      <PlayerHeader
        onClose={close}
        onShare={handleShare}
        onLike={handleToggleLiked}
        onLyrics={lyricsEnabled ? handleLyrics : undefined}
        isLiked={isLiked}
      />

      {/* Drag handle - swipe down ka visual hint (FR-6.6) */}
      <View style={styles.handle} />

      {/* Album art ya In-App YouTube player (web pe embed) */}
      {inAppYouTubeVideoId && Platform.OS === 'web' ? (
        <View style={[styles.youtubeEmbedWrap, { width: embedWidth, height: embedHeight }]}>
          <View style={styles.youtubeEmbedHeader}>
            <View style={styles.youtubeBadgeRow}>
              <Ionicons name="logo-youtube" size={16} color="#ff0000" />
              <Text style={styles.youtubeBadgeText} numberOfLines={1}>
                In-App Full Song • YouTube
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setInAppYouTubeVideoId(null);
                void usePlayer.getState().play();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Audio player te vapas jao"
              style={styles.closeEmbedBtn}
            >
              <Ionicons name="close-circle" size={22} color={colors.subtext} />
            </Pressable>
          </View>
          <View style={styles.iframeBox}>
            {React.createElement('iframe', {
              ref: iframeRef,
              src: `https://www.youtube.com/embed/${inAppYouTubeVideoId}?autoplay=1&enablejsapi=1&playsinline=1`,
              title: currentSong.title,
              style: {
                width: '100%',
                height: '100%',
                border: 'none',
              },
              allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
              allowFullScreen: true,
            })}
          </View>
        </View>
      ) : (
        <View style={styles.artworkWrap}>
          <Animated.View style={[styles.artworkDisc, { transform: [{ rotate }] }]}>
            <SongArtwork uri={currentSong.cover} size={artworkSize} radius={artworkSize / 2} />
          </Animated.View>
        </View>
      )}

      {/* Song title + artist */}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {currentSong.title}
        </Text>
        <Pressable
          onPress={() => {
            if (currentSong.artist) {
              tapFeedback();
              router.push(`/artist/${encodeURIComponent(currentSong.artist)}`);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={`Artist ${currentSong.artist} page`}
        >
          <Text style={styles.artist} numberOfLines={1}>
            {currentSong.artist}
          </Text>
        </Pressable>
        {queueLength > 1 ? (
          <Text style={styles.queueInfo}>Queue me {queueLength} songs</Text>
        ) : null}
      </View>

      {/* Seek bar - drag to seek (FR-2.5) + current/total time (FR-2.6) */}
      <View style={styles.progressSection}>
        <ProgressBar position={activePosition} duration={activeDuration} onSeek={handleSeek} showTimes />
      </View>

      {/* iTunes 30s preview note (FR-2.8 ke alawa full song nahi milta).
          Ab YouTube link-out bhi yahan hai — scored match (exact/partial) se
          full version kholta hai. WebView player NAHI (room sync + background
          play bachane ke liye — utils/youtubeLink.ts header dekho). */}
      {currentSong.previewOnly ? (
        <View style={styles.previewNoteWrap}>
          <Text style={styles.previewNote}>
            {inAppYouTubeVideoId
              ? '▶ Playing Full Song in App (YouTube)'
              : isResolvingYouTube
                ? 'Matching full song from YouTube...'
                : 'Full version via YouTube'}
          </Text>
          {isYouTubeMatchConfigured() ? (
            <Pressable
              onPress={
                inAppYouTubeVideoId
                  ? () => {
                      setInAppYouTubeVideoId(null);
                      void usePlayer.getState().play();
                    }
                  : handlePlayFullInApp
              }
              disabled={isResolvingYouTube}
              accessibilityRole="button"
              accessibilityLabel="App vich full song play karo"
              style={({ pressed }) => [styles.youtubeButton, pressed && styles.pressed]}
            >
              {isResolvingYouTube ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Ionicons
                  name={inAppYouTubeVideoId ? 'disc' : 'play-circle'}
                  size={18}
                  color={colors.background}
                />
              )}
              <Text style={styles.youtubeButtonText}>
                {isResolvingYouTube
                  ? 'Matching full song...'
                  : inAppYouTubeVideoId
                    ? 'Switch back to Audio Disc'
                    : '▶ Play Full Song (YouTube)'}
              </Text>
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
          isPlaying={activePlaying}
          onPlayPause={handlePlayPause}
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



/** Header — close + liked toggle + share actions */
function PlayerHeader({
  onClose,
  onShare,
  onLike,
  onLyrics,
  isLiked = false,
}: {
  onClose: () => void;
  onShare?: () => void;
  onLike?: () => void;
  onLyrics?: () => void;
  isLiked?: boolean;
}) {
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
      <View style={styles.headerActions}>
        {onLyrics ? (
          <Pressable
            onPress={onLyrics}
            accessibilityRole="button"
            accessibilityLabel="Lyrics kholo"
            hitSlop={12}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="document-text-outline" size={20} color={colors.text} />
          </Pressable>
        ) : null}
        {onLike ? (
          <Pressable
            onPress={onLike}
            accessibilityRole="button"
            accessibilityLabel={isLiked ? 'Liked songs se hatao' : 'Liked songs me add karo'}
            accessibilityState={{ selected: isLiked }}
            hitSlop={12}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons
              name={isLiked ? 'heart' : 'heart-outline'}
              size={21}
              color={isLiked ? colors.primary : colors.text}
            />
          </Pressable>
        ) : null}
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
        ) : null}
      </View>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  youtubeEmbedWrap: {
    alignSelf: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
    borderRadius: 16,
    backgroundColor: '#0a0a0c',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  youtubeEmbedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: '#16161d',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  youtubeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  youtubeBadgeText: {
    ...typography.caption,
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  closeEmbedBtn: {
    padding: 2,
  },
  iframeBox: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
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
