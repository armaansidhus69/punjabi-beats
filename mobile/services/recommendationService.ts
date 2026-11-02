/**
 * Made-for-you recommendations (Phase 13 v1, non-AI) — signals ledger se.
 *
 * Pipeline: TasteStats (raw counters) → rankSongs/rankArtists (pure,
 * core/recommendations/rank.ts) → top artists ke songs fetch → recently
 * played + current queue exclude. Data kam ho to [] — Home section khud
 * chhup jata hai (koi fake "personalized" nahi).
 */

import type { Song } from '../types';
import { rankArtists, rankSongs } from '../core/recommendations/rank';
import { getTasteStats, getRecentSignals } from './signalsService';
import { getRecentlyPlayed } from './storage';
import { searchSongs } from './musicApi';
import { usePlayer } from '../stores/playerStore';

const ARTIST_LIMIT = 3;
const FETCH_PER_ARTIST = 15;

/** Ledger se songId → artistNames map (latest signal jeetta hai). */
function buildArtistLookup(): Record<string, string[]> {
  const lookup: Record<string, string[]> = {};
  for (const signal of getRecentSignals(1000)) {
    if (signal.songId && signal.artistNames.length > 0) {
      lookup[signal.songId] = signal.artistNames;
    }
  }
  return lookup;
}

/**
 * Recommended songs — user ke top artists (positive score wale) ke across
 * fetch, dedupe, exclude recently played + current queue. Kam se kam
 * MIN_SIGNALS signals hone chahiye warna recommendation noise hoti hai.
 */
export const MIN_SIGNALS_FOR_RECO = 5;

export async function getMadeForYou(limit = 12): Promise<Song[]> {
  const stats = getTasteStats();
  if (getRecentSignals(1000).length < MIN_SIGNALS_FOR_RECO) return [];

  const ranked = rankSongs(stats, buildArtistLookup());
  const artists = rankArtists(ranked, ARTIST_LIMIT)
    .filter(artist => artist.score > 0)
    .slice(0, 2);
  if (artists.length === 0) return [];

  const [recent, ...batches] = await Promise.all([
    getRecentlyPlayed().catch(() => [] as Song[]),
    ...artists.map(artist => searchSongs(artist.artist, FETCH_PER_ARTIST).catch(() => [] as Song[])),
  ]);

  const exclude = new Set<string>([
    ...recent.map(song => song.id),
    ...usePlayer.getState().queue.map(song => song.id),
  ]);

  const recommendations: Song[] = [];
  const seen = new Set<string>();
  // Round-robin artist batches — ek artist ka flood nahi hota
  for (let index = 0; recommendations.length < limit; index++) {
    let added = false;
    for (const batch of batches) {
      const song = batch[index];
      if (!song || seen.has(song.id) || exclude.has(song.id)) continue;
      seen.add(song.id);
      recommendations.push(song);
      added = true;
      if (recommendations.length >= limit) break;
    }
    if (!added) break;
  }
  return recommendations;
}
