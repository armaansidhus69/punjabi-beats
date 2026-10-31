/**
 * AI playlist service (Phase 13b) — server generate + client resolve.
 *
 * Server (api/ai-playlist.js) Gemini se sirf {title, artist} refs leta hai
 * (key Vercel env me, NFR-4.1); yahan wahi refs existing searchSongs chain
 * se fuzzy resolve hote hain (core/ai/playlist.ts pure matchers). Taste
 * context 13a signals service se aata hai.
 */

import axios from 'axios';
import { getOrCreateDeviceIdentity } from '../core/auth/identity';
import {
  dedupePlanRows,
  planMatchedRows,
  countPlayable,
  sanitizeAiTracks,
  mergePromptHistory,
} from '../core/ai/playlist';
import { artistStatsFromSignals } from '../core/signals/stats';
import { getTasteStats, getRecentSignals } from './signalsService';
import { getAiPromptHistoryRaw, saveAiPromptHistory } from './storage';
import { searchSongs } from './musicApi';
import type { AiPlanRow, AiPlaylistErrorCode, AiPromptHistoryEntry, AiTrackRef, Song } from '../types';

/** server POST budget — Vercel cold + Gemini 20s upar ho sakta hai */
const REQUEST_TIMEOUT_MS = 25_000;
/** client-side base — youtube-match Vercel deployment hi isi par hai */
const BASE_URL = (process.env.EXPO_PUBLIC_YOUTUBE_MATCH_URL ?? '').replace(/\/+$/, '');

export class AiPlaylistError extends Error {
  readonly code: AiPlaylistErrorCode;
  readonly retryAfterSec?: number;
  readonly got?: number;

  constructor(code: AiPlaylistErrorCode, message: string, extra?: { retryAfterSec?: number; got?: number }) {
    super(message);
    this.name = 'AiPlaylistError';
    Object.setPrototypeOf(this, AiPlaylistError.prototype);
    this.code = code;
    this.retryAfterSec = extra?.retryAfterSec;
    this.got = extra?.got;
  }
}

/** app ka Vercel base config nahi hua — deploy hone tak feature dead */
function assertBaseUrl(): void {
  if (BASE_URL.length === 0 || /YOUR-|YAHAN_/i.test(BASE_URL)) {
    throw new AiPlaylistError(
      'network',
      'Server URL missing — mobile/.env me EXPO_PUBLIC_YOUTUBE_MATCH_URL set karo',
    );
  }
}

/** 13a taste snapshot compact — top-10 songs/artists + top-5 queries */
function compactTaste() {
  const taste = getTasteStats();
  const signals = getRecentSignals(1000);
  const songIds = Object.entries(taste.songs)
    .sort(([, a], [, b]) =>
      (b.completions * 2 + b.plays + b.likes * 2 + b.playlistAdds) -
      (a.completions * 2 + a.plays + a.likes * 2 + a.playlistAdds),
    )
    .slice(0, 10)
    .map(([songId, stats]) => {
      const plays = stats.plays + stats.completions;
      return `${songId} (${plays} plays)`;
    });
  return {
    topSongs: songIds,
    topArtists: artistStatsFromSignals(signals)
      .filter(entry => entry.score > 0)
      .slice(0, 10)
      .map(entry => entry.name),
    recentQueries: Object.keys(taste.queries)
      .slice(-5)
      .reverse(),
  };
}

/**
 * Server ko prompt bhejo → sanitized {title, artist} refs.
 * Taste block fail-safe: signals service unavailable ho to bhi prompt chale.
 */
export async function generatePlaylist(
  prompt: string,
  options?: { refineText?: string },
): Promise<{ tracks: AiTrackRef[]; remaining: number }> {
  assertBaseUrl();
  const trimmed = prompt.trim();
  if (trimmed.length < 2) {
    throw new AiPlaylistError('bad_request', 'Prompt thoda lamba likh do (min 2 chars)');
  }

  const identity = await getOrCreateDeviceIdentity();
  let taste: ReturnType<typeof compactTaste> | undefined;
  try {
    taste = compactTaste();
  } catch (err) {
    console.warn('[ai-playlist] taste snapshot failed, continuing without:', err);
  }

  let response;
  try {
    response = await axios.post(
      `${BASE_URL}/api/ai-playlist`,
      {
        prompt: trimmed,
        deviceId: identity.deviceId,
        taste,
        refineText: options?.refineText?.trim() || undefined,
      },
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { error?: string; retryAfterSec?: number } | undefined;
      const status = err.response?.status;
      if (data?.error === 'no_key') {
        throw new AiPlaylistError('no_key', 'AI key server pe set nahi hai — deploy baad me feature live hoga');
      }
      if (status === 429 || data?.error === 'rate_limited') {
        const retry = typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : 60;
        throw new AiPlaylistError(
          'rate_limited',
          `Thoda ruk jao — try again ${Math.ceil(retry)}s me`,
          { retryAfterSec: retry },
        );
      }
      if (data?.error === 'bad_request' || status === 400) {
        throw new AiPlaylistError('bad_request', 'Prompt thoda sahi likho — min 2 chars, max 240');
      }
      if (status === 502 || data?.error === 'upstream') {
        throw new AiPlaylistError('upstream', 'AI provider se connect nahi hua — dobara try karo');
      }
      throw new AiPlaylistError('network', 'Network ya CORS issue — internet ya server check karo');
    }
    throw err;
  }

  const tracks = sanitizeAiTracks(response.data?.tracks);
  if (tracks.length === 0) {
    throw new AiPlaylistError('upstream', 'AI ne koi usable track nahi diya — dobara try karo');
  }
  const remaining = typeof response.data?.remaining === 'number' ? response.data.remaining : 0;
  return { tracks, remaining };
}

