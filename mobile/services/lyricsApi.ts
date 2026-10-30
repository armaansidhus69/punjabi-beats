/**
 * Lyrics service (Phase 7a) — LRCLIB free/keyless synced lyrics.
 *
 * Fallback chain: cache (@pb_lyrics) → /api/get exact (artist+title+
 * duration) → /api/search first hit. Dono miss = not_found. Koi API key
 * nahi — public endpoint, 10s timeout. Sirf lyrics text jata hai (koi
 * audio URL nahi — NFR-4.5 provider policy parity).
 */

import type { LyricsData, LyricsErrorCode, Song } from '../types';
import {
  cacheFromEnvelope,
  cacheGet,
  cachePut,
  cacheToEnvelope,
  isSyncedLines,
  parseLrc,
  plainToLines,
} from '../core/lyrics/lyrics';
import { getLyricsCacheRaw, saveLyricsCache } from './storage';

const LRCLIB_BASE = 'https://lrclib.net/api';
const REQUEST_TIMEOUT_MS = 10_000;

export class LyricsError extends Error {
  readonly code: LyricsErrorCode;
  readonly retryAfterSec?: number;

  constructor(code: LyricsErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'LyricsError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Hinglish error surface — screen EmptyState isko call karta */
export function describeLyricsError(err: unknown): string {
  if (err instanceof LyricsError) {
    switch (err.code) {
      case 'not_found':
        return 'Is song ke lyrics mil nahi — doosra spelling try karo';
      case 'bad_request':
        return 'Lyrics dhoondne ke liye song details missing hain';
      default:
        if (err.retryAfterSec !== undefined) {
          return `LRCLIB busy hai — ${err.retryAfterSec}s baad retry karo`;
        }
        return 'Lyrics load nahi hue — internet check karo';
    }
  }
  return 'Lyrics load nahi hue — dobara try karo';
}

/* ------------------------------ track cleanup ------------------------------ */

/** query-only cleanup — display title kabhi na badle (LRCLIB matching) */
export function cleanTrackQuery(title: string): string {
  return (title ?? '')
    .replace(/\((?:official\s+(?:music\s+)?video|official\s+audio|lyrics?\s*(?:video)?|audio|hd|4k)\)/gi, '')
    .replace(/\[(?:official\s+(?:music\s+)?video|official\s+audio|lyrics?\s*(?:video)?|audio)\]/gi, '')
    .replace(/\bfeat\.?\b.*$/gi, '')
    .trim();
}

/* ------------------------------ fetch helpers ------------------------------ */

type LrcLibTrack = {
  instrumentMusic?: boolean;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  artistName?: string;
  trackName?: string;
  duration?: number;
};

let retryAfterUntilMs = 0;

function retryDelayMs(value: string | null): number {
  if (value === null) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, Math.ceil(seconds * 1000));
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(1_000, dateMs - Date.now()) : 1_000;
}

async function lrclibFetch(path: string): Promise<unknown> {
  const blockedForMs = retryAfterUntilMs - Date.now();
  if (blockedForMs > 0) {
    throw new LyricsError(
      'network',
      'LRCLIB retry window active',
      Math.max(1, Math.ceil(blockedForMs / 1000)),
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${LRCLIB_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'Lrclib-Client': 'PunjabiBeats v1.0',
      },
    });
    if (response.status === 404) return null;
    if (response.status === 429 || response.status === 503) {
      const baseDelay = retryDelayMs(response.headers.get('Retry-After'));
      const jitter = Math.round(baseDelay * Math.random() * 0.3);
      const totalDelay = baseDelay + jitter;
      retryAfterUntilMs = Date.now() + totalDelay;
      throw new LyricsError(
        'network',
        `LRCLIB busy (${response.status})`,
        Math.max(1, Math.ceil(totalDelay / 1000)),
      );
    }
    if (!response.ok) {
      throw new LyricsError('network', `LRCLIB status ${response.status}`);
    }
    return (await response.json()) as unknown;
  } catch (err) {
    if (err instanceof LyricsError) throw err;
    console.warn('[lyrics] lrclib fetch failed:', path, err);
    throw new LyricsError('network', 'LRCLIB connect nahi hua');
  } finally {
    clearTimeout(timer);
  }
}

/** track → LyricsData jaisi shape ya null (instrumental/dono null miss) */
function trackToLyrics(track: LrcLibTrack, song: Song): LyricsData | null {
  if (track.instrumental === true || track.instrumentMusic === true) return null;
  const synced = typeof track.syncedLyrics === 'string' ? track.syncedLyrics : '';
  const plain = typeof track.plainLyrics === 'string' ? track.plainLyrics : '';
  if (synced.length === 0 && plain.length === 0) return null;

  const syncedLines = synced.length > 0 ? parseLrc(synced) : [];
  const hasSyncedLines = syncedLines.length > 0 && isSyncedLines(syncedLines);
  const lines = hasSyncedLines ? syncedLines : plainToLines(plain, song.duration);
  if (lines.length === 0) return null;

  return {
    synced: hasSyncedLines,
    lines,
    plain,
    artist: typeof track.artistName === 'string' && track.artistName.length > 0 ? track.artistName : song.artist,
    title: typeof track.trackName === 'string' && track.trackName.length > 0 ? track.trackName : song.title,
    fetchedAt: Date.now(),
  };
}

