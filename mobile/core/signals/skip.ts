/**
 * Playback skip/complete policy (Phase 13a) — pure, spec Section 4.
 *
 * Track change pe OUTGOING track ke playerStore position/duration inputs se
 * decision aata hai. Auto-failure advance caller-side datasuppress hota hai
 * (flag consume) — policy ko pata nahi chalta, saaf boundary.
 */

export const MIN_SIGNAL_DURATION_MS = 30_000;
export const SKIP_THRESHOLD_PCT = 80;
export const COMPLETE_THRESHOLD_PCT = 95;

export type PlaybackSignalName = 'play_complete' | 'play_skip';

/** 0..100 — duration 0/NaN pe 0 (podcast unknown-duration safe) */
export function completedPct(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  const pct = (Math.max(0, positionMs) / durationMs) * 100;
  return Math.min(100, Math.max(0, pct));
}

export interface PlaybackSample {
  durationMs: number;
  positionMs: number;
  /** queue-end / track-complete coordinate (state jhoot bole to ended wins) */
  ended?: boolean;
  /** manual next/prev pe true — koi bhi time auto-advance flag consume hone ke baad */
  manual?: boolean;
  /** room-follow play skip — taste exclude, signal nahi */
  remote?: boolean;
}

export function classifyPlayback(sample: PlaybackSample): PlaybackSignalName | null {
  const { durationMs } = sample;
  if (durationMs <= MIN_SIGNAL_DURATION_MS) return null;
  if (sample.remote === true) return null;
  const pct = completedPct(sample.positionMs, durationMs);
  if (sample.ended === true || pct >= COMPLETE_THRESHOLD_PCT) return 'play_complete';
  if (pct >= SKIP_THRESHOLD_PCT) return null; // neutral zone
  if (sample.manual === true) return 'play_skip';
  return null;
}