/**
 * Gemini refs ko playable Songs me resolve karo — per-candidate search chain,
 * 30s-preview-only results drop (full stream nahi milega), duplicates dedupe.
 * Playable < AI_MIN_PLAYABLE → not_enough (honest partial bhi nahi banate).
 */
export async function resolveCandidates(tracks: AiTrackRef[]): Promise<AiPlanRow[]> {
  const searchCache = new Map<string, Song[]>();

  // Parallel search to resolve candidates quickly without blocking UI
  const searchResults = await Promise.all(
    tracks.map(async track => {
      const query = `${track.title} ${track.artist}`.trim();
      const cacheKey = query.toLowerCase();
      const cached = searchCache.get(cacheKey);
      if (cached) return cached;
      try {
        const results = await searchSongs(query, 5);
        searchCache.set(cacheKey, results);
        return results;
      } catch (err) {
        console.warn('[ai-playlist] search failed for query:', query, err);
        return [];
      }
    }),
  );

  const playable: Song[] = [];
  for (const results of searchResults) {
    const fullStream = results.filter(song => song.previewOnly !== true);
    if (fullStream.length > 0) {
      playable.push(...fullStream);
    } else if (results.length > 0) {
      playable.push(...results);
    }
  }

  const rows = dedupePlanRows(planMatchedRows(tracks, playable));
  const playableCount = countPlayable(rows);
  if (playableCount < 1) {
    throw new AiPlaylistError(
      'not_enough',
      'Koi gaana match nahi hua — dobara generate karo ya prompt badlo',
      { got: 0 },
    );
  }
  return rows;
}

/* ------------------------------ prompt history ------------------------------ */

/** @pb_ai_prompts restore — partial-corruption raw ke liye fail-safe parse */
export async function loadPromptHistory(): Promise<AiPromptHistoryEntry[]> {
  const raw = await getAiPromptHistoryRaw();
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      entry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as AiPromptHistoryEntry).prompt === 'string' &&
        typeof (entry as AiPromptHistoryEntry).ts === 'string',
    )
    .map(entry => {
      const record = entry as AiPromptHistoryEntry;
      const next: AiPromptHistoryEntry = { prompt: record.prompt, ts: record.ts };
      if (typeof record.refineText === 'string' && record.refineText.length > 0) {
        next.refineText = record.refineText;
      }
      return next;
    })
    .slice(0, 10);
}

export async function appendPromptHistory(
  history: AiPromptHistoryEntry[],
  entry: AiPromptHistoryEntry,
): Promise<AiPromptHistoryEntry[]> {
  const next = mergePromptHistory(history, entry);
  await saveAiPromptHistory(next);
  return next;
}

/* ------------------------------ screen helpers (toast/alert) ------------------------------ */

/** friendly Hinglish error surface — codes har action screen se aate hain */
export function describeAiPlaylistError(err: unknown): string {
  const isCustomAiError =
    err instanceof AiPlaylistError ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AiPlaylistError');

  if (isCustomAiError) {
    const aiErr = err as AiPlaylistError;
    switch (aiErr.code) {
      case 'no_key':
        return 'AI key server pe set nahi hai — deploy baad me feature live hoga';
      case 'rate_limited':
        return `Thoda ruk jao — try again ${Math.ceil(aiErr.retryAfterSec ?? 60)}s me`;
      case 'not_enough':
        return `Match kam mile (${aiErr.got ?? 0}) — dobara generate karo ya prompt badlo`;
      case 'network':
        return aiErr.message || 'Network issue — internet check karo';
      case 'bad_request':
        return aiErr.message || 'Prompt thoda sahi likho — min 2 chars, max 240';
      default:
        return 'AI provider se connect nahi hua — dobara try karo';
    }
  }
  if (axios.isAxiosError(err)) {
    if (err.response?.data?.error === 'no_key') {
      return 'AI key server pe set nahi hai — deploy baad me feature live hoga';
    }
    if (err.response?.status === 429) {
      return 'Rate limit hit — thodi der baad try karo';
    }
    return 'Network ya CORS issue — server reach nahi hua';
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Playlist generate nahi hua — dobara try karo';
}
