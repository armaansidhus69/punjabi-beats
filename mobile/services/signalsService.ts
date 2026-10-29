/**
 * Signals service (Phase 13a) — analytics facade ka sink + taste ledger.
 *
 * Core←service dependency direction: core/signals pure hai, yahan sirf
 * binding hoti hai (AsyncStorage + queue). Play path block nahi hota —
 * writes queued fire-and-forget (likedSongsStore persistQueue pattern).
 */

import type { PlaySignal, SignalName, SignalsLedger, SongSource, TasteStats } from '../types';
import { buildSignal, normalizeLedger, pushSignal, type SignalSeed } from '../core/signals/schema';
import { aggregateSignals, applySignal } from '../core/signals/stats';
import {
  getPlaySignalsLedger,
  savePlaySignalsLedger,
  saveTasteStatsRaw,
} from './storage';

/** in-memory live rows — service single source of truth */
let ledger: SignalsLedger = { version: 1, signals: [] };
let stats: TasteStats = { songs: {}, queries: {} };
let persistQueued: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------ persist queue ------------------------------ */

function schedulePersist(): void {
  if (persistQueued !== null) return;
  persistQueued = setTimeout(() => {
    persistQueued = null;
    void savePlaySignalsLedger(ledger);
    void saveTasteStatsRaw(stats);
  }, 250);
}

/* ------------------------------ record path (analytics sink) ------------------------------ */

/**
 * analytics facade sink — `trackEvent(name, properties)` yahan aata hai.
 * PlaySignal build + stats increment + ledger append + cap 1000, sab sync
 * in-memory; persist background. Invalid/unknown → drop (fail-closed).
 */
export function recordSignal(
  name: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  const nowIso = new Date().toISOString();
  const signal = buildEventSignal(name, properties ?? {}, nowIso);
  if (signal === null) {
    console.warn('[signals] dropped invalid event:', name);
    return;
  }
  ledger = pushSignal(ledger, signal); // core helper — cap oldest-drop saath
  stats = applySignal(stats, signal);
  schedulePersist();
}

/** in-memory current snapshot (13b consumers / screens) */
export function getTasteStats(): TasteStats {
  return stats;
}

export function getSignalCount(): number {
  return ledger.signals.length;
}

/** newest-last order — slice from tail */
export function getRecentSignals(limit: number): PlaySignal[] {
  const count = Math.max(0, limit);
  return ledger.signals.slice(Math.max(0, ledger.signals.length - count));
}

/* ------------------------------ properties mapping ------------------------------ */

/** analytics properties (flat) → PlaySignal build; unknown/invalid → null */
function buildEventSignal(
  name: string,
  properties: Record<string, string | number | boolean | null>,
  nowIso: string,
): PlaySignal | null {
  if (!isKnownSignalName(name)) return null;
  const signalName: SignalName = name;

  const seed: SignalSeed & { query?: string } = {
    songId: asOptString(properties.songId),
    artistNames: asArray(properties.artistNames),
    provider: asSongSource(properties.provider),
    durationMs: asNumber(properties.durationMs),
    positionMs: asNumber(properties.positionMs),
    ended: properties.ended === true,
    manual: properties.manual === true,
    remote: properties.remote === true,
    query: asOptString(properties.query) ?? undefined,
  };

  if (signalName === 'search_query') {
    const query = (seed.query ?? '').trim();
    if (query.length < 2) return null; // search screen MIN_QUERY_LENGTH parity
    return buildSignal(signalName, { ...seed, songId: null, artistNames: [], query }, nowIso);
  }

  // non-search events songId-mandatory — bina song ke taste signal nahi
  if (seed.songId === null) return null;
  return buildSignal(signalName, seed, nowIso);
}

function isKnownSignalName(name: string): name is SignalName {
  return (
    name === 'play_start' ||
    name === 'play_complete' ||
    name === 'play_skip' ||
    name === 'song_like' ||
    name === 'song_unlike' ||
    name === 'playlist_add' ||
    name === 'playlist_remove' ||
    name === 'search_query'
  );
}

function asOptString(value: string | number | boolean | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: string | number | boolean | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** SongSource union guard — unknown provider string drop to null (fail-safe) */
function asSongSource(value: string | number | boolean | null | undefined): SongSource | null {
  const allowed: SongSource[] = ['jiosaavn', 'audius', 'itunes', 'jamendo', 'gaana', 'youtube_music'];
  const source = allowed.find(candidate => candidate === value);
  return source ?? null;
}

/** analytics flat property me artists space/comma-list string aate hain */
function asArray(value: string | number | boolean | null | undefined): string[] {
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

/* ------------------------------ boot restore ------------------------------ */

/**
 * app start — ledger restore + partial-corruption drop + stats one-time
 * recompute (ledger hi truth hai; persisted stats read nahi hote).
 * Note: search queries ledger ke pehle purge ho chuki ho to tally zero —
 * accepted (queries re-record hoti rehti hain).
 */
export async function loadSignals(): Promise<void> {
  const restored = normalizeLedger(await getPlaySignalsLedger());
  ledger = restored;
  stats = aggregateSignals(restored.signals);
}
