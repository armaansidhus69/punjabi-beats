/**
 * Podcast service (Phase 12a) — iTunes Search/RSS boundary.
 * Shows + episodes; RSS fetch (feedUrl) authoritative, lookup fallback
 * jab feed missing/unparseable/zero-episodes ho. Live probe 2026-10-29:
 * - /search term + media=podcast&entity=podcast → shows (feedUrl/artwork)
 * - /lookup id=<collectionId>&entity=podcastEpisode → episodes incl.
 *   episodeUrl (FULL mp3), trackTimeMillis, description
 * Koi Supabase/edge deploy nahi chahiye — local-only feature.
 */

import type { PodcastEpisode, PodcastShow } from '../types';
import { parsePodcastFeed } from '../core/podcast/rss';
import {
  rssEpisodeToPodcastEpisode,
  itunesEpisodeRowToPodcastEpisode,
  type ItunesEpisodeRow,
} from '../core/podcast/episode';

const ITUNES_BASE = 'https://itunes.apple.com';
const ITUNES_COUNTRY = process.env.EXPO_PUBLIC_ITUNES_COUNTRY ?? 'IN';
const REQUEST_TIMEOUT_MS = 10_000;

export type PodcastErrorCode = 'no_results' | 'network' | 'parse';

export class PodcastServiceError extends Error {
  readonly code: PodcastErrorCode;

  constructor(code: PodcastErrorCode, message: string) {
    super(message);
    this.name = 'PodcastServiceError';
    this.code = code;
  }
}

/* ------------------------------ fetch helper ------------------------------ */

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new PodcastServiceError('network', `iTunes HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof PodcastServiceError) throw err;
    throw new PodcastServiceError('network', err instanceof Error ? err.message : 'fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new PodcastServiceError('network', `RSS HTTP ${response.status}`);
    }
    return await response.text();
  } catch (err) {
    if (err instanceof PodcastServiceError) throw err;
    throw new PodcastServiceError('network', err instanceof Error ? err.message : 'fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ row shapes ------------------------------ */

interface ItunesShowRow {
  wrapperType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string | null;
  feedUrl?: string | null;
  primaryGenreName?: string | null;
}

interface ItunesSearchResponse {
  resultCount?: number;
  results?: ItunesShowRow[];
}

interface ItunesLookupResponse {
  results?: (ItunesShowRow & ItunesEpisodeRow)[];
}

function mapShow(row: ItunesShowRow, fallbackId: string): PodcastShow {
  return {
    id: row.collectionId != null ? String(row.collectionId) : fallbackId,
    title: row.collectionName ?? 'Untitled podcast',
    artist: row.artistName ?? '',
    artworkUrl: row.artworkUrl600 ?? '',
    feedUrl: row.feedUrl ?? null,
    primaryGenre: row.primaryGenreName ?? null,
  };
}

const MISSING = (term: string) => term.trim().length === 0;

/** id se show detail (detail screen open) — lookup entity=podcast */
export async function getShowById(id: string): Promise<PodcastShow> {
  const url = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(id)}&country=${ITUNES_COUNTRY}`;
  const data = await fetchJson<ItunesLookupResponse>(url);
  const row = (data.results ?? []).find(candidate => candidate.collectionId != null);
  if (!row) throw new PodcastServiceError('no_results', 'Show nahi mila.');
  return mapShow(row, id);
}

/* ------------------------------ API ------------------------------ */

/** Show search — Library card wale screen ki main list + query */
export async function searchShows(term: string, limit = 20): Promise<PodcastShow[]> {
  if (MISSING(term)) return [];
  const url =
    `${ITUNES_BASE}/search?term=${encodeURIComponent(term.trim())}` +
    `&media=podcast&entity=podcast&limit=${limit}&country=${ITUNES_COUNTRY}`;
  const data = await fetchJson<ItunesSearchResponse>(url);
  const shows = (data.results ?? []).map(row => mapShow(row, row.collectionId != null ? String(row.collectionId) : ''));
  if (shows.length === 0) throw new PodcastServiceError('no_results', 'Koi podcast nahi mila.');
  return shows;
}

/** Episode search (direct episode rows, show context optional) */
export async function searchEpisodes(term: string, limit = 15): Promise<PodcastEpisode[]> {
  if (MISSING(term)) return [];
  const url =
    `${ITUNES_BASE}/search?term=${encodeURIComponent(term.trim())}` +
    `&media=podcast&entity=podcastEpisode&limit=${limit}&country=${ITUNES_COUNTRY}`;
  const data = await fetchJson<ItunesSearchResponse>(url);
  const rows = (data.results ?? []) as ItunesEpisodeRow[];
  const episodes = rows
    .map(row =>
      itunesEpisodeRowToPodcastEpisode(row, {
        id: row.collectionId != null ? String(row.collectionId) : '',
        title: row.collectionName ?? '',
        artworkUrl: row.artworkUrl600 ?? '',
      }),
    )
    .filter((ep): ep is PodcastEpisode => ep !== null);
  if (episodes.length === 0) throw new PodcastServiceError('no_results', 'Koi episode nahi mila.');
  return episodes;
}

/**
 * Show ke episodes — RSS (feedUrl) pehle, khali/failed → lookup fallback.
 * RSS order preserve (feeds usually newest-first), lookup bhi approx.
 */
export async function getShowEpisodes(show: PodcastShow, limit = 50): Promise<PodcastEpisode[]> {
  const showMeta = { id: show.id, title: show.title, artworkUrl: show.artworkUrl };

  if (show.feedUrl) {
    try {
      const xml = await fetchText(show.feedUrl);
      const parsed = parsePodcastFeed(xml);
      const mapped = parsed.episodes
        .slice(0, limit)
        .map(item => rssEpisodeToPodcastEpisode(item, showMeta))
        .filter((ep): ep is PodcastEpisode => ep !== null);
      if (mapped.length > 0) return mapped;
    } catch (err) {
      console.warn('RSS episode fetch failed — lookup fallback:', err);
    }
  }

  // fallback: iTunes episode lookup (feedUrl missing ya unparseable)
  const url =
    `${ITUNES_BASE}/lookup?id=${encodeURIComponent(show.id)}` +
    `&entity=podcastEpisode&limit=${limit}&country=${ITUNES_COUNTRY}`;
  const data = await fetchJson<ItunesLookupResponse>(url);
  // pehli row khud show hoti hai — episodeUrl wale rows hi episodes hain
  const allRows = (data.results ?? []) as ItunesEpisodeRow[];
  const episodeRows = allRows.filter(row => row.episodeUrl != null);
  const episodes = episodeRows.map(row => itunesEpisodeRowToPodcastEpisode(row, showMeta));
  const valid = episodes.filter((ep): ep is PodcastEpisode => ep !== null);
  if (valid.length === 0) throw new PodcastServiceError('parse', 'Is show ke episodes nahi khul rahe.');
  return valid;
}
