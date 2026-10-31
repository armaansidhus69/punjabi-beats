/**
 * AI assistant service (Phase 13c) — server intent-proto + client execution.
 *
 * Quick commands OFFLINE yahin pehle solve hote; baaki server ko jata (same
 * GEMINI key reuse, 13b). Execution playerStore/musicApi local APIs pe —
 * playback local hai, sirf intent server se aata.
 */

import axios from 'axios';
import { getOrCreateDeviceIdentity } from '../core/auth/identity';
import {
  defaultReplyFor,
  makeTurnWindow,
  matchLocalQuickCommand,
  truncateReply,
  validateAssistantReply,
} from '../core/ai/assistant';
import { artistStatsFromSignals } from '../core/signals/stats';
import { getRecentSignals } from './signalsService';
import { searchSongs } from './musicApi';
import type { AssistantAction, AssistantArgs, AssistantMessage, AssistantReply, Song } from '../types';
import { usePlayer } from '../stores/playerStore';
import { usePlaylists } from '../stores/playlistStore';

/** server POST budget — Vercel cold + Gemini 20s, buffer same 13b jaisa */
const REQUEST_TIMEOUT_MS = 25_000;
const BASE_URL = (process.env.EXPO_PUBLIC_YOUTUBE_MATCH_URL ?? '').replace(/\/+$/, '');

export type AiAssistantErrorCode =
  | 'no_key'
  | 'rate_limited'
  | 'upstream'
  | 'not_enough'
  | 'network'
  | 'bad_request';

export class AiAssistantError extends Error {
  readonly code: AiAssistantErrorCode;
  readonly retryAfterSec?: number;
  readonly got?: number;

  constructor(code: AiAssistantErrorCode, message: string, extra?: { retryAfterSec?: number; got?: number }) {
    super(message);
    this.name = 'AiAssistantError';
    Object.setPrototypeOf(this, AiAssistantError.prototype);
    this.code = code;
    this.retryAfterSec = extra?.retryAfterSec;
    this.got = extra?.got;
  }
}

function assertBaseUrl(): void {
  if (BASE_URL.length === 0 || /YOUR-|YAHAN_/i.test(BASE_URL)) {
    throw new AiAssistantError('network', 'Server URL missing — mobile/.env me EXPO_PUBLIC_YOUTUBE_MATCH_URL set karo');
  }
}

/** privacy boundary — sirf top-5 artist names (ids/queries/ledger NAHI) */
function privateSafeTaste(): { topArtists: string[] } | undefined {
  try {
    const artists = artistStatsFromSignals(getRecentSignals(1000))
      .filter(entry => entry.score > 0)
      .slice(0, 5)
      .map(entry => entry.name);
    return { topArtists: artists };
  } catch (err) {
    console.warn('[ai-assistant] taste snapshot failed, plain chat mode:', err);
    return undefined;
  }
}

/* ------------------------------ execution ------------------------------ */

/** search chain resolve — previewOnly drop (30s previews discard) */
async function resolveQuery(query: string, limit = 5): Promise<Song[]> {
  try {
    const results = await searchSongs(query, limit);
    const full = results.filter(song => song.previewOnly !== true);
    return full.length > 0 ? full : results;
  } catch (err) {
    console.warn('[ai-assistant] search failed:', query, err);
    return [];
  }
}

/**
 * Reply → player/catalog execution. Returns:
 * - results (Song[]) catalog-facing actions ke liye — bubble me cards
 * - playedFirstSirf ho to bhi ok; transport actions [] de
 */
export async function executeAssistantAction(action: AssistantAction, args: AssistantArgs): Promise<Song[]> {
  const player = usePlayer.getState();

  switch (action) {
    case 'pause':
      await player.pause();
      return [];
    case 'next':
      await player.playNext();
      return [];
    case 'prev':
      await player.playPrev();
      return [];
    case 'play': {
      const songs = await resolveQuery(args.query ?? '');
      if (songs.length === 0) {
        throw new AiAssistantError('not_enough', `Is query pe kuch nahi mila — "${args.query ?? ''}"`);
      }
      await player.playSong(songs[0], [songs[0]], { startPaused: false });
      return songs.slice(0, 3);
    }
    case 'search':
    case 'queue_add': {
      const songs = await resolveQuery(args.query ?? '');
      if (songs.length === 0) {
        throw new AiAssistantError('not_enough', `Is query pe kuch nahi mila — "${args.query ?? ''}"`);
      }
      if (action === 'queue_add') {
        const added = await player.addToQueue(songs[0]);
        if (!added) {
          throw new AiAssistantError('not_enough', 'Queue me add nahi hua (duplicate ya queue busy)');
        }
        return [];
      }
      return songs.slice(0, 3);
    }
    case 'create_playlist': {
      const songs = await resolveQuery(args.query ?? '', Math.max(10, args.count ?? 5));
      if (songs.length < Math.min(3, args.count ?? 5)) {
        throw new AiAssistantError('not_enough', 'Theme pe gaane kam mile — doosra shabad try karo');
      }
      const playlists = usePlaylists.getState();
      const playlist = playlists.createPlaylist(args.name ?? `AI: ${args.query ?? 'playlist'}`);
      const toAdd = songs.slice(0, args.count ?? 5);
      for (const song of toAdd) {
        await playlists.addSongToPlaylist(playlist.id, song);
      }
      return toAdd.slice(0, 3);
    }
    default:
      return []; // chat — text-only bubble
  }
}

