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
  Animated,
  Easing,
  Modal,
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
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { usePlayer } from '../stores/playerStore';
import { useLikedSongs } from '../stores/likedSongsStore';
import { useSleepTimer } from '../stores/sleepTimerStore';
import { useDownloads } from '../services/downloadsService';
import { buildRadioQueue } from '../services/radioService';
import {
  SLEEP_OPTIONS,
  formatSleepRemaining,
  type SleepMode,
} from '../core/playback/sleepTimer';
import { colors, sourceColor, sourceLabel } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';
import PlayerControls from '../components/PlayerControls';
import ProgressBar from '../components/ProgressBar';
import SongArtwork from '../components/SongArtwork';
import { resolveYouTubeMatch } from '../utils/youtubeLink';
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
  const playSong = usePlayer(s => s.playSong);
  const playNext = usePlayer(s => s.playNext);
  const playPrev = usePlayer(s => s.playPrev);
  const seek = usePlayer(s => s.seek);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const cycleRepeat = usePlayer(s => s.cycleRepeat);
  const volume = usePlayer(s => s.volume);
  const setVolume = usePlayer(s => s.setVolume);

  const isLiked = currentSong ? likedSongs.some(song => song.id === currentSong.id) : false;
  const lyricsEnabled = isFeatureEnabled('lyrics_enabled');
  const downloadsEnabled = isFeatureEnabled('downloads_enabled');

  /* Phase 5/6 — Radio, Sleep timer, Download */
  const [radioLoading, setRadioLoading] = useState(false);
  const [sleepVisible, setSleepVisible] = useState(false);
  const sleepMode = useSleepTimer(s => s.mode);
  const sleepEndsAt = useSleepTimer(s => s.endsAt);
  const startSleep = useSleepTimer(s => s.start);
  const [sleepRemaining, setSleepRemaining] = useState<string | null>(null);
  const downloadItem = useDownloads(s =>
    currentSong ? s.items.find(entry => entry.id === currentSong.id) ?? null : null,
  );
  const downloadSong = useDownloads(s => s.download);

  useEffect(() => {
    if (sleepMode === 'off' || sleepMode === 'end_of_track' || sleepEndsAt === null) {
      setSleepRemaining(null);
      return;
    }
    const tick = setInterval(() => {
      setSleepRemaining(formatSleepRemaining(sleepEndsAt - Date.now()));
    }, 1000);
    setSleepRemaining(formatSleepRemaining(sleepEndsAt - Date.now()));
    return () => clearInterval(tick);
  }, [sleepMode, sleepEndsAt]);

  const handleRadio = useCallback(async () => {
    if (!currentSong || radioLoading) return;
    setRadioLoading(true);
    try {
      const radioQueue = await buildRadioQueue(currentSong);
      await playSong(currentSong, radioQueue);
      successFeedback();
      Toast.show({
        type: 'success',
        text1: 'Radio chalu 📻',
        text2: `${radioQueue.length} songs • ${currentSong.artist}`,
        visibilityTime: 2200,
      });
    } catch {
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Radio nahi ban paayi', text2: 'Thodi der baad try karo' });
    } finally {
      setRadioLoading(false);
    }
  }, [currentSong, radioLoading, playSong]);

  const handleDownload = useCallback(async () => {
    if (!currentSong) return;
    // Stream download check
    if (currentSong.previewOnly) {
      warningFeedback();
      Toast.show({ type: 'info', text1: 'Download available nahi hai', text2: 'Dusra track try karo' });
      return;
    }
    const ok = await downloadSong(currentSong);
    if (ok) successFeedback();
    else warningFeedback();
    Toast.show({
      type: ok ? 'success' : 'error',
      text1: ok ? 'Download ho gaya ✅' : 'Download fail hua',
      text2: currentSong.title,
      visibilityTime: 2000,
    });
  }, [currentSong, downloadSong]);

  const [inAppYouTubeVideoId, setInAppYouTubeVideoId] = useState<string | null>(null);
  const [youTubeDuration, setYouTubeDuration] = useState<number | null>(null);
  const [youTubePosition, setYouTubePosition] = useState(0);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Auto-resolve YouTube match for preview tracks
  useEffect(() => {
    let active = true;
    setInAppYouTubeVideoId(null);
    setYouTubeDuration(null);
    setYouTubePosition(0);
    setIsYouTubePlaying(false);

    if (currentSong?.previewOnly) {
      resolveYouTubeMatch(currentSong)
        .then(match => {
          if (!active) return;
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
                text1: 'Full version auto-playing',
                text2: match.title ?? currentSong.title,
                visibilityTime: 2500,
              });
            }
          }
        })
        .catch(err => {
          if (!active) return;
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

  // Sync volume to YouTube iframe
  useEffect(() => {
    if (inAppYouTubeVideoId && Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'setVolume', args: [Math.round(volume * 100)] }),
        '*',
      );
    }
  }, [inAppYouTubeVideoId, volume]);

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

  /* ---------- Album art rotation (sirf playing me ghoomta hai) ---------- */
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!activePlaying) return;
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
  }, [activePlaying, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const handleToggleLiked = useCallback(() => {
    if (!currentSong) return;
    const liked = toggleLiked(currentSong);
    if (liked) successFeedback();
    else warningFeedback();
  }, [currentSong, toggleLiked]);

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

  const handleVolumeChange = useCallback(
    (v: number) => {
      setVolume(v);
      if (inAppYouTubeVideoId && Platform.OS === 'web' && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [Math.round(v * 100)] }),
          '*',
        );
      }
    },
    [inAppYouTubeVideoId, setVolume],
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
      {/* Sunset glow — top se warm gradient, neeche midnight me fade */}
      <LinearGradient
        colors={['rgba(255, 81, 47, 0.20)', 'rgba(221, 36, 118, 0.10)', 'rgba(8, 8, 15, 0)']}
        style={styles.backgroundGlow}
        pointerEvents="none"
      />
      <PlayerHeader
        onClose={close}
        onShare={handleShare}
        onLike={handleToggleLiked}
        onLyrics={lyricsEnabled ? handleLyrics : undefined}
        isLiked={isLiked}
      />

      {/* Drag handle - swipe down ka visual hint (FR-6.6) */}
      <View style={styles.handle} />

      {/* Album art disc (always circular spinning vinyl) */}
      <View style={styles.artworkWrap}>
        <Animated.View style={[styles.artworkDisc, { transform: [{ rotate }] }]}>
          <SongArtwork uri={currentSong.cover} size={artworkSize} radius={artworkSize / 2} />
        </Animated.View>
      </View>

      {/* Background YouTube audio engine (invisible off-screen on web) */}
      {inAppYouTubeVideoId && Platform.OS === 'web' ? (
        <View style={styles.hiddenIframe}>
          {React.createElement('iframe', {
            ref: iframeRef,
            src: `https://www.youtube.com/embed/${inAppYouTubeVideoId}?autoplay=1&enablejsapi=1&playsinline=1`,
            title: currentSong.title,
            style: {
              width: '200px',
              height: '200px',
              border: 'none',
            },
            allow: 'autoplay; encrypted-media',
          })}
        </View>
      ) : null}

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
        {/* Source badge — kaun sa source baj raha hai (multi-source identity) */}
        {currentSong.source ? (
          <View
            style={[
              styles.sourceChip,
              { borderColor: `${sourceColor[currentSong.source] ?? colors.subtext}66` },
            ]}
          >
            <View
              style={[
                styles.sourceDot,
                { backgroundColor: sourceColor[currentSong.source] ?? colors.subtext },
              ]}
            />
            <Text
              style={[
                styles.sourceChipText,
                { color: sourceColor[currentSong.source] ?? colors.subtext },
              ]}
            >
              {sourceLabel[currentSong.source] ?? 'Music'} • Full song
            </Text>
          </View>
        ) : null}
        {queueLength > 1 ? (
          <Pressable
            onPress={() => router.push('/queue')}
            accessibilityRole="button"
            accessibilityLabel="Queue manage karo"
            hitSlop={8}
            style={({ pressed }) => [styles.queueLink, pressed && styles.pressed]}
          >
            <Text style={styles.queueInfo}>Queue me {queueLength} songs</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {/* Seek bar - drag to seek (FR-2.5) + current/total time (FR-2.6) */}
      <View style={styles.progressSection}>
        <ProgressBar position={activePosition} duration={activeDuration} onSeek={handleSeek} showTimes />
      </View>

      {/* Volume slider (FR-2.11) — sirf local device, room sync me kabhi broadcast nahi */}
      <VolumeSlider value={volume} onChange={handleVolumeChange} />

      {/* Play/pause/next/prev + shuffle/repeat (FR-2.9, FR-2.10) */}
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

      {/* Utility row — Radio / Sleep timer / Download (Phase 5+6) */}
      {currentSong ? (
        <View style={styles.utilityRow}>
          <Pressable
            onPress={() => void handleRadio()}
            disabled={radioLoading}
            accessibilityRole="button"
            accessibilityLabel="Is gaane ki radio chalao"
            style={({ pressed }) => [styles.utilityButton, pressed && styles.pressed]}
          >
            <Ionicons name="radio" size={20} color={colors.text} />
            <Text style={styles.utilityLabel}>{radioLoading ? 'Radio…' : 'Radio'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setSleepVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Sleep timer"
            style={({ pressed }) => [styles.utilityButton, pressed && styles.pressed]}
          >
            <Ionicons
              name="moon"
              size={20}
              color={sleepMode !== 'off' ? colors.primary : colors.text}
            />
            <Text
              style={[
                styles.utilityLabel,
                sleepMode !== 'off' && { color: colors.primary },
              ]}
            >
              {sleepMode === 'off'
                ? 'Sleep'
                : sleepMode === 'end_of_track'
                  ? 'Track ke baad'
                  : sleepRemaining ?? 'Sleep'}
            </Text>
          </Pressable>
          {downloadsEnabled ? (
            <Pressable
              onPress={() => void handleDownload()}
              accessibilityRole="button"
              accessibilityLabel="Ye gaana download karo"
              style={({ pressed }) => [styles.utilityButton, pressed && styles.pressed]}
            >
              <Ionicons
                name={downloadItem?.status === 'downloaded' ? 'checkmark-circle' : 'download-outline'}
                size={20}
                color={downloadItem?.status === 'downloaded' ? colors.success : colors.text}
              />
              <Text style={styles.utilityLabel}>
                {downloadItem?.status === 'downloaded'
                  ? 'Saved'
                  : downloadItem?.status === 'downloading'
                    ? 'Ho raha…'
                    : downloadItem?.status === 'failed'
                      ? 'Retry'
                      : 'Download'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SleepTimerModal
        visible={sleepVisible}
        mode={sleepMode}
        onClose={() => setSleepVisible(false)}
        onStart={startSleep}
      />
    </View>
  );
}

/** Sleep timer picker — player ke neeche slide-up sheet (Phase 5 completion). */
function SleepTimerModal({
  visible,
  mode,
  onClose,
  onStart,
}: {
  visible: boolean;
  mode: SleepMode;
  onClose: () => void;
  onStart: (mode: SleepMode) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetBackdropTouch} onPress={onClose} accessibilityLabel="Band karo" />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Sleep timer 🌙</Text>
          {SLEEP_OPTIONS.map(option => (
            <Pressable
              key={option.mode}
              onPress={() => {
                tapFeedback();
                onStart(option.mode);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Sleep timer: ${option.label}`}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
            >
              <Ionicons
                name={option.mode === 'off' ? 'close-circle-outline' : 'time-outline'}
                size={18}
                color={colors.text}
              />
              <Text style={styles.sheetRowText}>{option.label}</Text>
              {mode === option.mode ? (
                <Ionicons name="checkmark" size={18} color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
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
        onStartShouldSetPanResponder: () => true,
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
  backgroundGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 380,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  sourceChipText: { ...typography.caption, fontWeight: '600' },
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
  hiddenIframe: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    width: 200,
    height: 200,
    opacity: 0.01,
    pointerEvents: 'none',
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
  queueLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: spacing.sm },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  utilityButton: { alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm },
  utilityLabel: { ...typography.caption, color: colors.text },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetBackdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  sheetTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
  },
  sheetRowText: { ...typography.body, color: colors.text, flex: 1 },
  progressSection: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  controls: { marginTop: spacing.xl, marginBottom: spacing.xl },
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
