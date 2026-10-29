/**
 * Podcast store (Phase 12a) — zustand slice: search results, saved shows,
 * progress ledger, episode playback glue. Local-only feature (guest-mode
 * bhi): koi Supabase auth dependency nahi. Player integration existing
 * playerStore se — episode = Song (full stream, previewOnly false).
 */

import { create } from 'zustand';
import type { PodcastEpisode, PodcastProgressEntry, PodcastShow } from '../types';
import { episodeToSong } from '../core/podcast/episode';
import {
  PodcastServiceError,
  getShowById,
  getShowEpisodes,
  searchEpisodes,
  searchShows,
} from '../services/podcastService';
import {
  getPodcastProgressMap,
  getSavedPodcastShows,
  savePodcastProgressEntry,
  saveSavedPodcastShows,
  type PodcastProgressMap,
} from '../services/storage';
import { mergeProgress } from '../core/podcast/progress';
import { usePlayer } from './playerStore';

interface PodcastStore {
  /** search state */
  searchResultsShows: PodcastShow[];
  searchResultsEpisodes: PodcastEpisode[];
  searching: boolean;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;

  /** saved (follow) shows */
  savedShows: PodcastShow[];
  savedLoading: boolean;
  loadSaved: () => Promise<void>;
  toggleSave: (show: PodcastShow) => Promise<boolean>;

  /** show detail (episode list) */
  detailShow: PodcastShow | null;
  detailEpisodes: PodcastEpisode[];
  detailLoading: boolean;
  detailError: string | null;
  openShow: (id: string) => Promise<PodcastShow>;
  closeDetail: () => void;

  /** progress ledger — continue-listening + resume + played badges */
  progressMap: PodcastProgressMap;
  loadProgress: () => Promise<void>;
  /** playback start (resume aware) — episode ko player + ledger dono me */
  playEpisode: (episode: PodcastEpisode) => Promise<void>;

  /** progress entry se resume (continue-listening rows tap) — rebuild store me */
  resumeFromProgress: (episodeId: string) => Promise<void>;
}

/** player-song id → podcast-episode registry (songs bhi 'itunes' hote —
 * distinguish karne ka clean tareeka; app chalu pe progress keys se seed) */
const podcastSongIds = new Set<string>();

export function isPodcastSongId(songId: string): boolean {
  return podcastSongIds.has(songId);
}

export const usePodcast = create<PodcastStore>()((set, get) => ({
  searchResultsShows: [],
  searchResultsEpisodes: [],
  searching: false,

  search: async query => {
    const q = query.trim();
    if (q.length < 2) return;
    set({ searching: true });
    try {
      const [shows, episodes] = await Promise.all([
        searchShows(q, 15).catch(() => [] as PodcastShow[]),
        searchEpisodes(q, 10).catch(() => [] as PodcastEpisode[]),
      ]);
      set({ searchResultsShows: shows, searchResultsEpisodes: episodes });
    } finally {
      set({ searching: false });
    }
  },

  clearSearch: () => set({ searchResultsShows: [], searchResultsEpisodes: [] }),

  savedShows: [],
  savedLoading: false,

  loadSaved: async () => {
    set({ savedLoading: true });
    try {
      set({ savedShows: await getSavedPodcastShows() });
    } finally {
      set({ savedLoading: false });
    }
  },

  toggleSave: async show => {
    const current = get().savedShows;
    const exists = current.some(saved => saved.id === show.id);
    const next = exists ? current.filter(saved => saved.id !== show.id) : [show, ...current];
    await saveSavedPodcastShows(next);
    set({ savedShows: next });
    return !exists;
  },

  detailShow: null,
  detailEpisodes: [],
  detailLoading: false,
  detailError: null,

  openShow: async id => {
    set({ detailLoading: true, detailError: null });
    try {
      const show = await getShowById(id);
      const episodes = await getShowEpisodes(show);
      set({ detailShow: show, detailEpisodes: episodes });
      return show;
    } catch (err) {
      const message =
        err instanceof PodcastServiceError ? err.message : 'Episodes load nahi hue.';
      console.warn('Podcast open failed:', err);
      set({ detailShow: null, detailEpisodes: [], detailError: message });
      throw err;
    } finally {
      set({ detailLoading: false });
    }
  },

  closeDetail: () => set({ detailShow: null, detailEpisodes: [], detailError: null }),

  progressMap: {},

  loadProgress: async () => {
    const map = await getPodcastProgressMap();
    // app start pe known podcast ids registry me seed karo
    for (const [episodeId, entry] of Object.entries(map)) {
      if (entry.audioUrl) podcastSongIds.add(episodeId);
    }
    set({ progressMap: map });
  },

  playEpisode: async episode => {
    podcastSongIds.add(episode.id);
    const player = usePlayer.getState();
    const existing = get().progressMap[episode.id] ?? null;
    const initialPosition =
      existing && !existing.played && existing.positionMs > 1000 ? existing.positionMs : undefined;

    // ledger entry abhi seed — continue-listening me turant dikhe
    const nowIso = new Date().toISOString();
    const seeded = mergeProgress(existing, {
      positionMs: initialPosition ?? 0,
      durationMs: episode.durationMs,
      title: episode.title,
      showTitle: episode.showTitle,
      artworkUrl: episode.artworkUrl,
      audioUrl: episode.audioUrl,
    }, nowIso);
    await savePodcastProgressEntry(episode.id, seeded);
    const map = { ...get().progressMap, [episode.id]: seeded };
    set({ progressMap: map });

    await player.playSong(episodeToSong(episode), [], {
      initialPosition: initialPosition ?? 0,
      remote: false,
    });
  },

  /** continue-listening row tap → denormalized entry se episode rebuild */
  resumeFromProgress: async episodeId => {
    const entry = get().progressMap[episodeId];
    if (!entry || entry.audioUrl.length === 0) return;
    const episode: PodcastEpisode = {
      id: episodeId,
      showId: '',
      showTitle: entry.showTitle,
      title: entry.title,
      description: null,
      artworkUrl: entry.artworkUrl,
      durationMs: entry.durationMs,
      audioUrl: entry.audioUrl,
      publishedAt: '',
    };
    await get().playEpisode(episode);
  },
}));

/* ---------- continue-listening selector (pure, screen-safe) ---------- */

export function selectContinueListening(map: PodcastProgressMap): (PodcastProgressEntry & { id: string })[] {
  return Object.entries(map)
    .filter(([, entry]) => !entry.played && entry.positionMs > 1000)
    .sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt))
    .slice(0, 5)
    .map(([id, entry]) => ({ id, ...entry }));
}

/** subscription hook ke liye helper — throttled save + map sync */
export async function podcastProgressTick(
  songId: string,
  positionMs: number,
  durationMs: number,
): Promise<void> {
  if (!podcastSongIds.has(songId)) return;
  const store = usePodcast.getState();
  const previous = store.progressMap[songId] ?? null;
  const entry = mergeProgress(previous, {
    positionMs,
    durationMs: durationMs > 0 ? durationMs : (previous?.durationMs ?? 0),
    title: previous?.title ?? '',
    showTitle: previous?.showTitle ?? '',
    artworkUrl: previous?.artworkUrl ?? '',
    audioUrl: previous?.audioUrl ?? '',
  }, new Date().toISOString());
  await savePodcastProgressEntry(songId, entry);
  usePodcast.setState({ progressMap: { ...store.progressMap, [songId]: entry } });
}
