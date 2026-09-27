/**
 * Music API service — iTunes Search API (PRIMARY, IN store) + optional
 * JioSaavn mirror (sirf EXPO_PUBLIC_JIOSAAVN_BASE env set hone pe).
 *
 * NOTE (2026-09-24, probe-apis.mjs se verified): saare public JioSaavn
 * mirrors DEAD hain — sumitkolhe/vij/harsh-patel vercel → 404,
 * saavn.dev/saavn.me → NXDOMAIN. iTunes free + no-key + reliable hai.
 * IN store pe Punjabi queries perfect results dete hain (US store
 * generic queries garbage deta hai — isliye default country=IN).
 *
 * RETEST (2026-09-27): teen aur candidate mirrors bhi dead:
 * jiosaavn-api-ts.vercel.app → 404 DEPLOYMENT_NOT_FOUND,
 * saavn.dev → NXDOMAIN (curl exit 6; jiosaavn.com DNS theek hai),
 * jiosaavn-api-privatecvc2.vercel.app → DEPLOYMENT_DISABLED (Vercel payment).
 * Official www.jiosaavn.com/api.php search bhi empty deta hai (auth-gated).
 * → iTunes hi rehta hai PRIMARY; previewOnly flag se UI "30s" badge dikhata hai
 *   (SongItem) + player me preview note. Full-song mirror jeevit hua to
 *   env set karte hi badge/note apne aap gayab ho jayenge.
 */
import axios from 'axios';
import { Mood, Song } from '../types';

const ITUNES_BASE = 'https://itunes.apple.com/search';
/** IN store = best Punjabi results (probe-apis.mjs v3 se confirmed) */
const ITUNES_COUNTRY = process.env.EXPO_PUBLIC_ITUNES_COUNTRY ?? 'IN';
/** OPTIONAL: koi JioSaavn mirror revive ho to .env me URL set karo */
const JIOSAAVN_MIRROR = process.env.EXPO_PUBLIC_JIOSAAVN_BASE;
const REQUEST_TIMEOUT_MS = 8000;

/* ---------- JioSaavn mirror shapes (OPTIONAL — env set hone pe hi) ---------- */

interface JioSaavnImage {
  quality?: string;
  url?: string;
}

interface JioSaavnArtist {
  name?: string;
}

interface JioSaavnSongRaw {
  id?: string;
  name?: string;
  duration?: string | number;
  artists?: { primary?: JioSaavnArtist[] };
  image?: JioSaavnImage[];
  downloadUrl?: JioSaavnImage[];
}

interface JioSaavnResponse {
  data?: { results?: JioSaavnSongRaw[] };
}

/* ---------- iTunes primary shapes ---------- */

interface ITunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  previewUrl?: string | null;
  trackTimeMillis?: number;
}

interface ITunesResponse {
  results?: ITunesResult[];
}

/* ---------- Mappers ---------- */

function pickBestAudioUrl(downloadUrl: JioSaavnImage[]): string | null {
  if (downloadUrl.length === 0) return null;
  // 320kbps preferred (FR-2.8); warna available me sabse high quality (list ka last entry)
  const explicit = downloadUrl.find(d => d.quality === '320kbps');
  return explicit?.url ?? downloadUrl[downloadUrl.length - 1]?.url ?? null;
}

function mapJioSaavnSong(raw: JioSaavnSongRaw): Song | null {
  const id = raw.id;
  const title = raw.name;
  const preview = raw.downloadUrl ? pickBestAudioUrl(raw.downloadUrl) : null;
  if (!id || !title || !preview) return null;

  const artist =
    raw.artists?.primary
      ?.map(a => a.name ?? '')
      .filter(Boolean)
      .join(', ') || 'Unknown';

  const cover =
    raw.image?.find(i => i.quality === '500x500')?.url ??
    raw.image?.[raw.image.length - 1]?.url ??
    '';

  const duration = (Number(raw.duration) || 30) * 1000;

  return { id, title, artist, cover, preview, duration };
}

function mapITunesSong(raw: ITunesResult): Song | null {
  // iTunes me bina previewUrl ke songs bekaar hain — skip
  if (!raw.previewUrl || !raw.trackName) return null;
  return {
    id: String(raw.trackId ?? raw.trackName),
    title: raw.trackName,
    artist: raw.artistName || 'Unknown',
    // artworkUrl100 se badi artwork banate hain
    cover: raw.artworkUrl100?.replace('100x100bb', '600x600bb') ?? '',
    preview: raw.previewUrl,
    duration: raw.trackTimeMillis ?? 30000,
    // iTunes sirf 30s preview deta hai (full song nahi) — UI badge + player note
    previewOnly: true,
  };
}

/* ---------- Public API ---------- */

/**
 * Search songs — iTunes primary (IN store).
 * Agar EXPO_PUBLIC_JIOSAAVN_BASE set hai to pehle mirror try hota hai,
 * fail/empty pe iTunes automatic (FR-1.4 updated: iTunes hi primary hai).
 */
export async function searchSongs(query: string, limit = 30): Promise<Song[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // OPTIONAL: JioSaavn mirror (env set hone pe hi chalta hai)
  if (JIOSAAVN_MIRROR) {
    try {
      const res = await axios.get<JioSaavnResponse>(`${JIOSAAVN_MIRROR}/search/songs`, {
        params: { query: trimmed, limit },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const songs = (res.data.data?.results ?? [])
        .map(mapJioSaavnSong)
        .filter((s): s is Song => s !== null);
      if (songs.length > 0) return songs;
      console.warn('JioSaavn mirror: 0 results, iTunes try karte hain');
    } catch (err) {
      console.warn('JioSaavn mirror failed, iTunes try karte hain:', err);
    }
  }

  // Primary: iTunes Search API (IN store)
  try {
    const res = await axios.get<ITunesResponse>(ITUNES_BASE, {
      params: { term: trimmed, media: 'music', entity: 'song', limit, country: ITUNES_COUNTRY },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (res.data.results ?? [])
      .map(mapITunesSong)
      .filter((s): s is Song => s !== null);
  } catch (err) {
    console.warn('iTunes search fail:', err);
    return [];
  }
}

/** Home screen trending list — "punjabi hits" IN store pe probe-verified */
export async function getTrendingSongs(limit = 20): Promise<Song[]> {
  return searchSongs('punjabi hits', limit);
}

/** Mood-based playlist (Phase 4) */
export async function getSongsByMood(mood: Mood, limit = 30): Promise<Song[]> {
  return searchSongs(mood.query, limit);
}
