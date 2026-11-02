/**
 * Sleep timer (Phase 5 completion) — pure timer math.
 *
 * Store (sleepTimerStore) interval chalata hai; yahan sirf compute/format.
 * Modes: fixed minutes ya 'end_of_track' (current gaana khatam hote hi pause —
 * position/duration check se, kyunki track-player me "end" event ka wait
 * fragile hota hai agar user seek kare).
 */

export type SleepMode = 'off' | '15' | '30' | '45' | '60' | 'end_of_track';

export const SLEEP_MINUTE_MS = 60_000;

export interface SleepOption {
  mode: SleepMode;
  label: string;
}

export const SLEEP_OPTIONS: SleepOption[] = [
  { mode: 'end_of_track', label: 'Is gaane ke baad' },
  { mode: '15', label: '15 minute' },
  { mode: '30', label: '30 minute' },
  { mode: '45', label: '45 minute' },
  { mode: '60', label: '1 ghanta' },
  { mode: 'off', label: 'Band karo' },
];

/** Fixed mode ka duration; 'off'/'end_of_track' → null. */
export function sleepDurationMs(mode: SleepMode): number | null {
  const minutes = Number(mode);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * SLEEP_MINUTE_MS;
}

/** 'off' → null (timer cancel). Fixed → endsAt timestamp. */
export function computeSleepEnd(mode: SleepMode, now: number): number | null {
  const duration = sleepDurationMs(mode);
  if (duration === null) return null;
  return now + duration;
}

/** Countdown label — "4:59", 1 ghante se upar "1:00:12". */
export function formatSleepRemaining(msRemaining: number): string {
  const clamped = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function isSleepExpired(endsAt: number | null, now: number): boolean {
  return endsAt !== null && now >= endsAt;
}

/** 'end_of_track' grace — seek edge pe turant pause na ho jaye. */
export const END_OF_TRACK_GRACE_MS = 700;

/**
 * End-of-track mode me pause karna hai? Position duration-grace ke paas pahunch
 * gaya ho. duration unknown (<=0) → false (kabhi pause nahi, safe default).
 */
export function shouldPauseEndOfTrack(positionMs: number, durationMs: number): boolean {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
  if (!Number.isFinite(positionMs) || positionMs < 0) return false;
  return positionMs >= durationMs - END_OF_TRACK_GRACE_MS;
}
