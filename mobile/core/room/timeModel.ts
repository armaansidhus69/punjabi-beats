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

export type ClockSample = { offset: number; rtt: number; at: number };

/**
 * NTP-style high-precision clock synchronizer.
 * Keeps a rolling window of samples and trusts lowest RTT samples to compute median offset.
 */
export class NtpClock {
  private samples: ClockSample[] = [];
  offset = 0;
  rtt = 0;
  jitter = 0;
  quality = 0;
  syncing = false;
  lastSyncAt = 0;

  get confidence(): 'excellent' | 'good' | 'weak' | 'none' {
    if (!this.samples.length) return 'none';
    if (this.rtt < 45 && this.jitter < 12) return 'excellent';
    if (this.rtt < 130) return 'good';
    if (this.rtt < 400) return 'weak';
    return 'none';
  }

  /** Best estimate of server wall-clock time right now. */
  now(): number {
    return Date.now() + this.offset;
  }

  /** Half the RTT + jitter: irreducible uncertainty */
  uncertainty(): number {
    return this.rtt / 2 + this.jitter;
  }

  push(offset: number, rtt: number): void {
    this.samples.push({ offset, rtt, at: Date.now() });
    if (this.samples.length > 24) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(4, Math.ceil(sorted.length / 2)));
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)] ?? offset;
    const spread =
      offsets.length > 1
        ? (offsets[offsets.length - 1] - offsets[0]) / 2
        : 0;
    this.offset = Math.round(median);
    this.rtt = Math.round(sorted[0]?.rtt ?? rtt);
    this.jitter = Math.round(spread);
    this.quality = best.length;
    this.lastSyncAt = Date.now();
  }

  async sync(endpoint: string, token = '', rounds = 5): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      for (let i = 0; i < rounds; i += 1) {
        const t0 = Date.now();
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (token) headers['x-publish-token'] = token;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ t0 }),
        });
        const t3 = Date.now();
        if (!res.ok) break;
        const data = (await res.json()) as { t1: number; t2: number };
        const rtt = t3 - t0 - (data.t2 - data.t1);
        const offset = (data.t1 - t0 + (data.t2 - t3)) / 2;
        this.push(offset, Math.max(0, rtt));
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch {
      // safe fallback on network fail
    } finally {
      this.syncing = false;
    }
  }

  history(): ClockSample[] {
    return this.samples.slice(-16);
  }
}

