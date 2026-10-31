/**
 * Pure catalogue logic (Phase 3).
 * Headless, zero dependencies.
 */
import type { AlbumSummary, ArtistSummary, Song } from '../../types/index.ts';

/**
 * Normalizes artist name by stripping bracketed extras like (feat. X),
 * [Official Video], and primary collaborator separators like ',' or '&'.
 */
export function normalizeArtistName(raw: string): string {
  if (typeof raw !== 'string') return '';
  let clean = raw.trim();
  // Strip bracketed text: (feat. ...), [Official ...], etc.
  clean = clean.replace(/[\(\[][^\)\]]*[\)\]]/g, '');
  // Take primary artist if separated by comma or ampersand
  const parts = clean.split(/[,&]/);
  clean = parts[0]?.trim() ?? clean;
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Creates clean URL-safe slugs for routes (e.g., 'diljit-dosanjh').
 */
export function slugify(text: string): string {
  if (typeof text !== 'string') return 'unknown';
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');
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

  // 1. Exact match on id / slug
  for (const artist of list) {
    if (artist.id === slugQuery) return artist;
  }

  // 2. Exact match on name
  for (const artist of list) {
    if (artist.name.toLowerCase() === normalizedQuery) return artist;
  }

  // 3. Substring match
  for (const artist of list) {
    const artistLower = artist.name.toLowerCase();
    if (normalizedQuery.includes(artistLower) || artistLower.includes(normalizedQuery)) {
      return artist;
    }
  }

  return null;
}

/**
 * Groups songs by inferred releases / singles to construct album summaries.
 */
export function extractAlbumsFromSongs(
  songs: Song[],
  artistName: string,
): AlbumSummary[] {
  if (!Array.isArray(songs) || songs.length === 0) return [];

  // Group top songs into albums/singles collection
  const albums: AlbumSummary[] = [
    {
      id: slugify(`${artistName}-top-tracks`),
      title: 'Top Hits & Singles',
      artist: artistName,
      cover: songs[0]?.cover || '',
      year: new Date().getFullYear().toString(),
      trackCount: songs.length,
    },
  ];

  return albums;
}
