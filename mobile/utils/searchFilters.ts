import type { ArtistSummary, Playlist, Song } from '../types';
import { matchCuratedArtist, normalizeArtistName, slugify } from '../core/catalogue/catalogue.ts';

export type SearchFilter = 'All' | 'Songs' | 'Artists' | 'Albums' | 'Playlists';

export interface SearchArtistResult {
  name: string;
  count: number;
  image: string;
  bio?: string;
}

export interface SearchAlbumResult {
  id: string;
  title: string;
  artist: string;
  cover: string;
  count: number;
}

export interface SearchIndex {
  songs: Song[];
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
  playlists: Playlist[];
}

/** Case-insensitive matching ke liye accents/spaces normalize karo. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function matchesQuery(query: string, ...values: string[]): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return values.some(value => normalizeSearchText(value).includes(needle));
}

/** Same track ko providers ke duplicate rows me dobara mat dikhao. */
export function dedupeSearchSongs(songs: readonly Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter(song => {
    const artist = normalizeArtistName(song.artist) || song.artist;
    const key = [song.title, artist, song.album ?? '']
      .map(normalizeSearchText)
      .join('|');
    if (!key.replace(/\|/g, '')) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Search ke teen independent catalogue views banao. API song-level hai, isliye
 * category counts yahin derive hote hain; screen ko raw result length reuse nahi
 * karna padta.
 */
export function buildSearchIndex(
  songs: readonly Song[],
  playlists: readonly Playlist[],
  query: string,
  curatedArtists: readonly ArtistSummary[] = [],
): SearchIndex {
  const uniqueSongs = dedupeSearchSongs(songs).filter(song =>
    matchesQuery(query, song.title, song.artist, song.album ?? ''),
  );

  const artistMap = new Map<string, SearchArtistResult>();
  for (const song of uniqueSongs) {
    const rawArtist = song.artist.trim();
    const artistName = normalizeArtistName(rawArtist) || rawArtist;
    // Song search results already match the query. Keep their artists attached
    // to the result so a title search can still expose the relevant artist.
    if (!artistName) continue;

    const key = normalizeSearchText(artistName);
    const existing = artistMap.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.image && song.cover) existing.image = song.cover;
      continue;
    }

    const curated = matchCuratedArtist(artistName, [...curatedArtists]);
    artistMap.set(key, {
      name: curated?.name ?? artistName,
      count: 1,
      image: curated?.image || song.cover || '',
      bio: curated?.bio,
    });
  }

  const albumMap = new Map<string, SearchAlbumResult>();
  for (const song of uniqueSongs) {
    const albumTitle = song.album?.trim() ?? '';
    const albumArtist = normalizeArtistName(song.artist) || song.artist.trim();
    // Fake album rows from song titles create wrong counts; only real metadata
    // becomes an Albums result.
    if (!albumTitle || !matchesQuery(query, albumTitle, albumArtist)) continue;

    const key = normalizeSearchText(`${albumArtist}|${albumTitle}`);
    const existing = albumMap.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.cover && song.cover) existing.cover = song.cover;
      continue;
    }

    albumMap.set(key, {
      id: slugify(`${albumArtist}-${albumTitle}`),
      title: albumTitle,
      artist: albumArtist,
      cover: song.cover || '',
      count: 1,
    });
  }

  const normalizedQuery = normalizeSearchText(query);
  const matchingPlaylists = normalizedQuery
    ? playlists.filter(playlist => normalizeSearchText(playlist.name).includes(normalizedQuery))
    : [];

  return {
    songs: uniqueSongs,
    artists: Array.from(artistMap.values()),
    albums: Array.from(albumMap.values()),
    playlists: matchingPlaylists,
  };
}
