/**
 * AI playlist client-core (Phase 13b) — pure, headless-testable.
 *
 * Server sirf {title, artist} refs deta hai; yahan sanitize + fuzzy match
 * helpers hain. Service (aiPlaylistService.ts) ise searchSongs ke saath
 * bind karta hai. Scale/cap constants spec Section 4.1.
 */

import type { AiPlanRow, AiPromptHistoryEntry, AiTrackRef, Song } from '../../types';

export const AI_MAX_TRACKS = 15;
export const AI_MIN_PLAYABLE = 3;
export const AI_PROMPT_HISTORY_CAP = 10;

/* ------------------------------ sanitize ------------------------------ */

/** client-side second guard — server response pe dobara validate (defensive) */
export function sanitizeAiTracks(raw: unknown): AiTrackRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tracks: AiTrackRef[] = [];
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const artist = typeof candidate.artist === 'string' ? candidate.artist.trim() : '';
    if (title.length === 0 || artist.length === 0) continue;
    const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const track: AiTrackRef = { title: title.slice(0, 120), artist: artist.slice(0, 120) };
    const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
    if (reason.length > 0) track.reason = reason.slice(0, 80);
    tracks.push(track);
    if (tracks.length >= AI_MAX_TRACKS) break;
  }
  return tracks;
}

/* ------------------------------ fuzzy normalize ------------------------------ */

/** strip noise brackets + unify separators — match callers dono side se */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\((?:feat|ft|with)\.?[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    // bracketed suffixes: "(official video)", "(remix)", "(lyrics)" etc.
    .replace(/\((?:official|lyrics?|video|audio|remix|full|hd|4k)[^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(token => token.length > 1));
  const bTokens = new Set(b.split(' ').filter(token => token.length > 1));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) if (bTokens.has(token)) shared += 1;
  return shared / Math.max(aTokens.size, bTokens.size);
}

/** title+artist pair ke liye best score (0..1) playable catalog me se */
export function matchScore(track: AiTrackRef, song: Song): number {
  const trackTitle = normalizeName(track.title);
  const trackArtist = normalizeName(track.artist);
  const songTitle = normalizeName(song.title);
  const songArtist = normalizeName(song.artist);

  // exact normalized pair → strongest
  if (trackTitle === songTitle && trackArtist === songArtist) return 1.0;

  const titleScore = scorePart(trackTitle, songTitle);
  const artistScore = scorePart(trackArtist, songArtist);

  // artist substring kuch kuch credit — JioSaavn me artist strings lambi ("A, B")
  const artistBoost =
    songArtist.includes(trackArtist) || trackArtist.includes(songArtist) ? 0.15 : 0;

  return titleScore * 0.7 + artistScore * 0.3 + artistBoost;
}

/** ek naam-part ke liye exact → substring → token overlap score */
function scorePart(trackPart: string, songPart: string): number {
  if (trackPart.length === 0 || songPart.length === 0) return 0;
  if (trackPart === songPart) return 1.0;
  if (songPart.includes(trackPart) || trackPart.includes(songPart)) return 0.85;
  const overlap = tokenOverlap(trackPart, songPart);
  return overlap >= 0.5 ? overlap * 0.75 : 0;
}

/* ------------------------------ plan matching ------------------------------ */

/** per-candidate best-match Song (score >= MATCH_THRESHOLD), warna null */
export const MATCH_THRESHOLD = 0.35;

/**
 * candidate tracks × playable catalog → PlanRow[]; unmatched row
 * `{track, song: null}` rakta hai (screen drop karta hai, service count me
 * bhi nahi ginta).
 */
export function planMatchedRows(tracks: AiTrackRef[], playable: Song[]): AiPlanRow[] {
  return tracks.map(track => {
    let best: { song: Song; score: number } | null = null;
    for (const song of playable) {
      const score = matchScore(track, song);
      if (score >= MATCH_THRESHOLD && (best === null || score > best.score)) {
        best = { song, score };
      }
    }
    return { track, song: best?.song ?? null };
  });
}

export function countPlayable(rows: AiPlanRow[]): number {
  return rows.reduce((count, row) => (row.song !== null ? count + 1 : count), 0);
}

/** duplicate Song resolve — same song do candidate se ho to ek hi rakhe */
export function dedupePlanRows(rows: AiPlanRow[]): AiPlanRow[] {
  const seen = new Set<string>();
  const next: AiPlanRow[] = [];
  for (const row of rows) {
    const key = row.song !== null
      ? row.song.id
      : `unresolved|${row.track.title.toLowerCase()}|${row.track.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
}

/* ------------------------------ prompt history ------------------------------ */

/** cap + dedupe — same prompt+refine dubara phirse top pe chipakna (pure) */
export function mergePromptHistory(
  existing: AiPromptHistoryEntry[],
  entry: AiPromptHistoryEntry,
): AiPromptHistoryEntry[] {
  if (entry.prompt.trim().length === 0) return existing;
  const sameKey = (candidate: AiPromptHistoryEntry) =>
    candidate.prompt === entry.prompt &&
    (candidate.refineText ?? '') === (entry.refineText ?? '');
  const next = [entry, ...existing.filter(candidate => !sameKey(candidate))];
  return next.slice(0, AI_PROMPT_HISTORY_CAP);
}

/* ------------------------------ refine prompt render ------------------------------ */

/** screen me refine chip ka render string — server ko alag bheja jata hai */
export function refineMergePrompt(prompt: string, refineText: string): string {
  const refined = refineText.trim();
  if (refined.length === 0) return prompt;
  return `… aur bhi: ${refined}`;
}
