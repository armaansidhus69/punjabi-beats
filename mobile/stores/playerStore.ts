import { Alert, Linking } from 'react-native';
import { create } from 'zustand';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode as TrackRepeatMode,
  State,
} from 'react-native-track-player';
import { PlayerActionEvent, PlayerState, RepeatMode, Song } from '../types';
import { trackEvent } from '../core/analytics/analytics';
import { classifyPlayback } from '../core/signals/skip';
import {
  addRecentlyPlayed,
  getPersistedPlayerState,
  savePersistedPlayerState,
} from '../services/storage';
import { resolveSongPlaybackUrl, resolveFullAudioStream } from '../services/musicApi';

let setupPromise: Promise<void> | null = null;
let listenersRegistered = false;
let loadGeneration = 0;
let loadQueue: Promise<void> = Promise.resolve();
let requestedTrackId: string | null = null;
// Phase 13a signal flags — next `PlaybackActiveTrackChanged` consume karta hai
let manualAdvancePending = false; // user pressed next/prev
let autoAdvancePending = false; // load/playback failure auto-skip → no signal
let lastSongRemote = false; // room-follow playback — taste exclude
let persistenceReady = false;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
let restorePromise: Promise<void> | null = null;

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

/**
 * Phase 13a — outgoing track ka play/skip/complete classify (pure ho relay).
 * remote/advance flags ka exact ek consumption; song badalne par reset.
 */
function emitOutgoingSignal(song: Song, positionMs: number, durationMs: number): void {
  if (lastSongRemote) {
    manualAdvancePending = false;
    autoAdvancePending = false;
    return; // room-follow — taste signal me ginta hi nahi (spec)
  }
  if (autoAdvancePending) {
    // failure skip — user ki pasand nahi, koi signal nahi
    autoAdvancePending = false;
    manualAdvancePending = false;
    return;
  }
  const manual = manualAdvancePending;
  manualAdvancePending = false;
  const ended = !manual;
  const name = classifyPlayback({ durationMs, positionMs, ended, manual });
  if (name === null) return;
  trackEvent(name, {
    songId: song.id,
    artistNames: song.artist,
    provider: song.source ?? null,
    durationMs,
    positionMs,
    ended,
    manual,
  });
}

function getRepeatTrackMode(mode: RepeatMode): TrackRepeatMode {
  if (mode === 'all') return TrackRepeatMode.Queue;
  if (mode === 'one') return TrackRepeatMode.Track;
  return TrackRepeatMode.Off;
}

function toTrack(song: Song, urlOverride?: string) {
  return {
    id: song.id,
    url: urlOverride ?? song.preview,
    title: song.title,
    artist: song.artist,
    artwork: song.cover,
    duration: song.duration / 1000,
  };
}

interface ResolvedTrack {
  song: Song;
  url: string | null;
}

function schedulePersistedState(): void {
  if (!persistenceReady || persistenceTimer) return;
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    const state = usePlayer.getState();
    void savePersistedPlayerState({
      queue: state.queue,
      currentSongId: state.currentSong?.id ?? null,
      index: state.index,
      position: Math.max(0, state.position),
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: state.volume,
    });
  }, 500);
}

