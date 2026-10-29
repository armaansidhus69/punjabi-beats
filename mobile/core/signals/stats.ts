/**
 * Taste stats aggregation (Phase 13a) — pure, spec Section 3.2/3.3.
 *
 * Raw counters hi store hote hain; scores consumer-time pure lagte hain —
 * weight tuning future me data corrupt na kare. Remote signals EXCLUDE
 * (room-follow plays taste me nahi ginte).
 */

import type { PlaySignal, TasteSongStats, TasteStats, TasteStatsMap } from '../../types';

export function createTasteStats(): TasteStats {
  return { songs: {}, queries: {} };
}

/** ek signal ka asar upsert — pure (callers state replace karte hain) */
export function applySignal(stats: TasteStats, signal: PlaySignal): TasteStats {
  if (signal.name === 'search_query') {
    if (signal.query === null) return stats;
    const key = signal.query.trim().toLowerCase();
    if (key.length === 0) return stats;
    return { ...stats, queries: { ...stats.queries, [key]: signal.query.trim() } };
  }
  if (signal.songId === null || signal.remote === true) return stats;

  const songs: TasteStatsMap = { ...stats.songs };
  const prev = songs[signal.songId] ?? emptyStats();
  const next: TasteSongStats = {
    ...prev,
    lastTs: signal.ts >= prev.lastTs ? signal.ts : prev.lastTs,
  };

  switch (signal.name) {
    case 'play_start':
      next.plays += 1;
      break;
    case 'play_complete':
      next.completions += 1;
      break;
    case 'play_skip':
      next.skips += 1;
      break;
    case 'song_like':
      next.likes = Math.max(0, next.likes + 1);
      break;
    case 'song_unlike':
      next.likes = Math.max(0, next.likes - 1);
      break;
    case 'playlist_add':
      next.playlistAdds = Math.max(0, next.playlistAdds + 1);
      break;
    case 'playlist_remove':
      next.playlistAdds = Math.max(0, next.playlistAdds - 1);
      break;
    default:
      break;
  }
  songs[signal.songId] = next;
  return { ...stats, songs };
}

/** poori ledger ek baar recompute (restore + corruption-recovery path) */
export function aggregateSignals(signals: PlaySignal[]): TasteStats {
  let stats = createTasteStats();
  for (const signal of signals) stats = applySignal(stats, signal);
  return stats;
}

function emptyStats(): TasteSongStats {
  return { plays: 0, completions: 0, skips: 0, likes: 0, playlistAdds: 0, lastTs: '' };
}

/* ------------------------------ consumer weights ------------------------------ */

/** spec 3.3 flat scoring — pure, data me store NAHI */
export function tasteSongScore(stats: TasteSongStats): number {
  return (
    1.0 * stats.completions +
    0.5 * stats.plays +
    2.0 * stats.likes +
    1.5 * stats.playlistAdds -
    0.5 * stats.skips
  );
}

/** blend `TasteArtist` shape parity — lowercase {name, count} + net score */
export interface TasteArtistStats {
  name: string;
  /** plays + completions rollup */
  count: number;
  /** 0.5*plays + 1.0*completions − 0.5*skips per artist */
  score: number;
}

/**
 * artist rollup `PlaySignal.artistNames` se — TasteSongStats me artists
 * store NAHI hote (songId keys hi); ledger scan (cap 1000) sasta padta hai.
 */
export function artistStatsFromSignals(signals: PlaySignal[]): TasteArtistStats[] {
  const byArtist = new Map<string, { count: number; score: number }>();
  for (const signal of signals) {
    if (signal.remote === true) continue;
    if (signal.name !== 'play_start' && signal.name !== 'play_complete' && signal.name !== 'play_skip') {
      continue;
    }
    for (const name of signal.artistNames) {
      const prev = byArtist.get(name) ?? { count: 0, score: 0 };
      const delta =
        signal.name === 'play_start'
          ? { count: 1, score: 0.5 }
          : signal.name === 'play_complete'
            ? { count: 1, score: 1.0 }
            : { count: 0, score: -0.5 };
      byArtist.set(name, { count: prev.count + delta.count, score: prev.score + delta.score });
    }
  }
  return Array.from(byArtist.entries())
    .map(([name, tallies]) => ({ name, count: tallies.count, score: tallies.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** songs top-N by taste score — 13b AI playlist generator ka seed input */
export function topSongIds(songs: TasteStatsMap, limit: number): { id: string; score: number }[] {
  return Object.entries(songs)
    .map(([id, stats]) => ({ id, score: tasteSongScore(stats) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}
