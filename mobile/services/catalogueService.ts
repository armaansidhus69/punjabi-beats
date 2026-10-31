/**
 * Catalogue service (Phase 3) — artist and album catalogue resolution.
 * Resolves real playable songs via existing multi-provider search chain.
 */
import { AlbumSummary, ArtistSummary, Song } from '../types';
import { POPULAR_ARTISTS } from '../constants/artists';
import {
  extractAlbumsFromSongs,
  matchCuratedArtist,
  normalizeArtistName,
  slugify,
} from '../core/catalogue/catalogue';
import { searchSongs } from './musicApi';

interface ArtistCacheEntry {
  profile: ArtistSummary;
  songs: Song[];
  albums: AlbumSummary[];
  timestamp: number;
}

const artistCache = new Map<string, ArtistCacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 mins

/**
 * Fetches artist profile, playable top songs, and albums.
 */
export async function fetchArtistCatalogue(
  artistNameOrSlug: string,
): Promise<{ profile: ArtistSummary; songs: Song[]; albums: AlbumSummary[] }> {
  const cleanName = decodeURIComponent(artistNameOrSlug).trim();
  const cacheKey = slugify(cleanName);

  const cached = artistCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { profile: cached.profile, songs: cached.songs, albums: cached.albums };
  }

  // 1. Resolve profile
  const matched = matchCuratedArtist(cleanName, POPULAR_ARTISTS);
  const displayName = matched ? matched.name : normalizeArtistName(cleanName) || cleanName;

  // 2. Fetch tracks via existing search chain
  let songs: Song[] = [];
  try {
    songs = await searchSongs(displayName, 25);
  } catch (err) {
    console.warn(`[catalogue] Failed to search songs for artist ${displayName}:`, err);
    songs = [];
  }

  // 3. Fallback image if not in curated list
  const profile: ArtistSummary = matched
    ? { ...matched }
    : {
        id: cacheKey,
        name: displayName,
        image: songs[0]?.cover || '',
        bio: `Stream and discover popular Punjabi tracks by ${displayName}.`,
        monthlyListeners: 'Artist',
        genre: 'Punjabi Music',
      };

  if (!profile.image && songs[0]?.cover) {
    profile.image = songs[0].cover;
  }

  // 4. Extract albums
  const albums = extractAlbumsFromSongs(songs, profile.name);

  const result = { profile, songs, albums };
  artistCache.set(cacheKey, { ...result, timestamp: Date.now() });

  return result;
}

/**
 * Fetches album details and songs.
 */
export async function fetchAlbumCatalogue(
  albumTitle: string,
  artistName?: string,
): Promise<{ album: AlbumSummary; songs: Song[] }> {
  const query = `${albumTitle} ${artistName ?? ''}`.trim();
  let songs: Song[] = [];
  try {
    songs = await searchSongs(query, 20);
  } catch (err) {
    console.warn(`[catalogue] Failed to search songs for album ${query}:`, err);
    songs = [];
  }

  const album: AlbumSummary = {
    id: slugify(albumTitle),
    title: albumTitle,
    artist: artistName || (songs[0]?.artist ?? 'Various Artists'),
    cover: songs[0]?.cover || '',
    year: new Date().getFullYear().toString(),
    trackCount: songs.length,
  };

  return { album, songs };
}
