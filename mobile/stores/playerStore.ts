/** Player store (Zustand) — TrackPlayer owns native playback; this store owns app queue/UI state. */
import { create } from 'zustand';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode as TrackRepeatMode,
  State,
} from 'react-native-track-player';
import { PlayerActionEvent, PlayerState, RepeatMode, Song } from '../types';
import { addRecentlyPlayed } from '../services/storage';

let setupPromise: Promise<void> | null = null;
let listenersRegistered = false;
let loadGeneration = 0;
let loadQueue: Promise<void> = Promise.resolve();
let requestedTrackId: string | null = null;

/* ---------- Action listener (room sync) ---------- */

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

function canAutoSkip(): boolean {
  return usePlayer.getState().queue.length > 1;
}

function getRepeatTrackMode(mode: RepeatMode): TrackRepeatMode {
  if (mode === 'all') return TrackRepeatMode.Queue;
  if (mode === 'one') return TrackRepeatMode.Track;
  return TrackRepeatMode.Off;
}

function toTrack(song: Song) {
  return {
    id: song.id,
    url: song.preview,
    title: song.title,
    artist: song.artist,
    artwork: song.cover,
    duration: song.duration / 1000,
  };
}

function shuffleTracks<T>(tracks: T[]): T[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

async function reorderUpcoming(shuffle: boolean): Promise<void> {
  const queue = await TrackPlayer.getQueue();
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  if (activeIndex === undefined) return;

  const logicalQueue = usePlayer.getState().queue;
  const order = [...queue];
  const upcoming = order.slice(activeIndex + 1);
  const orderedUpcoming = shuffle
    ? shuffleTracks(upcoming)
    : upcoming.sort((left, right) =>
        logicalQueue.findIndex(song => song.id === left.id) -
        logicalQueue.findIndex(song => song.id === right.id),
      );

  for (let offset = 0; offset < orderedUpcoming.length; offset++) {
    const track = orderedUpcoming[offset];
    const fromIndex = order.findIndex(item => item.id === track.id);
    const toIndex = activeIndex + 1 + offset;
    if (fromIndex === toIndex) continue;
    await TrackPlayer.move(fromIndex, toIndex);
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
  }
}

function registerPlaybackListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    usePlayer.setState({ isPlaying: state === State.Playing });
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    usePlayer.setState({ position: position * 1000, duration: duration * 1000 });
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    if (!track) return;
    if (requestedTrackId && track.id !== requestedTrackId) return;
    if (track.id === requestedTrackId) requestedTrackId = null;
    const state = usePlayer.getState();
    const index = state.queue.findIndex(song => song.id === track.id);
    if (index < 0 || state.currentSong?.id === track.id) return;
    const song = state.queue[index];
    usePlayer.setState({ currentSong: song, index, position: 0, duration: song.duration });
    emitAction({
      type: 'song',
      song,
      queue: state.queue,
      position: 0,
      isPlaying: state.isPlaying,
      remote: false,
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({ position }) => {
    usePlayer.setState({ isPlaying: false, position: position * 1000 });
  });

  TrackPlayer.addEventListener(Event.PlaybackError, event => {
    console.warn('TrackPlayer playback error:', event.message);
    if (canAutoSkip()) void usePlayer.getState().playNext();
    else usePlayer.setState({ isPlaying: false });
  });
}

async function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      await TrackPlayer.setupPlayer();
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Stop,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        progressUpdateEventInterval: 0.5,
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        },
      });
      await TrackPlayer.setRepeatMode(TrackRepeatMode.Off);
      registerPlaybackListeners();
    })().catch(err => {
      setupPromise = null;
      throw err;
    });
  }
  await setupPromise;
}

export function initializePlayer(): Promise<void> {
  return ensurePlayerSetup();
}

interface LoadOptions {
  shouldPlay?: boolean;
  initialPosition?: number;
  remote?: boolean;
}

async function loadAndPlaySong(
  song: Song,
  queue: Song[],
  index: number,
  { shouldPlay = true, initialPosition, remote = false }: LoadOptions = {},
): Promise<void> {
  const token = ++loadGeneration;
  const run = loadQueue.catch(() => undefined).then(async () => {
    if (token !== loadGeneration) return;
    try {
      await ensurePlayerSetup();
      requestedTrackId = song.id;
      await TrackPlayer.reset();
      if (token !== loadGeneration) return;
      const tracks = usePlayer.getState().shuffle ? shuffleTracks(queue) : queue;
      const activeTrackIndex = tracks.findIndex(item => item.id === song.id);
      await TrackPlayer.add(tracks.map(toTrack));
      if (token !== loadGeneration) return;
      await TrackPlayer.skip(activeTrackIndex >= 0 ? activeTrackIndex : index);
      if (token !== loadGeneration) return;
      const activeTrack = await TrackPlayer.getActiveTrack();
      if (activeTrack?.id === song.id) requestedTrackId = null;
      await TrackPlayer.setRepeatMode(
        getRepeatTrackMode(usePlayer.getState().repeat),
      );
      const savedVolume = usePlayer.getState().volume;
      if (savedVolume !== 1) await TrackPlayer.setVolume(savedVolume);
      if (initialPosition && initialPosition > 0) {
        await TrackPlayer.seekTo(initialPosition / 1000);
      }
      if (token !== loadGeneration) return;
      if (shouldPlay) await TrackPlayer.play();

      emitAction({
        type: 'song',
        song,
        queue: usePlayer.getState().queue,
        position: initialPosition ?? 0,
        isPlaying: shouldPlay,
        remote,
      });
    } catch (err) {
      if (token !== loadGeneration) return;
      console.warn('TrackPlayer load failed:', err);
      if (canAutoSkip()) void usePlayer.getState().playNext();
      else usePlayer.setState({ isPlaying: false });
    }
  });
  loadQueue = run;
  await run.catch(() => undefined);
}

