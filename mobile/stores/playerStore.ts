/**
 * Player store (Zustand) — current song, queue, playback, seek.
 * expo-av Sound instance module-level rakha hai (state churn se bachne ke liye).
 */
import { create } from 'zustand';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { PlayerActionEvent, PlayerState, RepeatMode, Song } from '../types';
import { addRecentlyPlayed } from '../services/storage';

let sound: Audio.Sound | null = null;
let audioModeConfigured = false;

/* ---------- Action listener (room sync Phase 11) ---------- */
/**
 * playerStore khud Apinator ko nahi jaanta — `services/roomSync.ts` ek listener
 * register karta hai aur local actions ko broadcast karta hai. Isse store
 * UI/realtime se decoupled rehta hai.
 *
 * `remote: true` ka matlab: ye action kisi remote event se aaya tha, isliye
 * roomSync isse dobara broadcast NAHI karta — echo loop isi flag se tootta hai.
 */
export type { PlayerActionEvent };

let actionListener: ((event: PlayerActionEvent) => void) | null = null;

export function setPlayerActionListener(
  listener: ((event: PlayerActionEvent) => void) | null,
): void {
  actionListener = listener;
}

function emitAction(event: PlayerActionEvent): void {
  try {
    actionListener?.(event);
  } catch (err) {
    console.warn('Player action listener failed:', err);
  }
}

/** Queue me ek hi song ho to auto-skip infinite loop bana deta hai — guard */
function canAutoSkip(): boolean {
  return usePlayer.getState().queue.length > 1;
}

/* ---------- Audio helpers ---------- */

async function configureAudio(): Promise<void> {
  if (audioModeConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    audioModeConfigured = true;
  } catch (err) {
    console.warn('Audio mode setup failed:', err);
  }
}

async function unloadCurrentSound(): Promise<void> {
  if (!sound) return;
  try {
    await sound.unloadAsync();
  } catch (err) {
    console.warn('Sound unload failed:', err);
  }
  sound = null;
}

/** Progress tracking (500ms interval) + auto-next on finish (FR-2.6, FR-2.7) */
function handlePlaybackStatus(status: AVPlaybackStatus): void {
  if (!status.isLoaded) {
    const error = 'error' in status ? status.error : undefined;
    if (error && canAutoSkip()) {
      console.warn('Audio error, skipping to next:', error);
      void usePlayer.getState().playNext();
    }
    return;
  }
  usePlayer.setState({
    position: status.positionMillis ?? 0,
    duration: status.durationMillis ?? 0,
  });
  if (status.didJustFinish) {
    void usePlayer.getState().playNext();
  }
}

interface LoadOptions {
  shouldPlay?: boolean;
  /** start position in ms (room sync ke liye) */
  initialPosition?: number;
  /** remote event se aaya? (roomSync broadcast skip karta hai) */
  remote?: boolean;
}

async function loadAndPlaySong(
  song: Song,
  { shouldPlay = true, initialPosition, remote = false }: LoadOptions = {},
): Promise<void> {
  await configureAudio();
  await unloadCurrentSound();
  try {
    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: song.preview },
      {
        shouldPlay,
        progressUpdateIntervalMillis: 500,
        ...(initialPosition && initialPosition > 0 ? { positionMillis: initialPosition } : {}),
      },
      handlePlaybackStatus,
      false,
    );
    sound = newSound;
    // FR-2.11: naye sound pe user ka saved volume lagao (expo-av default 1)
    const savedVolume = usePlayer.getState().volume;
    if (savedVolume !== 1) {
      newSound.setVolumeAsync(savedVolume).catch(err => console.warn('Volume apply failed:', err));
    }
    emitAction({
      type: 'song',
      song,
      queue: usePlayer.getState().queue,
      position: initialPosition ?? 0,
      isPlaying: shouldPlay,
      remote,
    });
  } catch (err) {
    console.warn('Audio load failed:', err);
    if (canAutoSkip()) {
      void usePlayer.getState().playNext();
    } else {
      usePlayer.setState({ isPlaying: false });
    }
  }
}

/* ---------- Store ---------- */

/** Room sync options — `remote: true` = ye action remote event se aaya */
export interface PlaybackOptions {
  remote?: boolean;
  /** remote play/pause ke saath exact position (ms) — drift fix */
  seekTo?: number;
}

interface PlayerActions {
  playSong: (
    song: Song,
    queue?: Song[],
    options?: { initialPosition?: number; startPaused?: boolean; remote?: boolean },
  ) => Promise<void>;
  /** Idempotent play (toggle nahi) — remote sync ke liye zaroori */
  play: (options?: PlaybackOptions) => Promise<void>;
  /** Idempotent pause (toggle nahi) — remote sync ke liye zaroori */
  pause: (options?: PlaybackOptions) => Promise<void>;
  togglePlay: (options?: { remote?: boolean }) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  seek: (positionMs: number, options?: { remote?: boolean }) => Promise<void>;
  /** FR-2.9 shuffle toggle */
  toggleShuffle: () => void;
  /** FR-2.10 repeat cycle: off → all → one → off */
  cycleRepeat: () => void;
  /** FR-2.11 volume slider (0..1) — local device, room sync me kabhi broadcast nahi */
  setVolume: (volume: number) => void;
}

