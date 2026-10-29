/**
 * Room time model (Phase 11 Jam) — server-authoritative playback math.
 *
 * Server row: { position_ms, is_playing, updated_at (server clock),
 * state_version }. Clients predict apni position server time se — device
 * clock skew first sync pe capture hota hai, uske baad sab math
 * server-adjusted time me chalta hai.
 *
 * Pure logic — koi RN/Supabase import nahi (test-jam.mjs headless chalta hai).
 */

import type { JamPlaybackState } from '../../types';

/** |drift| isse chhota → correction ki zaroorat nahi */
export const SYNC_EPSILON_MS = 250;
/** |drift| ≤ 2s → smooth micro-correction; > 2s → hard seek (spec) */
export const SYNC_SMOOTH_MAX_MS = 2000;
/** smooth correction rate: ≤ 0.5s drift per minute tween (spec) */
export const SYNC_DRIFT_MS_PER_MIN = 500;

/** presence heartbeat: 30s interval, stale > 90s = offline render (spec) */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const PRESENCE_STALE_MS = 90_000;

/**
 * Clock skew capture — server wall-clock minus device wall-clock, ms me.
 * Approximation: server `updated_at` (ya any server-issued ISO) + receive
 * moment ka device time. Ek session me once capture hota hai; baad me
 * sab server-time queries `serverNow(deviceNowMs, skew)` se.
 */
export function captureClockSkew(serverIso: string, deviceNowMs: number): number {
  const serverMs = Date.parse(serverIso);
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - deviceNowMs;
}

/** device time → server-adjusted time (skew add) */
export function serverNow(deviceNowMs: number, skewMs: number): number {
  return deviceNowMs + skewMs;
}

/**
 * Predicted playback position — is_playing ho to base position + elapsed
 * (server-ajdusted now − updated_at); warna base hi. Negative elapsed
 * clamp hota hai (future-dated row / clock jitter).
 */
export function predictPositionMs(state: JamPlaybackState, nowServerMs: number): number {
  if (!state.isPlaying) return state.positionMs;
  const updatedMs = Date.parse(state.updatedAt);
  if (Number.isNaN(updatedMs)) return state.positionMs;
  const elapsed = Math.max(0, nowServerMs - updatedMs);
  return state.positionMs + elapsed;
}

export type SyncAction = 'none' | 'smooth' | 'seek';

export interface SyncEvaluation {
  /** local − server drift, ms (positive = aage chal raha hai) */
  driftMs: number;
  action: SyncAction;
  /** seek case me target position (server ka predicted position) */
  seekToMs: number | null;
}

/**
 * Correction policy (spec): |drift| ≤ 0.25s → none; ≤ 2s → smooth
 * (nudge); > 2s → hard seek. Naya track_id alag level pe handle hota hai
 * (queue load + play) — ye sirf same-track drift policy hai.
 */
export function evaluateSync(
  state: JamPlaybackState,
  nowServerMs: number,
  localPositionMs: number,
): SyncEvaluation {
  const serverPosition = predictPositionMs(state, nowServerMs);
  const driftMs = localPositionMs - serverPosition;
  const magnitude = Math.abs(driftMs);

  if (magnitude <= SYNC_EPSILON_MS) {
    return { driftMs, action: 'none', seekToMs: null };
  }
  if (magnitude <= SYNC_SMOOTH_MAX_MS) {
    return { driftMs, action: 'smooth', seekToMs: null };
  }
  return { driftMs, action: 'seek', seekToMs: serverPosition };
}

/**
 * Smooth correction ke liye tween duration — drift ko SYNC_DRIFT_MS_PER_MIN
 * rate se cover karne ka ms. Clamp 0...∞ (caller player se laagu karta hai).
 */
export function smoothCorrectionDurationMs(driftMs: number): number {
  return (Math.abs(driftMs) / SYNC_DRIFT_MS_PER_MIN) * 60_000;
}

/** presence — member ka last_seen stale hai? (offline render) */
export function isPresenceStale(lastSeenIso: string, nowMs: number): boolean {
  const seen = Date.parse(lastSeenIso);
  if (Number.isNaN(seen)) return true;
  return nowMs - seen > PRESENCE_STALE_MS;
}
