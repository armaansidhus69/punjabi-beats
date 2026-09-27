/**
 * Formatting helpers — player timestamps ke liye (pure functions, testable).
 */

/** ms → "m:ss" (e.g. 185000 → "3:05"); invalid/negative pe "0:00" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** position/duration ka 0..1 ratio — duration 0 pe safe (NaN nahi deta) */
export function progressRatio(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / duration));
}