export type PlayerStore = PlayerState & PlayerActions;

export const usePlayer = create<PlayerStore>()((set, get) => ({
  currentSong: null,
  queue: [],
  index: 0,
  isPlaying: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1,

  playSong: async (song, queue = [], options) => {
    const remote = options?.remote === true;
    const nextQueue = queue.length > 0 ? queue : [song];
    const index = Math.max(
      0,
      nextQueue.findIndex(s => s.id === song.id),
    );
    const shouldPlay = options?.startPaused !== true;
    set({
      currentSong: song,
      queue: nextQueue,
      index,
      isPlaying: shouldPlay,
      position: options?.initialPosition ?? 0,
      duration: song.duration,
    });
    // Recently played history (FR-8.1) — fire & forget
    void addRecentlyPlayed(song);
    await loadAndPlaySong(song, {
      shouldPlay,
      initialPosition: options?.initialPosition,
      remote,
    });
  },

  /**
   * Idempotent play. Toggle nahi hai kyunki remote events repeat ho sakte hain
   * (do 'play' aaye to state same rehni chahiye, ulti nahi honi chahiye).
   */
  play: async options => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;
    const remote = options?.remote === true;
    try {
      if (!isPlaying) {
        await sound?.playAsync();
        set({ isPlaying: true });
      }
      // Remote sync: sender ki position pe aa jao (late join drift fix)
      if (options?.seekTo !== undefined) {
        await get().seek(options.seekTo, { remote });
      }
      emitAction({ type: 'play', remote });
    } catch (err) {
      console.warn('Play failed:', err);
    }
  },

  /** Idempotent pause (remote 'pause' do baar aaye to bhi sahi chalta hai) */
  pause: async options => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;
    const remote = options?.remote === true;
    try {
      if (isPlaying) {
        await sound?.pauseAsync();
        set({ isPlaying: false });
      }
      if (options?.seekTo !== undefined) {
        await get().seek(options.seekTo, { remote });
      }
      emitAction({ type: 'pause', remote });
    } catch (err) {
      console.warn('Pause failed:', err);
    }
  },

  togglePlay: async options => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;
    if (isPlaying) await get().pause(options);
    else await get().play(options);
  },

  playNext: async () => {
    const { queue, index, currentSong, repeat, shuffle, isPlaying } = get();
    if (!currentSong || queue.length === 0) return;

    // FR-2.10: repeat "one" → wahi song dobara
    if (repeat === 'one') {
      await get().playSong(currentSong, queue, { startPaused: !isPlaying });
      return;
    }

    // FR-2.9: shuffle → koi bhi doosra song (current index avoid)
    let nextIndex: number;
    if (shuffle && queue.length > 1) {
      nextIndex = index;
      while (nextIndex === index) {
        nextIndex = Math.floor(Math.random() * queue.length);
      }
    } else {
      nextIndex = index + 1;
    }

    if (nextIndex >= queue.length) {
      // Queue khatam: repeat "all" → wapas shuru, warna ruk jao
      if (repeat === 'all') {
        nextIndex = 0;
      } else {
        try {
          await sound?.pauseAsync();
        } catch (err) {
          console.warn('Pause on queue end failed:', err);
        }
        set({ isPlaying: false, position: get().duration });
        return;
      }
    }

    await get().playSong(queue[nextIndex], queue, { startPaused: !isPlaying });
  },

  playPrev: async () => {
    const { queue, index, currentSong, isPlaying } = get();
    if (!currentSong || queue.length === 0) return;
    const prevIndex = (index - 1 + queue.length) % queue.length;
    await get().playSong(queue[prevIndex], queue, { startPaused: !isPlaying });
  },

  seek: async (positionMs, options) => {
    const { currentSong } = get();
    const remote = options?.remote === true;
    set({ position: positionMs });
    try {
      await sound?.setPositionAsync(positionMs);
    } catch (err) {
      console.warn('Seek failed:', err);
    }
    // Song ho to hi broadcast ka matlab hai (roomSync seek ko throttle karta hai)
    if (currentSong) {
      emitAction({ type: 'seek', position: positionMs, remote });
    }
  },

  toggleShuffle: () => {
    set({ shuffle: !get().shuffle });
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = order.indexOf(get().repeat);
    const nextMode = order[(currentIndex + 1) % order.length];
    set({ repeat: nextMode });
  },

  setVolume: volume => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    if (sound) {
      sound.setVolumeAsync(clamped).catch(err => console.warn('Volume set failed:', err));
    }
  },
}));
