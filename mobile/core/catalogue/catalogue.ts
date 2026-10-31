/**
 * Pure catalogue logic (Phase 3).
 * Headless, zero dependencies.
 */
import type { AlbumSummary, ArtistSummary, Song } from '../../types/index.ts';

const COLLABORATOR_RE = /\s*(?:,|&|\/|\b(?:feat(?:uring)?|ft|with|x|vs)\.?\b)\s*/i;

/**
 * Normalizes artist name by stripping bracketed extras like (feat. X),
 * [Official Video], and primary collaborator separators like ',' or '&'.
 */
export function normalizeArtistName(raw: string): string {
  if (typeof raw !== 'string') return '';

  let clean = raw.trim();
  if (!clean) return '';

  // Strip bracketed tags: (feat. X), [Official Audio], etc.
  clean = clean.replace(/[\(\[][^\)\]]*[\)\]]/g, '');

  const primary = clean.split(COLLABORATOR_RE)[0]?.trim() ?? clean.trim();
  return primary.replace(/\s+/g, ' ').trim();
}

/**
 * Creates clean URL-safe slugs for routes (e.g., 'diljit-dosanjh').
 */
export function slugify(text: string): string {
  if (typeof text !== 'string') return 'unknown';

  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const slug = normalized
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug.length > 0 ? slug : 'unknown';
}

/**
 * Finds matching curated artist by exact or substring comparison.
 */
export function matchCuratedArtist(
  query: string,
  list: ArtistSummary[],
): ArtistSummary | null {
  if (typeof query !== 'string' || query.trim().length === 0) return null;

  const normalizedQuery = normalizeArtistName(query).toLowerCase();
  const slugQuery = slugify(normalizedQuery);

  for (const artist of list) {
    if (artist.id === slugQuery) return artist;
  }

  for (const artist of list) {
    if (artist.name.toLowerCase() === normalizedQuery) return artist;
  }

  for (const artist of list) {
    const artistLower = artist.name.toLowerCase();
    if (normalizedQuery.includes(artistLower) || artistLower.includes(normalizedQuery)) {
      return artist;
    }
  }

  return null;
}

/**
 * Groups songs by inferred release to build album summaries.
 * Falls back to a single Top Hits & Singles bucket when no album metadata exists.
 */
export function extractAlbumsFromSongs(
  songs: Song[],
  artistName: string,
): AlbumSummary[] {
  if (!Array.isArray(songs) || songs.length === 0) return [];

  const albumMap = new Map<string, AlbumSummary>();

  for (const song of songs) {
    const albumInfo = (song as Song & { album?: string }).album;
    const albumTitle = typeof albumInfo === 'string' && albumInfo.trim().length > 0
      ? albumInfo.trim()
      : 'Top Hits & Singles';
    const albumKey = slugify(`${artistName}-${albumTitle}`);

    const existing = albumMap.get(albumKey);
    if (existing) {
      existing.trackCount = (existing.trackCount ?? 0) + 1;
      if (!existing.cover && song.cover) existing.cover = song.cover;
      continue;
    }

    albumMap.set(albumKey, {
      id: albumKey,
      title: albumTitle,
      artist: artistName,
      cover: song.cover || '',
      year: new Date().getFullYear().toString(),
      trackCount: 1,
    });
  }

  return Array.from(albumMap.values());
}
