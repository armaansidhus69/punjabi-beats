/**
 * Song Radio service (Phase 5 autoplay) — seed song se queue build.
 *
 * Selection pure hai (core/catalogue/radio.ts); yahan sirf source fetch
 * (searchSongs artist query) + full-only parity. Seed hamesha pehle bajta hai.
 */

import type { Song } from '../types';
import { pickRadioCandidates } from '../core/catalogue/radio';
import { searchSongs } from './musicApi';

export const RADIO_LIMIT = 25;

/**
 * Seed radio queue: [seed, ...same-artist picks]. Candidates na mile to
 * seed-only queue (radio kabhi error nahi deti — khaali queue hi return).
 */
export async function buildRadioQueue(seed: Song): Promise<Song[]> {
  try {
    const candidates = await searchSongs(seed.artist, RADIO_LIMIT + 10);
    const picks = pickRadioCandidates(candidates, seed, { limit: RADIO_LIMIT });
    return [seed, ...picks];
  } catch (err) {
    console.warn('[radio] candidate fetch failed — seed-only queue:', err);
    return [seed];
  }
}
