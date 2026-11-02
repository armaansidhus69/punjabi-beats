/**
 * Queue ops (Phase 5 completion) — pure queue transformations.
 *
 * Store (playerStore) inhe apne zustand state + TrackPlayer sync ke liye
 * use karta hai; yahan sirf pure array math hai — koi RN/track-player import
 * nahi, isliye node tests seedha chalate hain. Sab functions immutable hain
 * (naya array return, input mutate nahi).
 */

import type { Song } from '../../types';

export type QueueMove = 'up' | 'down';

/** Current playing ke baad wale items — Queue screen yehi list dikhata hai. */
export function upcomingSongs(queue: Song[], index: number): Song[] {
  return queue.slice(index + 1);
}

/**
 * Upcoming zone ke andar item move karo (current ke upar nahi ja sakta).
 * Missing id / boundary pe move → same order wapas (no-op).
 */
export function moveQueueItem(queue: Song[], songId: string, direction: QueueMove): Song[] {
  const index = queue.findIndex(item => item.id === songId);
  if (index < 1) return queue; // current (index 0 zone) ya missing — no-op
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 1 || target >= queue.length) return queue;
  const next = [...queue];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Queue se item hatao — current playing ko remove karna allowed nahi (no-op). */
export function removeQueueItem(queue: Song[], songId: string): Song[] {
  const index = queue.findIndex(item => item.id === songId);
  if (index <= 0) return queue;
  return queue.filter(item => item.id !== songId);
}

/**
 * 'Play next' — song ko current ke theek baad insert. Queue me pehle se ho to
 * duplicate nahi: use current ke baad move kar dete hain. Current na mile
 * (khali queue) to end me append.
 */
export function insertNext(queue: Song[], currentId: string | null, song: Song): Song[] {
  const without = queue.filter(item => item.id !== song.id);
  const anchor = currentId ? without.findIndex(item => item.id === currentId) : -1;
  const insertAt = anchor >= 0 ? anchor + 1 : without.length;
  const next = [...without];
  next.splice(insertAt, 0, song);
  return next;
}

/** Current ke baad sab kuch clear (index inclusive rakha jata hai). */
export function clearUpcoming(queue: Song[], index: number): Song[] {
  if (queue.length === 0) return queue;
  const head = queue.slice(0, index + 1);
  return head.length > 0 ? head : queue.slice(0, 1);
}