async function resolveTrack(
  song: Song,
  openFallback = true,
  isCurrentTrack = true,
): Promise<ResolvedTrack> {
  if (song.source !== 'youtube_music' || !song.videoId) {
    // Sirf CURRENT track ko on-the-fly upgrade karo taaki pura queue 30+ network calls se block na ho
    if (isCurrentTrack && (song.previewOnly || !song.preview || (song.duration && song.duration <= 30_000))) {
      try {
        const resolvedFull = await resolveFullAudioStream(song);
        if (resolvedFull.url && !resolvedFull.previewOnly) {
          const upgradedSong: Song = {
            ...song,
            preview: resolvedFull.url,
            duration: resolvedFull.duration ?? song.duration,
            previewOnly: false,
            source: song.source === 'itunes' ? 'jiosaavn' : song.source,
          };
          return { song: upgradedSong, url: resolvedFull.url };
        }
      } catch (err) {
        console.warn('[playerStore] Full audio stream upgrade failed:', err);
      }
    }
    return { song, url: song.preview || null };
  }

  try {
    const resolved = await resolveSongPlaybackUrl(song);
    const duration = resolved.duration ?? song.duration;
    const resolvedSong =
      resolved.previewOnly === song.previewOnly && duration === song.duration
        ? song
        : { ...song, previewOnly: resolved.previewOnly, duration };
    if (resolved.url) return { song: resolvedSong, url: resolved.url };
  } catch (err) {
    console.warn('[playerStore] Playback lookup failed:', err);
  }

  if (openFallback) {
    try {
      await Linking.openURL(`https://www.youtube.com/watch?v=${song.videoId}`);
    } catch {
      // ignore if unable to open browser
    }
    Alert.alert(
      'Song Not Available',
      'Ye track abhi stream nahi ho pa raha. YouTube pe khol diya gaya hai.',
    );
  }

  return { song, url: null };
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
    schedulePersistedState();
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    if (!track) return;
    if (requestedTrackId && track.id !== requestedTrackId) return;
    if (track.id === requestedTrackId) requestedTrackId = null;
    const state = usePlayer.getState();
    // Phase 13a — outgoing track ka classify in setState se PEHLE (position
    // abhi purane track ka hai; badalne ke baad state 0 ho jati)
    if (state.currentSong && state.currentSong.id !== track.id) {
      emitOutgoingSignal(state.currentSong, state.position, state.duration);
    }
    const index = state.queue.findIndex(song => song.id === track.id);
    if (index < 0 || state.currentSong?.id === track.id) return;
    const song = state.queue[index];
    usePlayer.setState({ currentSong: song, index, position: 0, duration: song.duration });
    schedulePersistedState();
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
    schedulePersistedState();
  });

  TrackPlayer.addEventListener(Event.PlaybackError, event => {
    console.warn('TrackPlayer playback error:', event.message);
    if (canAutoSkip()) {
      autoAdvancePending = true; // failure auto-skip — outgoing me koi signal nahi
      void usePlayer.getState().playNext();
    } else usePlayer.setState({ isPlaying: false });
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
  if (!restorePromise) {
    restorePromise = (async () => {
      await ensurePlayerSetup();
      const persisted = await getPersistedPlayerState();
      persistenceReady = true;
      if (!persisted || persisted.queue.length === 0) return;

      const index = Math.min(Math.max(0, persisted.index), persisted.queue.length - 1);
      const currentSong =
        persisted.queue.find(song => song.id === persisted.currentSongId) ?? persisted.queue[index];
      usePlayer.setState({
        queue: persisted.queue,
        currentSong,
        index: persisted.queue.findIndex(song => song.id === currentSong.id),
        isPlaying: false,
        position: Math.min(persisted.position, currentSong.duration),
        duration: currentSong.duration,
        shuffle: persisted.shuffle,
        repeat: persisted.repeat,
        volume: persisted.volume,
      });

      await loadAndPlaySong(currentSong, persisted.queue, {
        shouldPlay: false,
        initialPosition: Math.min(persisted.position, currentSong.duration),
        remote: true,
      });
      await TrackPlayer.setRepeatMode(getRepeatTrackMode(persisted.repeat));
      await TrackPlayer.setVolume(persisted.volume);
      schedulePersistedState();
    })().catch(err => {
      persistenceReady = true;
      restorePromise = null;
      throw err;
    });
  }
  return restorePromise;
}

interface LoadOptions {
  shouldPlay?: boolean;
  initialPosition?: number;
  remote?: boolean;
}

async function loadAndPlaySong(
  song: Song,
  queue: Song[],
  { shouldPlay = true, initialPosition, remote = false }: LoadOptions = {},
): Promise<void> {
  const token = ++loadGeneration;
  lastSongRemote = remote; // direct restore path (initializePlayer) bhi set
  const run = loadQueue.catch(() => undefined).then(async () => {
    if (token !== loadGeneration) return;
    try {
      await ensurePlayerSetup();
      requestedTrackId = song.id;
      await TrackPlayer.reset();
      if (token !== loadGeneration) return;
      const tracks = usePlayer.getState().shuffle ? shuffleTracks(queue) : queue;
      const resolvedTracks = await Promise.all(
        tracks.map(item => resolveTrack(item, item.id === song.id, item.id === song.id)),
      );
      if (token !== loadGeneration) return;
      const resolvedById = new Map(resolvedTracks.map(item => [item.song.id, item.song] as const));
      usePlayer.setState(state => ({
        queue: state.queue.map(item => resolvedById.get(item.id) ?? item),
        currentSong: state.currentSong
          ? resolvedById.get(state.currentSong.id) ?? state.currentSong
          : state.currentSong,
      }));
      const playableTracks = resolvedTracks.filter(
        (item): item is ResolvedTrack & { url: string } => Boolean(item.url),
      );
      let activeTrackIndex = playableTracks.findIndex(item => item.song.id === song.id);
      if (activeTrackIndex < 0) {
        const selectedIndex = resolvedTracks.findIndex(item => item.song.id === song.id);
        const nextTrack = resolvedTracks.slice(selectedIndex + 1).find(item => item.url)
          ?? (usePlayer.getState().repeat === 'all' ? playableTracks[0] : undefined);
        if (!nextTrack) {
          requestedTrackId = null;
          usePlayer.setState({ isPlaying: false });
          return;
        }
        activeTrackIndex = playableTracks.findIndex(item => item.song.id === nextTrack.song.id);
      }
      const activeSong = playableTracks[activeTrackIndex].song;
      const position = activeSong.id === song.id ? initialPosition ?? 0 : 0;
      requestedTrackId = activeSong.id;
      usePlayer.setState({
        currentSong: activeSong,
        index: queue.findIndex(item => item.id === activeSong.id),
        position,
        duration: activeSong.duration,
      });
      await TrackPlayer.add(playableTracks.map(item => toTrack(item.song, item.url)));
      if (token !== loadGeneration) return;
      await TrackPlayer.skip(activeTrackIndex);
      if (token !== loadGeneration) return;
      const activeTrack = await TrackPlayer.getActiveTrack();
      if (activeTrack?.id === activeSong.id) requestedTrackId = null;
      await TrackPlayer.setRepeatMode(
        getRepeatTrackMode(usePlayer.getState().repeat),
      );
      const savedVolume = usePlayer.getState().volume;
      if (savedVolume !== 1) await TrackPlayer.setVolume(savedVolume);
      if (position > 0) {
        await TrackPlayer.seekTo(position / 1000);
      }
      if (token !== loadGeneration) return;
      if (shouldPlay) await TrackPlayer.play();

      const state = usePlayer.getState();
      emitAction({
        type: 'song',
        song: state.currentSong ?? song,
        queue: state.queue,
        position,
        isPlaying: shouldPlay,
        remote,
      });
    } catch (err) {
      if (token !== loadGeneration) return;
      console.warn('TrackPlayer load failed:', err);
      if (canAutoSkip()) {
        autoAdvancePending = true; // load-failure skip — signal suppress
        void usePlayer.getState().playNext();
      } else usePlayer.setState({ isPlaying: false });
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
   * queue me ho to false (spec: already present → skip). Unavailable → reject.
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
    lastSongRemote = remote; // Phase 13a — outgoing classify isi se exclude
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
    // Phase 13a — play_start signal (remote room-follow bhi record, stats me nahi)
    trackEvent('play_start', {
      songId: song.id,
      artistNames: song.artist,
      provider: song.source ?? null,
      durationMs: song.duration,
      positionMs: options?.initialPosition ?? 0,
      remote,
    });
    schedulePersistedState();
    void addRecentlyPlayed(song);
    await loadAndPlaySong(song, nextQueue, {
      shouldPlay,
      initialPosition: options?.initialPosition,
      remote,
    });
  },

  addToQueue: async song => {
    if (get().queue.some(item => item.id === song.id)) return false;
    // Queue-only action: link-out nahi, unavailable track ko success mat bolo.
    const resolved = await resolveTrack(song, false);
    if (!resolved.url) throw new Error('Track URL unavailable');
    let added = false;
    set(state => {
      if (state.queue.some(item => item.id === resolved.song.id)) return state;
      added = true;
      return { queue: [...state.queue, resolved.song] };
    });
    if (!added) return false;
    schedulePersistedState();
    try {
      await ensurePlayerSetup();
      await TrackPlayer.add(toTrack(resolved.song, resolved.url));
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
        schedulePersistedState();
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
        schedulePersistedState();
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
    manualAdvancePending = true; // Phase 13a — next track-change consume
    try {
      await TrackPlayer.skipToNext();
    } catch (err) {
      manualAdvancePending = false;
      if (repeat !== 'all') set({ isPlaying: false, position: get().duration });
      else console.warn('Skip to next failed:', err);
    }
  },

  playPrev: async () => {
    if (!get().currentSong) return;
    requestedTrackId = null;
    manualAdvancePending = true; // Phase 13a — next track-change consume
    try {
      await TrackPlayer.skipToPrevious();
    } catch (err) {
      manualAdvancePending = false;
      console.warn('Skip to previous failed:', err);
    }
  },

  seek: async (positionMs, options) => {
    const { currentSong } = get();
    const remote = options?.remote === true;
    set({ position: positionMs });
    schedulePersistedState();
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
    schedulePersistedState();
    void reorderUpcoming(shuffle).catch(err => console.warn('Shuffle update failed:', err));
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = order.indexOf(get().repeat);
    const repeat = order[(currentIndex + 1) % order.length];
    set({ repeat });
    schedulePersistedState();
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setRepeatMode(getRepeatTrackMode(repeat)))
      .catch(err => console.warn('Repeat mode update failed:', err));
  },

  setVolume: volume => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    schedulePersistedState();
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setVolume(clamped))
      .catch(err => console.warn('Volume set failed:', err));
  },
}));
