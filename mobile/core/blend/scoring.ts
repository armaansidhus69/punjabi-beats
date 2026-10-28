/**
 * Blend scoring + selection — algorithm v1 (Phase 10).
 *
 * ⚠️ PARITY: is file ka EXACT copy supabase/functions/_shared/
 * blend-scoring.ts me hai (Deno bundle sirf function dir upload karta hai).
 * test-blend.mjs dono files normalized-compare karta hai — copy me change
 * karo to algorithm_version 'v1'→'v2' bump karke DONO update karo.
 *
 * Self-contained hai (local types, koi import nahi) — Node/RN/Deno teeno
 * me same behaviour, copy-safe.
 */

export const BLEND_ALGORITHM_VERSION = 'v1';
export const BLEND_TARGET_ITEMS = 30;
const SHARE_WEIGHT = 0.6;
const PREF_WEIGHT = 0.4;

/* ---- local, structurally-compatible data shapes (types/index.ts jaisa) ---- */

export interface BlendItemTrack {
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: string;
  durationSec: number;
  playableFull: boolean;
}

export interface BlendItemOut {
  blendId: string;
  trackId: string;
  score: number;
  position: number;
  track: BlendItemTrack;
}

/* ------------------------------ scoring ------------------------------ */

export interface TasteSnapshotSongShape {
  id: string;
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: string;
  durationSec: number;
  playableFull: boolean;
  count: number;
}

export interface TasteSnapshotShape {
  version: number;
  libraryHash: string;
  songs: TasteSnapshotSongShape[];
  artists: { name: string; count: number }[];
}

export interface SnapshotMember {
  userId: string;
  snapshot: TasteSnapshotShape;
}

export interface PooledTrack {
  trackId: string;
  userId: string;
  song: TasteSnapshotSongShape;
  /** members having the track ÷ total members */
  share: number;
  /** mean normalized per-member strength (count ÷ member's own max) */
  pref: number;
  /** 0.6·share + 0.4·pref */
  score: number;
}

/** lowercase-normalized artist set */
export function artistSet(names: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (key.length > 0) set.add(key);
  }
  return set;
}

/**
 * Pairwise taste match % — artist-set Jaccard, rounded to whole percent.
 */
export function jaccardPercent(artistsA: readonly string[], artistsB: readonly string[]): number {
  const a = artistSet(artistsA);
  const b = artistSet(artistsB);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const artist of a) {
    if (b.has(artist)) intersection++;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return Math.round((intersection / union) * 100);
}

/**
 * Members ke snapshots ko ek track pool me collapse (canonical song id pe);
 * attribution first-wins join order me (owner pehle join hota hai).
 */
export function scorePooledTracks(members: readonly SnapshotMember[]): PooledTrack[] {
  if (members.length === 0) return [];
  const memberCount = members.length;

  const byTrack = new Map<string, { userId: string; song: TasteSnapshotSongShape }>();
  const perMemberCounts = new Map<string, Map<string, number>>(); // trackId → userId → count
  const memberMaxes = new Map<string, number>(); // userId → max count

  for (const member of members) {
    let max = 1;
    for (const song of member.snapshot.songs) {
      if (song.count > max) max = song.count;
    }
    memberMaxes.set(member.userId, max);
    for (const song of member.snapshot.songs) {
      if (!byTrack.has(song.id)) byTrack.set(song.id, { userId: member.userId, song });
      let counts = perMemberCounts.get(song.id);
      if (!counts) {
        counts = new Map();
        perMemberCounts.set(song.id, counts);
      }
      counts.set(member.userId, song.count);
    }
  }

  const pooled: PooledTrack[] = [];
  for (const [trackId, { userId, song }] of byTrack) {
    const counts = perMemberCounts.get(trackId) ?? new Map<string, number>();
    const holders = counts.size;
    const share = holders / memberCount;

    let prefSum = 0;
    for (const [holderId, count] of counts) {
      const max = memberMaxes.get(holderId) ?? 1;
      prefSum += count / max;
    }
    const pref = holders > 0 ? prefSum / holders : 0;

    pooled.push({ trackId, userId, song, share, pref, score: SHARE_WEIGHT * share + PREF_WEIGHT * pref });
  }

  return pooled.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.trackId.localeCompare(b.trackId);
  });
}

export interface SelectionResult {
  /** ordered selection — position 0..N-1 */
  items: PooledTrack[];
  /** eligible but not selected (target bhar gaya) */
  skipped: PooledTrack[];
}

/**
 * Eligible pool se target-size selection: per-member quota se pehle
 * (floor(target ÷ members)), phir score-desc fill. Final order deterministic:
 * score desc, tie-break trackId asc.
 */
export function selectBlendItems(
  pooled: readonly PooledTrack[],
  excludedTrackIds: ReadonlySet<string>,
  memberIds: readonly string[],
  target: number = BLEND_TARGET_ITEMS,
): SelectionResult {
  const eligible = pooled.filter(track => !excludedTrackIds.has(track.trackId));

  const memberCount = memberIds.length;
  const quota = memberCount > 0 ? Math.floor(target / memberCount) : 0;
  const quotaByMember = new Map<string, number>(memberIds.map(id => [id, quota]));

  const selectedIds = new Set<string>();
  const items: PooledTrack[] = [];

  for (const track of eligible) {
    if (items.length >= target) break;
    const remaining = quotaByMember.get(track.userId) ?? 0;
    if (remaining <= 0) continue;
    if (selectedIds.has(track.trackId)) continue;
    selectedIds.add(track.trackId);
    items.push(track);
    quotaByMember.set(track.userId, remaining - 1);
  }

  for (const track of eligible) {
    if (items.length >= target) break;
    if (selectedIds.has(track.trackId)) continue;
    selectedIds.add(track.trackId);
    items.push(track);
  }

  items.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.trackId.localeCompare(b.trackId);
  });

  const selectedSet = new Set(items.map(item => item.trackId));
  const skipped = eligible.filter(track => !selectedSet.has(track.trackId));

  return { items, skipped };
}

/** PooledTrack → blend_items insert shape */
export function pooledTrackToBlendItem(track: PooledTrack, blendId: string, position: number): BlendItemOut {
  return {
    blendId,
    trackId: track.trackId,
    score: track.score,
    position,
    track: {
      title: track.song.title,
      artistNames: track.song.artistNames,
      artworkUrl: track.song.artworkUrl,
      provider: track.song.provider,
      durationSec: track.song.durationSec,
      playableFull: track.song.playableFull,
    },
  };
}
