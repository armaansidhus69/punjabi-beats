/**
 * Podcast progress policy (Phase 12a) — resume + played state, pure.
 *
 * spec: played = positionMs ≥ 0.95 × durationMs (durationMs > 0). `played`
 * sticky true — re-watch se flip nahi hota. Position clamp 0..durationMs.
 */

import type { PodcastProgressEntry } from '../../types';

/** 95% boundary — durationMs 0 (unknown) kabhi played nahi hota */
const PLAYED_THRESHOLD = 0.95;

export function isEpisodePlayed(
  record: Pick<PodcastProgressEntry, 'positionMs' | 'durationMs' | 'played'>,
): boolean {
  if (record.played) return true;
  if (record.durationMs <= 0) return false;
  return record.positionMs >= PLAYED_THRESHOLD * record.durationMs;
}

/**
 * upsert shape — previous se merge: metadata previous se rehydrate ho
 * (caller sirf episode id + naya position/duration bheje), played sticky,
 * position clamp 0..duration.
 */
export function mergeProgress(
  previous: PodcastProgressEntry | null,
  patch: Pick<PodcastProgressEntry, 'positionMs' | 'durationMs' | 'title' | 'showTitle' | 'artworkUrl' | 'audioUrl'>,
  nowIso: string,
): PodcastProgressEntry {
  const durationMs = Math.max(0, Math.round(patch.durationMs));
  const maxPosition = durationMs > 0 ? durationMs : Math.max(0, Math.round(patch.positionMs));
  const positionMs = Math.max(0, Math.min(Math.round(patch.positionMs), maxPosition));
  return {
    positionMs,
    durationMs,
    played: (previous?.played ?? false) || isEpisodePlayed({ positionMs, durationMs, played: false }),
    updatedAt: nowIso,
    title: previous?.title ?? patch.title,
    showTitle: previous?.showTitle ?? patch.showTitle,
    artworkUrl: previous?.artworkUrl ?? patch.artworkUrl,
    audioUrl: previous?.audioUrl ?? patch.audioUrl,
  };
}
