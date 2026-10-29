/**
 * Signals schema + ledger helpers (Phase 13a) — pure.
 *
 * Contract: fail-closed — unknown event name / invalid shape drop hota hai
 * (throw nahi caller pe; console.warn service me hopeful). Ledger version
 * mismatch → fresh start (spec Section 7).
 */

import type { PlaySignal, SignalsLedger, SignalName } from '../../types';
import { fnv1a64Hex } from '../blend/snapshot.ts';

export const SIGNALS_VERSION = 1;

/** @pb_play_signals ledger cap — oldest-first drop (service persist pe) */
export const MAX_LEDGER_SIGNALS = 1000;

/** Playback events jinke fields se PlaySignal banta hai (songli context) */
export interface SignalSeed {
  songId?: string | null;
  artistNames?: string[];
  provider?: PlaySignal['provider'];
  durationMs?: number;
  positionMs?: number;
  ended?: boolean;
  manual?: boolean;
  remote?: boolean;
}

export function isSignalName(name: string): name is SignalName {
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

/** clamps + defaults ek jagah — callers raw values pass kar sake */
export function buildSignal(
  name: SignalName,
  seed: SignalSeed & { query?: string },
  nowIso: string,
): PlaySignal {
  const songId = seed.songId ?? null;
  const query = name === 'search_query' ? (seed.query ?? null) : null;
  return {
    id: fnv1a64Hex([name, songId ?? query ?? '', nowIso]),
    name,
    songId,
    query,
    artistNames: normalizeArtistNames(seed.artistNames ?? []),
    provider: seed.provider ?? null,
    durationMs: Math.max(0, Math.round(seed.durationMs ?? 0)),
    positionMs: Math.max(0, Math.round(seed.positionMs ?? 0)),
    completedPct: clampPct(seed.positionMs ?? 0, seed.durationMs ?? 0),
    ended: seed.ended === true,
    manual: seed.manual === true,
    remote: seed.remote === true,
    ts: nowIso,
  };
}

/** play signal ke liye bina completed-pct recalc (search_query walo ke liye) */
function clampPct(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const pct = (Math.max(0, positionMs) / durationMs) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** blend pattern: comma-split lowercase, per-signal dedupe (artist "A, B") */
export function normalizeArtistNames(raw: string[]): string[] {
  const parts = raw
    .flatMap(entry => entry.split(','))
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);
  return Array.from(new Set(parts));
}

export function createLedger(): SignalsLedger {
  return { version: SIGNALS_VERSION, signals: [] };
}

/**
 * AsyncStorage raw → ledger: version mismatch → discard; schema-invalid
 * rows drop, valid bachte (recently-played partial corruption pattern).
 */
export function normalizeLedger(raw: unknown): SignalsLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return createLedger();
  }
  const candidate = raw as SignalsLedger;
  if (candidate.version !== SIGNALS_VERSION || !Array.isArray(candidate.signals)) {
    return createLedger();
  }
  return { version: SIGNALS_VERSION, signals: candidate.signals.filter(isValidSignal) };
}

/** shape guard — PlaySignal ke saare fields type-safe present ho */
export function isValidSignal(entry: unknown): entry is PlaySignal {
  if (entry === null || typeof entry !== 'object') return false;
  const signal = entry as PlaySignal;
  if (!isSignalName(String(signal.name))) return false;
  if (typeof signal.id !== 'string' || signal.id.length === 0) return false;
  if (typeof signal.ts !== 'string' || signal.ts.length === 0) return false;
  if (signal.query !== null && typeof signal.query !== 'string') return false;
  if (!Array.isArray(signal.artistNames)) return false;
  if (typeof signal.durationMs !== 'number' || typeof signal.positionMs !== 'number') return false;
  if (typeof signal.completedPct !== 'number') return false;
  if (typeof signal.ended !== 'boolean' || typeof signal.manual !== 'boolean' || typeof signal.remote !== 'boolean') return false;
  return true;
}

/** append + cap 1000 — oldest-first array me oldest drop (pure) */
export function pushSignal(ledger: SignalsLedger, signal: PlaySignal): SignalsLedger {
  const signals = [...ledger.signals, signal];
  // negative slice index bug: chhote ledger me slice(-x) tail-only deta hai
  return {
    version: SIGNALS_VERSION,
    signals: signals.length > MAX_LEDGER_SIGNALS ? signals.slice(signals.length - MAX_LEDGER_SIGNALS) : signals,
  };
}
