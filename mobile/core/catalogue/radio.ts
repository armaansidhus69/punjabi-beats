/**
 * Song Radio (Phase 5 autoplay) — seed song ke artist se queue build karna.
 *
 * Pure selection logic: artist-token match, seed exclude, id dedupe, shuffle,
 * cap. Source fetch service karta hai (searchSongs) — yahan sirf pick karna.
 * rng injectable hai taaki tests deterministic hon (app Math.random pass karti
 * hai by default).
 */

import type { Song } from '../../types';

export type RadioRng = () => number;

/** Fisher-Yates with injectable rng — shuffle without side effects. */
export function shuffleWithRng<T>(items: T[], rng: RadioRng): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

/** "Diljit Dosanjh, Intense" jaise artist field ke lowercase tokens. */
export function artistTokens(artist: string): string[] {
  return artist
    .toLowerCase()
    .split(/[,&/]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0);
}

/** Artist string de saare lowercase words (len >= 2) — word-subset matching. */
function artistWords(artist: string): Set<string> {
  return new Set(
    artist
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 2),
  );
}

/**
 * Word-subset match: seed artist ke saare words candidate artist me hone
 * chahiye. Isliye "Diljit Dosanjh" ↔ "Diljit Dosanjh feat. Intense" match
 * karda hai (radio chahida), par "AP Dhillon" nahi.
 */
export function sharesArtist(left: Song, right: Song): boolean {
  const leftWords = artistWords(left.artist);
  if (leftWords.size === 0) return false;
  const rightWords = artistWords(right.artist);
  for (const word of leftWords) {
    if (!rightWords.has(word)) return false;
  }
  return true;
}

/**
 * Seed radio candidates: same-artist songs, seed khud exclude, dedupe,
 * shuffle, limit. Seed ka artist khali ho to jo mile wahi (shuffled) de dete
 * hain — radio kabhi khali nahi hoti agar candidates hain.
 */
export function pickRadioCandidates(
  candidates: Song[],
  seed: Song,
  { limit = 25, rng = Math.random }: { limit?: number; rng?: RadioRng } = {},
): Song[] {
  const seen = new Set<string>([seed.id]);
  const matches: Song[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    if (!sharesArtist(seed, candidate)) continue;
    seen.add(candidate.id);
    matches.push(candidate);
  }
  return shuffleWithRng(matches, rng).slice(0, Math.max(0, limit));
}