/* ------------------------------ send flow ------------------------------ */

/**
 * Public: message → (local quick | server) → reply + optional result songs.
 * Caller (store) bubble history/side-effects handle karta hai.
 */
export async function sendMessage(
  message: string,
  history: AssistantMessage[],
): Promise<{ reply: AssistantReply; results: Song[]; remaining: number | null; local: boolean }> {
  const trimmed = truncateReply(message);
  if (trimmed.length === 0 || trimmed.length > 240) {
    throw new AiAssistantError('bad_request', 'Message thoda lamba likh do (max 240 chars)');
  }

  // 1) local quick command — OFFLINE, rate limit khaata nahi
  const quick = matchLocalQuickCommand(trimmed);
  if (quick) {
    const results = await executeAssistantAction(quick.action, quick.args);
    return {
      reply: { action: quick.action, args: quick.args, reply: defaultReplyFor(quick.action) },
      results,
      remaining: null,
      local: true,
    };
  }

  // 1b) shuffle quick — player-local toggle (transport V1 me instant UX)
  if (/^(shuffle|shuffle on|mix)$/i.test(trimmed)) {
    usePlayer.getState().toggleShuffle();
    return {
      reply: { action: 'chat', args: {}, reply: 'Shuffle toggle ho gaya.' },
      results: [],
      remaining: null,
      local: true,
    };
  }

  // 2) server intent protocol
  assertBaseUrl();
  const identity = await getOrCreateDeviceIdentity();
  const turns = makeTurnWindow(
    history.filter(entry => !entry.failed),
    trimmed,
  );

  let response;
  try {
    response = await axios.post(
      `${BASE_URL}/api/ai-assistant`,
      {
        message: trimmed,
        deviceId: identity.deviceId,
        turns,
        taste: privateSafeTaste(),
      },
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { error?: string; retryAfterSec?: number } | undefined;
      const status = err.response?.status;
      if (data?.error === 'no_key') {
        throw new AiAssistantError('no_key', 'AI key server pe set nahi hai — deploy baad me feature live hoga');
      }
      if (status === 429 || data?.error === 'rate_limited') {
        const retry = typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : 60;
        throw new AiAssistantError(
          'rate_limited',
          `Thoda ruk jao — try again ${Math.ceil(retry)}s me`,
          { retryAfterSec: retry },
        );
      }
      if (data?.error === 'bad_request' || status === 400) {
        throw new AiAssistantError('bad_request', 'Message thoda lamba likh do (max 240 chars)');
      }
      if (status === 502 || data?.error === 'upstream') {
        throw new AiAssistantError('upstream', 'AI assistant connect nahi hua — dobara try karo');
      }
      throw new AiAssistantError('network', 'Network ya CORS issue — internet ya server check karo');
    }
    throw err;
  }

  const reply = validateAssistantReply(response.data);
  if (!reply) {
    throw new AiAssistantError('upstream', 'AI intent samajh nahi aaya — dobara try karo');
  }
  const remaining = typeof response.data?.remaining === 'number' ? response.data.remaining : null;
  const results = await executeAssistantAction(reply.action, reply.args);
  return { reply, results, remaining, local: false };
}

/** Hinglish error surface — store toasts isko call karte */
export function describeAiAssistantError(err: unknown): string {
  const isCustomAiError =
    err instanceof AiAssistantError ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AiAssistantError');

  if (isCustomAiError) {
    const aiErr = err as AiAssistantError;
    switch (aiErr.code) {
      case 'no_key':
        return 'AI key server pe set nahi hai — deploy baad me feature live hoga';
      case 'rate_limited':
        return `Thoda ruk jao — try again ${Math.ceil(aiErr.retryAfterSec ?? 60)}s me`;
      case 'not_enough':
        return aiErr.message;
      case 'bad_request':
        return 'Message thoda lamba likh do (max 240 chars)';
      case 'network':
        return aiErr.message || 'Network issue — internet check karo';
      default:
        return 'AI assistant connect nahi hua — dobara try karo';
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
  return 'Assistant ne jawab nahi diya — dobara try karo';
}