/* ------------------------------ in-module cache ------------------------------ */

let cacheLyrics: Record<string, LyricsData> | null = null;

async function loadCacheOnce(): Promise<Record<string, LyricsData>> {
  if (cacheLyrics === null) {
    cacheLyrics = cacheFromEnvelope(await getLyricsCacheRaw());
  }
  return cacheLyrics;
}

async function persistCache(map: Record<string, LyricsData>): Promise<void> {
  cacheLyrics = map;
  await saveLyricsCache(cacheToEnvelope(map));
}

/** test seam — in-module cache state reset (service fresh module reuse) */
export function resetLyricsCacheForTest(): void {
  cacheLyrics = null;
  retryAfterUntilMs = 0;
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ');
}

/** Search max-20 deta — title/artist/duration ke nearest playable record ko lo. */
function selectSearchResult(raw: unknown[], song: Song): LrcLibTrack | null {
  const wantedTitle = normalized(cleanTrackQuery(song.title));
  const wantedArtist = normalized(song.artist);
  const wantedDuration = song.duration > 0 ? Math.round(song.duration / 1000) : 0;

  let best: { track: LrcLibTrack; score: number } | null = null;
  for (const value of raw) {
    if (value === null || typeof value !== 'object') continue;
    const track = value as LrcLibTrack;
    const hasLyrics =
      (typeof track.syncedLyrics === 'string' && track.syncedLyrics.length > 0) ||
      (typeof track.plainLyrics === 'string' && track.plainLyrics.length > 0);
    if (track.instrumental === true || !hasLyrics) continue;

    const title = normalized(track.trackName);
    const artist = normalized(track.artistName);
    let score = 0;
    if (title.length > 0 && wantedTitle.length > 0) {
      if (title === wantedTitle) score += 100;
      else if (title.includes(wantedTitle) || wantedTitle.includes(title)) score += 30;
    }
    if (artist.length > 0 && wantedArtist.length > 0) {
      if (artist === wantedArtist) score += 60;
      else if (artist.includes(wantedArtist) || wantedArtist.includes(artist)) score += 20;
    }
    if (wantedDuration > 0 && typeof track.duration === 'number') {
      score += Math.max(0, 30 - Math.abs(track.duration - wantedDuration) * 3);
    }
    if (typeof track.syncedLyrics === 'string' && track.syncedLyrics.length > 0) score += 5;
    if (best === null || score > best.score) best = { track, score };
  }
  return best?.track ?? null;
}

/* ------------------------------ public flow ------------------------------ */

/**
 * Cache-first lyrics. Miss pe LRCLIB exact + search fallback. Result null
 * NAHI hota — not_found LyricsError hota hai (honest).
 */
export async function fetchLyrics(song: Song): Promise<LyricsData> {
  if (!song || typeof song.id !== 'string' || song.id.length === 0) {
    throw new LyricsError('bad_request', 'Song id kami hai');
  }

  const cache = await loadCacheOnce();
  const hit = cacheGet(cache, song.id);
  if (hit) return hit;

  const artist = song.artist.trim();
  const title = cleanTrackQuery(song.title) || song.title.trim();
  if (artist.length === 0 || title.length === 0) {
    throw new LyricsError('bad_request', 'Artist/title missing');
  }
  const artistQuery = encodeURIComponent(artist);
  const titleQuery = encodeURIComponent(title);
  const durationSec = song.duration > 0 ? Math.round(song.duration / 1000) : 0;

  // exact get — durationSec param sirf duration > 0 pe
  let track: unknown = null;
  const getPath =
    durationSec >= 1 && durationSec <= 3600
      ? `/get?artist_name=${artistQuery}&track_name=${titleQuery}&duration=${durationSec}`
      : `/get?artist_name=${artistQuery}&track_name=${titleQuery}`;
  track = await lrclibFetch(getPath);

  if (track === null) {
    // search fallback — title/artist/duration nearest result
    const list = await lrclibFetch(`/search?q=${artistQuery}%20${titleQuery}`);
    if (Array.isArray(list) && list.length > 0) {
      track = selectSearchResult(list, song);
    }
  }

  const data = track ? trackToLyrics(track as LrcLibTrack, song) : null;
  if (!data) {
    throw new LyricsError('not_found', `Lyrics mil nahi — "${song.title}"`);
  }

  const nextCache = cachePut(cache, song.id, data);
  await persistCache(nextCache);
  return data;
}
