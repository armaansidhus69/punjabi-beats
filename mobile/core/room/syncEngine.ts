/**
 * SyncRoom Core Sync Engine
 *
 * Server-authoritative anchor math, drift detection,
 * and round-robin fair turns queue ordering.
 * Pure logic — zero external or native dependencies.
 */
import type { PlaybackAnchor } from '../../types/syncroom';

export const DRIFT_THRESHOLD_MS = 400;
export const RESYNC_COOLDOWN_MS = 2500;

/**
 * Compute where the room playback should be right now in server-authoritative time.
 */
export function getIdealPositionMs(
  anchor: PlaybackAnchor,
  nowMs: number = Date.now()
): number {
  if (anchor.status !== 'playing' || !anchor.trackId) {
    return anchor.anchorPositionMs;
  }
  const elapsed = Math.max(0, nowMs - anchor.anchorServerTime);
  return anchor.anchorPositionMs + elapsed;
}

/**
 * Decide if client should hard-seek / resync.
 */
export function shouldResync(
  idealMs: number,
  localPositionMs: number,
  lastResyncAt?: number,
  nowMs: number = Date.now()
): boolean {
  if (lastResyncAt && nowMs - lastResyncAt < RESYNC_COOLDOWN_MS) return false;
  return Math.abs(idealMs - localPositionMs) > DRIFT_THRESHOLD_MS;
}

/**
 * Build a new anchor when host/cohost changes playback.
 */
export function createAnchor(
  trackId: string | null,
  positionMs: number,
  status: PlaybackAnchor['status'],
  prevVersion: number
): PlaybackAnchor {
  return {
    trackId,
    status,
    anchorPositionMs: Math.max(0, Math.floor(positionMs)),
    anchorServerTime: Date.now(),
    stateVersion: prevVersion + 1,
  };
}

/**
 * Fair-turns ordering helper (client-side preview).
 * Groups items by addedBy and round-robins so no single user starves the queue.
 */
export function buildFairOrder<T extends { addedBy: string; createdAt: string }>(
  items: T[]
): T[] {
  const byUser = new Map<string, T[]>();
  for (const item of items) {
    const list = byUser.get(item.addedBy) ?? [];
    list.push(item);
    byUser.set(item.addedBy, list);
  }
  // stable sort each user list by createdAt
  for (const list of byUser.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const users = [...byUser.keys()];
  const result: T[] = [];
  let round = 0;
  let added = true;
  while (added) {
    added = false;
    for (const u of users) {
      const list = byUser.get(u);
      if (list && list[round]) {
        result.push(list[round]);
        added = true;
      }
    }
    round++;
  }
  return result;
}

