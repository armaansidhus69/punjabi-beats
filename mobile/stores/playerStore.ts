import { create } from 'zustand';
import { Platform } from 'react-native';
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
  clearUpcoming as clearUpcomingOps,
  insertNext as insertNextOps,
  moveQueueItem,
  removeQueueItem,
  type QueueMove,
} from '../core/queue/ops';
import { getDownloadedUrl } from '../services/downloadsService';
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
/** Latest user intent wins, even when a provider resolver is still pending. */
let playbackIntent = false;
/** Queue changes invalidate background hydration snapshots. */
let queueRevision = 0;
let pendingHydration: Promise<void> = Promise.resolve();
let playbackOrder: string[] = [];

const UPCOMING_HYDRATION_CONCURRENCY = 3;

type WebPlaybackBridge = typeof import('../services/webPlayback');
let webPlayback: WebPlaybackBridge | null = null;

function getWebPlayback(): WebPlaybackBridge {
  if (!webPlayback) {
    webPlayback = require('../services/webPlayback') as WebPlaybackBridge;
  }
  return webPlayback;
}

function isWebPlayback(): boolean {
  return Platform.OS === 'web';
}

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
  _openFallback = true,
  isCurrentTrack = true,
): Promise<ResolvedTrack> {
  // Phase 6 downloads-first: local file ho to network resolve hi nahi karte
  // (offline playback + data bachat). getDownloadedUrl in-memory sync hai.
  const localUrl = getDownloadedUrl(song.id);
  if (localUrl) {
    return { song: { ...song, preview: localUrl, previewOnly: false }, url: localUrl };
  }
  if (song.source !== 'youtube_music' || !song.videoId) {
    // Sirf CURRENT track ko on-the-fly upgrade karo taaki pura queue network
    // calls se block na ho.
    if (isCurrentTrack && (song.previewOnly || !song.preview || (song.duration && song.duration <= 30_000))) {
      try {
        const resolvedFull = await resolveFullAudioStream(song);
        if (resolvedFull.url && !resolvedFull.previewOnly) {
          const upgradedSong: Song = {
            ...song,
            preview: resolvedFull.url,
            duration: resolvedFull.duration ?? song.duration,
            previewOnly: false,
            // Badge = jahan se AUDIO aa raha hai (metadata Spotify/ITunes se
            // ho sakta hai, par stream JioSaavn/Audius chain se resolve hua)
            source: song.source === 'itunes' || song.source === 'spotify' ? 'jiosaavn' : song.source,
          };
          return { song: upgradedSong, url: resolvedFull.url };
        }
      } catch (err) {
        console.warn('[playerStore] Full audio stream upgrade failed:', err);
      }
    }
    return {
      song,
      url: song.previewOnly === true || (song.duration > 0 && song.duration <= 30_000)
        ? null
        : song.preview || null,
    };
  }

  // YouTube metadata-only tracks ko upcoming queue ke liye resolve mat karo.
  // Active banne par hi Verome/Piped race chalegi.
  if (!isCurrentTrack) {
    return {
      song,
      url: song.previewOnly !== true && song.preview && song.duration > 30_000
        ? song.preview
        : null,
    };
  }

  try {
    const resolved = await resolveSongPlaybackUrl(song);
    const duration = resolved.duration ?? song.duration;
    const resolvedSong =
      resolved.previewOnly === song.previewOnly && duration === song.duration
        ? song
        : { ...song, previewOnly: resolved.previewOnly, duration };
    if (
      resolved.url
      && resolved.previewOnly !== true
      && (!duration || duration > 30_000)
    ) {
      return { song: resolvedSong, url: resolved.url };
    }
  } catch (err) {
    console.warn('[playerStore] Playback lookup failed:', err);
  }

  // DESIGN RULE (multi-source in-app): stream na mile to YouTube app/browser
  // KABHI external app fallback nahi hota — music app ke andar hi rehte hain.
  // url null return hota hai → loadAndPlaySong queue ke agle
  // playable track pe khud skip karta hai. Music is app me hi rehti hai.
  console.warn(
    `[playerStore] '${song.title}' stream resolve nahi hua — agla playable track chalega`,
  );
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
  if (isWebPlayback()) return;
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
  const nativeIds = order.map(item => item.id);
  const pendingIds = playbackOrder.filter(id => !nativeIds.includes(id));
  playbackOrder = [...nativeIds, ...pendingIds];
}

