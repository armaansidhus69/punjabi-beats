/**
 * Spotify Web API service — OFFICIAL catalogue as a metadata source (2026-11).
 *
 * KAAM KYA KARTA HAI:
 *   - Search + new-releases ke liye Spotify ka official catalogue (sabse accurate
 *     titles/artists/albums — har naya release launch day pe milta hai).
 *   - AUDIO Spotify se NAHI aata (Spotify full streams sirf Premium OAuth SDK
 *     se milte hain; `preview_url` 30s hota hai aur naye apps ke liye aksar
 *     null). Isliye Spotify songs play-time pe existing chain se resolve hote
 *     hain: JioSaavn → Audius strict title-match (playerStore.resolveTrack ka
 *     non-YTM branch `resolveFullAudioStream` chalata hai). Fail hone par
 *     Spotify metadata-only result; playback resolves a verified full stream.
 *
 * AUTH (client credentials):
 *   - `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` + `EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET` —
 *     developer.spotify.com pe free app register karke milta hai.
 *   - YA secure token proxy: `EXPO_PUBLIC_SPOTIFY_TOKEN_URL` (apna backend jo
 *     { access_token } return kare) — production me RECOMMENDED, kyunki
 *     EXPO_PUBLIC_* client bundle me visible hote hain.
 *   - Dono blank → source skip (Jamendo/Verome pattern). Token ~1h cached.
 *
 * NOTE: `spotipy` Python library isi Web API ka wrapper hai — RN app me Python
 * nahi chalta, isliye ye service same API ko direct axios se hit karti hai.
 */
import axios from 'axios';
import type { Song } from '../types';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REQUEST_TIMEOUT_MS = 8000;

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET ?? '';
/** Optional secure token proxy — response { access_token, expires_in? } */
const TOKEN_PROXY_URL = (process.env.EXPO_PUBLIC_SPOTIFY_TOKEN_URL ?? '').replace(/\/+$/, '');
/** IN market = best Punjabi availability (iTunes country jaisa hi pattern) */
const MARKET = process.env.EXPO_PUBLIC_SPOTIFY_MARKET ?? 'IN';

export function isSpotifyConfigured(): boolean {
  return Boolean(TOKEN_PROXY_URL || (CLIENT_ID && CLIENT_SECRET));
}

/* ---------- Token (cached, auto-refresh) ---------- */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchAccessToken(): Promise<string> {
  if (TOKEN_PROXY_URL) {
    const res = await axios.get<{ access_token: string; expires_in?: number }>(TOKEN_PROXY_URL, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (!res.data?.access_token) throw new Error('Spotify token proxy returned no access_token');
    return res.data.access_token;
  }
  const basic = typeof btoa === 'function'
    ? btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
    : Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post<{ access_token: string; expires_in?: number }>(
    SPOTIFY_TOKEN_URL,
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  if (!res.data?.access_token) throw new Error('Spotify token response missing access_token');
  return res.data.access_token;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // 60s safety margin — expiry ke bilkul waqt pe 401 na aaye
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  const token = await fetchAccessToken();
  // Spotify default 3600s; proxy expiry na de to 1h maan lo
  cachedToken = { value: token, expiresAt: now + 3600_000 };
  return token;
}

function clearToken(): void {
  cachedToken = null;
}

/** Bearer GET with one retry on 401 (stale cached token) */
async function spotifyGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const attempt = async (): Promise<T> => {
    const token = await getAccessToken();
    const res = await axios.get<T>(`${SPOTIFY_API}${path}`, {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return res.data;
  };
  try {
    return await attempt();
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 401) throw err;
    clearToken();
    return attempt();
  }
}

/* ---------- Spotify response shapes (jinhe hum use karte hain) ---------- */

interface SpotifyImage {
  url?: string;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  preview_url?: string | null;
  artists?: SpotifyArtist[];
  album?: {
    name?: string;
    images?: SpotifyImage[];
    release_date?: string;
  };
}

interface SpotifyAlbum {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  release_date?: string;
  artists?: SpotifyArtist[];
}

/* ---------- Mapper → common Song ---------- */

/** Spotify song = official METADATA; audio play-time pe resolve hota hai
 * (playerStore non-YTM branch → resolveFullAudioStream). previewOnly:true ka
 * matlab "unresolved" hai — 30s clip nahi (youtube_music jaisa treatment). */
function mapSpotifyTrack(track: SpotifyTrack, fallbackCover: string, fallbackYear?: number): Song | null {
  const id = track.id;
  const title = track.name?.trim();
  if (!id || !title) return null;
  const artist = (track.artists ?? []).map(a => a.name?.trim()).filter(Boolean).join(', ') || 'Unknown artist';
  const cover = track.album?.images?.find(img => img.url)?.url ?? fallbackCover;
  const releaseYear = Number(track.album?.release_date?.slice(0, 4)) || fallbackYear;
  return {
    id: `spotify_${id}`,
    title,
    artist,
    album: track.album?.name?.trim() || undefined,
    cover,
    preview: track.preview_url ?? '',
    duration: track.duration_ms ?? 0,
    source: 'spotify',
    previewOnly: true,
    year: releaseYear || undefined,
  };
}

/* ---------- Public API ---------- */

/** Spotify track search — metadata-only songs (play-time full resolution). */
export async function searchSpotifyTracks(query: string, limit = 20): Promise<Song[]> {
  if (!isSpotifyConfigured() || !query.trim()) return [];
  const data = await spotifyGet<{ tracks?: { items?: SpotifyTrack[] } }>('/search', {
    q: query.trim(),
    type: 'track',
    limit: Math.min(Math.max(limit, 1), 50),
    market: MARKET,
  });
  const items = data.tracks?.items ?? [];
  return items
    .map(track => mapSpotifyTrack(track, ''))
    .filter((song): song is Song => song !== null);
}

/**
 * Spotify NEW RELEASES — `/browse/new-releases` (launch-day official albums,
 * market IN) → pehle K albums ke tracks parallel fetch. Ye "all new song"
 * feed ka freshest official source hai.
 */
export async function fetchSpotifyNewReleaseSongs(limit = 12): Promise<Song[]> {
  if (!isSpotifyConfigured()) return [];
  const albumsRes = await spotifyGet<{ albums?: { items?: SpotifyAlbum[] } }>('/browse/new-releases', {
    limit: Math.min(Math.max(Math.ceil(limit / 2), 5), 20),
    country: MARKET,
  });
  const albums = (albumsRes.albums?.items ?? []).filter(album => album.id).slice(0, 5);
  if (albums.length === 0) return [];

  const trackLists = await Promise.allSettled(
    albums.map(album =>
      spotifyGet<{ items?: SpotifyTrack[] }>(`/albums/${album.id}/tracks`, {
        limit: 10,
        market: MARKET,
      }),
    ),
  );

  const songs: Song[] = [];
  for (const [index, result] of trackLists.entries()) {
    if (result.status !== 'fulfilled') continue;
    const album = albums[index];
    const cover = album.images?.find(img => img.url)?.url ?? '';
    const year = Number(album.release_date?.slice(0, 4)) || undefined;
    for (const track of result.value.items ?? []) {
      const song = mapSpotifyTrack(track, cover, year);
      if (song) songs.push(song);
    }
  }
  return songs.slice(0, limit);
}