export interface PlaybackOptions {
  remote?: boolean;
  seekTo?: number;
}

interface PlayerActions {
  playSong: (
    song: Song,
    queue?: Song[],
    options?: { initialPosition?: number; startPaused?: boolean; remote?: boolean },
  ) => Promise<void>;
  /**
   * Queue ke end pe song add (room 'queue-add' ke liye). Koi PlayerActionEvent
   * emit NAHI hota — broadcast roomSync ka alag 'queue-add' event karta hai
   * (warna 'song' event pura queue replace kar deta). Dedupe: id pehle se
   * queue me ho to false (spec: already present → skip).
   */
  addToQueue: (song: Song) => Promise<boolean>;
  play: (options?: PlaybackOptions) => Promise<void>;
  pause: (options?: PlaybackOptions) => Promise<void>;
  togglePlay: (options?: { remote?: boolean }) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  seek: (positionMs: number, options?: { remote?: boolean }) => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
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
    const index = Math.max(0, nextQueue.findIndex(item => item.id === song.id));
    const shouldPlay = options?.startPaused !== true;
    set({
      currentSong: song,
      queue: nextQueue,
      index,
      isPlaying: shouldPlay,
      position: options?.initialPosition ?? 0,
      duration: song.duration,
    });
    void addRecentlyPlayed(song);
    await loadAndPlaySong(song, nextQueue, index, {
      shouldPlay,
      initialPosition: options?.initialPosition,
      remote,
    });
  },

  addToQueue: async song => {
    if (get().queue.some(item => item.id === song.id)) return false;
    // Store pehle (UI turant update) + native queue ke end pe track append
    set({ queue: [...get().queue, song] });
    try {
      await ensurePlayerSetup();
      await TrackPlayer.add(toTrack(song));
    } catch (err) {
      console.warn('addToQueue: TrackPlayer add failed:', err);
    }
    return true;
  },

  play: async options => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;
    const remote = options?.remote === true;
    try {
      await ensurePlayerSetup();
      if (!isPlaying) {
        await TrackPlayer.play();
        set({ isPlaying: true });
      }
      if (options?.seekTo !== undefined) await get().seek(options.seekTo, { remote });
      emitAction({ type: 'play', remote });
    } catch (err) {
      console.warn('Play failed:', err);
    }
  },

  pause: async options => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;
    const remote = options?.remote === true;
    try {
      await ensurePlayerSetup();
      if (isPlaying) {
        await TrackPlayer.pause();
        set({ isPlaying: false });
      }
      if (options?.seekTo !== undefined) await get().seek(options.seekTo, { remote });
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
    const { currentSong, repeat } = get();
    if (!currentSong) return;
    if (repeat === 'one') {
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
      return;
    }
    requestedTrackId = null;
    try {
      await TrackPlayer.skipToNext();
    } catch (err) {
      if (repeat !== 'all') set({ isPlaying: false, position: get().duration });
      else console.warn('Skip to next failed:', err);
    }
  },

  playPrev: async () => {
    if (!get().currentSong) return;
    requestedTrackId = null;
    try {
      await TrackPlayer.skipToPrevious();
    } catch (err) {
      console.warn('Skip to previous failed:', err);
    }
  },

  seek: async (positionMs, options) => {
    const { currentSong } = get();
    const remote = options?.remote === true;
    set({ position: positionMs });
    try {
      await ensurePlayerSetup();
      await TrackPlayer.seekTo(positionMs / 1000);
    } catch (err) {
      console.warn('Seek failed:', err);
    }
    if (currentSong) emitAction({ type: 'seek', position: positionMs, remote });
  },

  toggleShuffle: () => {
    const shuffle = !get().shuffle;
    set({ shuffle });
    void reorderUpcoming(shuffle).catch(err => console.warn('Shuffle update failed:', err));
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = order.indexOf(get().repeat);
    const repeat = order[(currentIndex + 1) % order.length];
    set({ repeat });
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setRepeatMode(getRepeatTrackMode(repeat)))
      .catch(err => console.warn('Repeat mode update failed:', err));
  },

  setVolume: volume => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setVolume(clamped))
      .catch(err => console.warn('Volume set failed:', err));
  },
}));