/**
 * Selected track start hone ke baad direct/full upcoming tracks ko bounded
 * batches me native queue me daalo. Metadata-only providers active hone tak
 * resolve nahi hote — unka full stream `loadAndPlaySong` me on-demand aayega.
 */
async function hydrateUpcomingTracks(
  token: number,
  revision: number,
  tracks: Song[],
  activeTrackPosition: number,
): Promise<void> {
  const upcoming = tracks.slice(activeTrackPosition + 1);
  const candidates = usePlayer.getState().repeat === 'all'
    ? [...upcoming, ...tracks.slice(0, activeTrackPosition)]
    : upcoming;
  if (candidates.length === 0) return;

  const resolved: (ResolvedTrack | null)[] = Array.from({ length: candidates.length }, () => null);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < candidates.length) {
      if (token !== loadGeneration || revision !== queueRevision) return;
      const candidateIndex = cursor++;
      const candidate = candidates[candidateIndex];
      resolved[candidateIndex] = await resolveTrack(candidate, false, false);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(UPCOMING_HYDRATION_CONCURRENCY, candidates.length) },
      () => worker(),
    ),
  );

  if (token !== loadGeneration || revision !== queueRevision) return;

  const playable = resolved.filter(
    (item): item is ResolvedTrack & { url: string } =>
      item !== null && Boolean(item.url) && item.song.previewOnly !== true,
  );
  if (playable.length === 0) return;

  const resolvedById = new Map(playable.map(item => [item.song.id, item.song] as const));
  usePlayer.setState(state => ({
    queue: state.queue.map(item => resolvedById.get(item.id) ?? item),
  }));

  try {
    const nativeQueue = await TrackPlayer.getQueue();
    if (token !== loadGeneration || revision !== queueRevision) return;
    const existingIds = new Set(nativeQueue.map(item => item.id));
    const additions = playable
      .filter(item => !existingIds.has(item.song.id))
      .map(item => toTrack(item.song, item.url));
    if (additions.length > 0) await TrackPlayer.add(additions);
  } catch (err) {
    console.warn('Upcoming queue hydration failed:', err);
  }
}

function scheduleUpcomingHydration(
  token: number,
  revision: number,
  tracks: Song[],
  activeTrackPosition: number,
): void {
  const task = pendingHydration
    .catch(() => undefined)
    .then(() => hydrateUpcomingTracks(token, revision, tracks, activeTrackPosition));
  pendingHydration = task;
  void task.catch(err => console.warn('Upcoming queue hydration failed:', err));
}

async function advanceToNextTrack(manual: boolean, failed = false): Promise<void> {
  const state = usePlayer.getState();
  if (!state.currentSong) return;

  if (state.repeat === 'one') {
    playbackIntent = true;
    if (isWebPlayback()) {
      getWebPlayback().seekWebPlayback(0);
      await getWebPlayback().playWebPlayback();
    } else {
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
    }
    return;
  }

  if (!isWebPlayback()) try {
    const nativeQueue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    if (activeIndex !== undefined && activeIndex + 1 < nativeQueue.length) {
      manualAdvancePending = manual;
      if (failed) autoAdvancePending = true;
      await TrackPlayer.skipToNext();
      return;
    }
  } catch (err) {
    console.warn('Native next failed; logical queue fallback use hoga:', err);
  }

  const order = playbackOrder.length > 0 ? playbackOrder : state.queue.map(song => song.id);
  const orderIndex = order.indexOf(state.currentSong.id);
  const nextId = orderIndex >= 0 && orderIndex + 1 < order.length
    ? order[orderIndex + 1]
    : state.repeat === 'all' && order.length > 0
      ? order[0]
      : null;
  const nextSong = nextId ? state.queue.find(song => song.id === nextId) : undefined;
  if (!nextSong) {
    playbackIntent = false;
    usePlayer.setState({ isPlaying: false, isLoading: false, position: state.duration });
    return;
  }

  manualAdvancePending = manual;
  if (failed) autoAdvancePending = true;
  await loadAndPlaySong(nextSong, state.queue, { shouldPlay: true });
}

