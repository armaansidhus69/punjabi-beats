/**
 * Recommendations v1 (Phase 13 non-AI) — signals ledger se taste ranking.
 *
 * Plan ka "initial version": recently played + liked + artist preference.
 * Weight formula yahan pure hai (weight tuning future me data corrupt na kare,
 * raw counters TasteStats me hi rehte hain). artistLookup consumer deta hai —
 * signalsService ledger se songId → artistNames banata hai.
 */

import type { TasteSongStats, TasteStats } from '../../types';

export const SIGNAL_WEIGHTS = {
  plays: 1,
  completions: 2,
  likes: 3,
  playlistAdds: 3,
  skips: -1.5,
} as const;

export interface RankedSong {
  songId: string;
  score: number;
  artists: string[];
}

/** Ek song ka net taste score — negative ho sakta hai (zyada skip wale). */
export function scoreSongStats(songStats: TasteSongStats): number {
  return (
    songStats.plays * SIGNAL_WEIGHTS.plays +
    songStats.completions * SIGNAL_WEIGHTS.completions +
    songStats.likes * SIGNAL_WEIGHTS.likes +
    songStats.playlistAdds * SIGNAL_WEIGHTS.playlistAdds +
    songStats.skips * SIGNAL_WEIGHTS.skips
  );
}

/**
 * Saare songs rank karo (desc score). artistLookup missing songId pe empty
 * artists deta hai — wo songs artist-ranking me contribute nahi karte par
 * song-ranking me rehte hain.
 */
export function rankSongs(
  stats: TasteStats,
  artistLookup: Record<string, string[]>,
): RankedSong[] {
  const ranked: RankedSong[] = Object.entries(stats.songs).map(([songId, songStats]) => ({
    songId,
    score: scoreSongStats(songStats),
    artists: artistLookup[songId] ?? [],
  }));
  return ranked.sort((left, right) => right.score - left.score);
}

export interface RankedArtist {
  artist: string;
  score: number;
  songs: number;
}

/** Ranked songs ko artists me aggregate karo — recommendation seed list. */
export function rankArtists(ranked: RankedSong[], limit: number): RankedArtist[] {
  const scores: Record<string, { score: number; songs: number }> = {};
  for (const song of ranked) {
    for (const artist of song.artists) {
      const prev = scores[artist] ?? { score: 0, songs: 0 };
      scores[artist] = { score: prev.score + song.score, songs: prev.songs + 1 };
    }
  }
  return Object.entries(scores)
    .map(([artist, value]) => ({ artist, score: value.score, songs: value.songs }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, limit));
}