async function advanceToPreviousTrack(): Promise<void> {
  const state = usePlayer.getState();
  if (!state.currentSong) return;

  if (!isWebPlayback()) try {
    const nativeQueue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    if (activeIndex !== undefined && activeIndex > 0 && nativeQueue.length > activeIndex) {
      manualAdvancePending = true;
      await TrackPlayer.skipToPrevious();
      return;
    }
  } catch (err) {
    console.warn('Native previous failed; logical queue fallback use hoga:', err);
  }

  const order = playbackOrder.length > 0 ? playbackOrder : state.queue.map(song => song.id);
  const orderIndex = order.indexOf(state.currentSong.id);
  const previousId = orderIndex > 0
    ? order[orderIndex - 1]
    : state.repeat === 'all' && order.length > 1
      ? order[order.length - 1]
      : null;
  const previousSong = previousId ? state.queue.find(song => song.id === previousId) : undefined;
  if (!previousSong) {
    if (isWebPlayback()) {
      getWebPlayback().seekWebPlayback(0);
      await getWebPlayback().playWebPlayback();
    } else {
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
    }
    return;
  }

  manualAdvancePending = true;
  await loadAndPlaySong(previousSong, state.queue, { shouldPlay: true });
}

function registerPlaybackListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    // Queue reset ke transient Stopped/Paused events resolver ke dauran
    // optimistic user intent ko overwrite nahi karne chahiye.
    if (usePlayer.getState().isLoading && state !== State.Playing) return;
    usePlayer.setState({
      isPlaying: state === State.Playing,
      ...(state === State.Playing ? { isLoading: false } : {}),
    });
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
    usePlayer.setState({ isPlaying: false, isLoading: true, position: position * 1000 });
    schedulePersistedState();
    void advanceToNextTrack(false).catch(err => {
      playbackIntent = false;
      usePlayer.setState({ isPlaying: false, isLoading: false });
      console.warn('Logical next after queue end failed:', err);
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackError, event => {
    console.warn('TrackPlayer playback error:', event.message);
    if (canAutoSkip()) {
      void advanceToNextTrack(false, true).catch(err => {
        usePlayer.setState({ isPlaying: false, isLoading: false });
        console.warn('Playback error auto-skip failed:', err);
      });
    } else usePlayer.setState({ isPlaying: false, isLoading: false });
  });
}

async function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      if (isWebPlayback()) {
        getWebPlayback().setupWebPlayback({
          onProgress: (positionMs, durationMs) => {
            usePlayer.setState({ position: positionMs, duration: durationMs || usePlayer.getState().duration });
            schedulePersistedState();
          },
          onState: isPlaying => {
            usePlayer.setState({ isPlaying, ...(isPlaying ? { isLoading: false } : {}) });
          },
          onEnded: () => {
            usePlayer.setState({ isLoading: true });
            void advanceToNextTrack(false).catch(err => {
              playbackIntent = false;
              usePlayer.setState({ isPlaying: false, isLoading: false });
              console.warn('Web playback next failed:', err);
            });
          },
          onError: error => {
            console.warn('Web playback error:', error);
            if (canAutoSkip()) {
              void advanceToNextTrack(false, true).catch(err => {
                usePlayer.setState({ isPlaying: false, isLoading: false });
                console.warn('Web playback auto-skip failed:', err);
              });
            } else {
              usePlayer.setState({ isPlaying: false, isLoading: false });
            }
          },
        });
        return;
      }
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
        isLoading: false,
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
      if (!isWebPlayback()) {
        await TrackPlayer.setRepeatMode(getRepeatTrackMode(persisted.repeat));
        await TrackPlayer.setVolume(persisted.volume);
      }
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
  const revision = ++queueRevision;
  playbackIntent = shouldPlay;
  lastSongRemote = remote; // direct restore path (initializePlayer) bhi set
  const run = loadQueue.catch(() => undefined).then(async () => {
    if (token !== loadGeneration) return;
    try {
      usePlayer.setState({ isLoading: true });
      await ensurePlayerSetup();
      await pendingHydration.catch(() => undefined);
      if (token !== loadGeneration) return;
      requestedTrackId = song.id;
      if (!isWebPlayback()) await TrackPlayer.reset();
      if (token !== loadGeneration) return;
      const tracks = usePlayer.getState().shuffle ? shuffleTracks(queue) : queue;
      playbackOrder = tracks.map(item => item.id);
      const selectedIndex = Math.max(0, tracks.findIndex(item => item.id === song.id));
      let activeResolved = await resolveTrack(song, true, true);
      if (token !== loadGeneration) return;
      let activeTrackPosition = selectedIndex;

      // Selected track unavailable ho to sirf aage ke tracks ko one-by-one try
      // karo. Baaki queue ko resolve karke startup ko block nahi karna.
      if (!activeResolved.url || activeResolved.song.previewOnly === true) {
        activeResolved = { song, url: null };
        for (let offset = selectedIndex + 1; offset < tracks.length; offset++) {
          const candidate = await resolveTrack(tracks[offset], true, true);
          if (token !== loadGeneration) return;
          if (candidate.url && candidate.song.previewOnly !== true) {
            activeResolved = candidate;
            activeTrackPosition = offset;
            break;
          }
        }
        if (
          !activeResolved.url
          && usePlayer.getState().repeat === 'all'
        ) {
          for (let offset = 0; offset < selectedIndex; offset++) {
            const candidate = await resolveTrack(tracks[offset], true, true);
            if (token !== loadGeneration) return;
            if (candidate.url && candidate.song.previewOnly !== true) {
              activeResolved = candidate;
              activeTrackPosition = offset;
              break;
            }
          }
        }
      }

      if (!activeResolved.url || activeResolved.song.previewOnly === true) {
        requestedTrackId = null;
        usePlayer.setState({
          queue: [],
          currentSong: null,
          isPlaying: false,
          isLoading: false,
          position: 0,
          duration: 0,
          index: 0,
        });
        return;
      }

      const activeSong = activeResolved.song;
      const position = activeSong.id === song.id ? initialPosition ?? 0 : 0;
      requestedTrackId = activeSong.id;
      usePlayer.setState({
        queue: usePlayer.getState().queue.map(item => item.id === activeSong.id ? activeSong : item),
        currentSong: activeSong,
        index: queue.findIndex(item => item.id === activeSong.id),
        position,
        duration: activeSong.duration,
        isLoading: true,
      });

      if (isWebPlayback()) {
        getWebPlayback().loadWebTrack({ id: activeSong.id, url: activeResolved.url });
        if (position > 0) getWebPlayback().seekWebPlayback(position);
        if (token !== loadGeneration) return;
        const shouldStart = playbackIntent;
        if (shouldStart) await getWebPlayback().playWebPlayback();
        getWebPlayback().setWebVolume(usePlayer.getState().volume);
        usePlayer.setState({ isPlaying: shouldStart, isLoading: false });

        const state = usePlayer.getState();
        emitAction({
          type: 'song',
          song: state.currentSong ?? song,
          queue: state.queue,
          position,
          isPlaying: shouldStart,
          remote,
        });
        return;
      }

      await TrackPlayer.add([toTrack(activeSong, activeResolved.url)]);
      if (token !== loadGeneration) return;
      await TrackPlayer.skip(0);
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
      const shouldStart = playbackIntent;
      if (shouldStart) await TrackPlayer.play();
      usePlayer.setState({ isPlaying: shouldStart, isLoading: false });

      const state = usePlayer.getState();
      emitAction({
        type: 'song',
        song: state.currentSong ?? song,
        queue: state.queue,
        position,
        isPlaying: shouldStart,
        remote,
      });
      scheduleUpcomingHydration(token, revision, tracks, activeTrackPosition);
    } catch (err) {
      if (token !== loadGeneration) return;
      console.warn('TrackPlayer load failed:', err);
      if (canAutoSkip()) {
        void advanceToNextTrack(false, true);
      } else usePlayer.setState({ isPlaying: false, isLoading: false });
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
  /** 'Play next' — current ke theek baad (pehle se queue me ho to move). */
  playSongNext: (song: Song) => Promise<boolean>;
  /** Upcoming list se item hatao (current remove nahi hota). */
  removeFromQueue: (songId: string) => Promise<void>;
  /** Upcoming zone ke andar up/down move (Queue screen arrows). */
  moveInQueue: (songId: string, direction: QueueMove) => Promise<void>;
  /** Current ke baad sab clear. */
  clearUpcoming: () => Promise<void>;
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
  isLoading: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1,

  playSong: async (song, queue = [], options) => {
    const remote = options?.remote === true;
    playbackIntent = options?.startPaused !== true;
    lastSongRemote = remote; // Phase 13a — outgoing classify isi se exclude
    const nextQueue = queue.length > 0 ? queue : [song];
    const index = Math.max(0, nextQueue.findIndex(item => item.id === song.id));
    const shouldPlay = options?.startPaused !== true;
    set({
      currentSong: song,
      queue: nextQueue,
      index,
      isPlaying: shouldPlay,
      isLoading: true,
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
    const resolved = await resolveTrack(song, false, true);
    if (!resolved.url) throw new Error('Track URL unavailable');
    let added = false;
    set(state => {
      if (state.queue.some(item => item.id === resolved.song.id)) return state;
      added = true;
      return { queue: [...state.queue, resolved.song] };
    });
    if (!added) return false;
    if (!playbackOrder.includes(resolved.song.id)) playbackOrder.push(resolved.song.id);
    queueRevision += 1;
    schedulePersistedState();
    if (isWebPlayback()) return true;
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
    playbackIntent = true;
    if (get().isLoading) {
      set({ isPlaying: true });
      emitAction({ type: 'play', remote });
      return;
    }
    try {
      if (isWebPlayback()) {
        await getWebPlayback().playWebPlayback();
        set({ isPlaying: true });
        schedulePersistedState();
        if (options?.seekTo !== undefined) await get().seek(options.seekTo, { remote });
        emitAction({ type: 'play', remote });
        return;
      }
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
    playbackIntent = false;
    if (get().isLoading) {
      set({ isPlaying: false });
      emitAction({ type: 'pause', remote });
      return;
    }
    try {
      if (isWebPlayback()) {
        getWebPlayback().pauseWebPlayback();
        set({ isPlaying: false });
        schedulePersistedState();
        if (options?.seekTo !== undefined) await get().seek(options.seekTo, { remote });
        emitAction({ type: 'pause', remote });
        return;
      }
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
    await advanceToNextTrack(true);
  },

  /* ---------- Phase 5 completion — dedicated queue management ---------- */
  // Queue-only local actions: koi PlayerActionEvent emit NAHI hota (room ke
  // 'song' event pura queue replace karta hai — host ke ilawa edits sirf
  // local hote hain; room queue-add apne SYNC_EVENT_QUEUE_ADD se aata hai).

  playSongNext: async song => {
    try {
      const resolved = await resolveTrack(song, false, true);
      if (!resolved.url) return false;
      const { currentSong, queue } = get();
      const nextQueue = insertNextOps(queue, currentSong?.id ?? null, resolved.song);
      if (nextQueue === queue) return false; // koi change nahi
      set({ queue: nextQueue });
      playbackOrder = playbackOrder.filter(id => id !== resolved.song.id);
      const currentId = currentSong?.id;
      const playbackAnchor = currentId ? playbackOrder.indexOf(currentId) : -1;
      playbackOrder.splice(playbackAnchor >= 0 ? playbackAnchor + 1 : playbackOrder.length, 0, resolved.song.id);
      queueRevision += 1;
      schedulePersistedState();
      if (isWebPlayback()) return true;
      // Native: naya track ho to active ke baad insert, phir order sync
      // (reorderUpcoming logical order ko TrackPlayer me mirror karta hai).
      try {
        const nativeQueue = await TrackPlayer.getQueue();
        if (!nativeQueue.some(track => track.id === resolved.song.id)) {
          const activeIndex = await TrackPlayer.getActiveTrackIndex();
          await TrackPlayer.add([toTrack(resolved.song, resolved.url)],
            (activeIndex ?? -1) + 1);
        }
        await reorderUpcoming(get().shuffle);
      } catch (err) {
        console.warn('playSongNext: TrackPlayer sync failed:', err);
      }
      return true;
    } catch (err) {
      console.warn('playSongNext failed:', err);
      return false;
    }
  },

  removeFromQueue: async songId => {
    const { currentSong } = get();
    if (currentSong?.id === songId) return; // current playing kabhi remove nahi
    const nextQueue = removeQueueItem(get().queue, songId);
    if (nextQueue === get().queue) return;
    set({ queue: nextQueue });
    playbackOrder = playbackOrder.filter(id => id !== songId);
    queueRevision += 1;
    schedulePersistedState();
    if (isWebPlayback()) return;
    try {
      const nativeQueue = await TrackPlayer.getQueue();
      const nativeIndex = nativeQueue.findIndex(track => track.id === songId);
      if (nativeIndex >= 0) await TrackPlayer.remove([nativeIndex]);
    } catch (err) {
      console.warn('removeFromQueue: TrackPlayer remove failed:', err);
    }
  },

  moveInQueue: async (songId, direction) => {
    const nextQueue = moveQueueItem(get().queue, songId, direction);
    if (nextQueue === get().queue) return;
    set({ queue: nextQueue });
    if (!get().shuffle) playbackOrder = nextQueue.map(item => item.id);
    queueRevision += 1;
    schedulePersistedState();
    if (isWebPlayback()) return;
    try {
      await reorderUpcoming(get().shuffle);
    } catch (err) {
      console.warn('moveInQueue: TrackPlayer reorder failed:', err);
    }
  },

  clearUpcoming: async () => {
    const { queue, index } = get();
    const nextQueue = clearUpcomingOps(queue, index);
    if (nextQueue === queue) return;
    set({ queue: nextQueue });
    const remainingIds = new Set(nextQueue.map(item => item.id));
    playbackOrder = playbackOrder.filter(id => remainingIds.has(id));
    queueRevision += 1;
    schedulePersistedState();
    if (isWebPlayback()) return;
    try {
      const nativeQueue = await TrackPlayer.getQueue();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      if (activeIndex === undefined) return;
      const stale = nativeQueue
        .map((track, nativeIdx) => ({ track, nativeIdx }))
        .filter(({ nativeIdx }) => nativeIdx > activeIndex)
        .map(({ nativeIdx }) => nativeIdx);
      if (stale.length > 0) await TrackPlayer.remove(stale);
    } catch (err) {
      console.warn('clearUpcoming: TrackPlayer remove failed:', err);
    }
  },

  playPrev: async () => {
    await advanceToPreviousTrack();
  },

  seek: async (positionMs, options) => {
    const { currentSong } = get();
    const remote = options?.remote === true;
    set({ position: positionMs });
    schedulePersistedState();
    try {
      if (isWebPlayback()) {
        getWebPlayback().seekWebPlayback(positionMs);
        if (currentSong) emitAction({ type: 'seek', position: positionMs, remote });
        return;
      }
      await ensurePlayerSetup();
      await TrackPlayer.seekTo(positionMs / 1000);
    } catch (err) {
      console.warn('Seek failed:', err);
    }
    if (currentSong) emitAction({ type: 'seek', position: positionMs, remote });
  },

  toggleShuffle: () => {
    const shuffle = !get().shuffle;
    const state = get();
    const currentId = state.currentSong?.id;
    const before = currentId ? state.queue.filter(item => item.id !== currentId) : state.queue;
    const orderedRemainder = (shuffle ? shuffleTracks(before) : before).map(item => item.id);
    playbackOrder = currentId
      ? [currentId, ...orderedRemainder].filter(id =>
          state.queue.some(item => item.id === id),
        )
      : orderedRemainder;
    set({ shuffle });
    queueRevision += 1;
    schedulePersistedState();
    void reorderUpcoming(shuffle).catch(err => console.warn('Shuffle update failed:', err));
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = order.indexOf(get().repeat);
    const repeat = order[(currentIndex + 1) % order.length];
    set({ repeat });
    schedulePersistedState();
    if (isWebPlayback()) return;
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setRepeatMode(getRepeatTrackMode(repeat)))
      .catch(err => console.warn('Repeat mode update failed:', err));
  },

  setVolume: volume => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    schedulePersistedState();
    if (isWebPlayback()) {
      getWebPlayback().setWebVolume(clamped);
      return;
    }
    void ensurePlayerSetup()
      .then(() => TrackPlayer.setVolume(clamped))
      .catch(err => console.warn('Volume set failed:', err));
  },
}));
