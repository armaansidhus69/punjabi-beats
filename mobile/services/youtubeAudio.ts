/**
 * youtubeAudio.ts — "Spotify metadata → YouTube audio" ka orchestration layer.
 *
 * ⚠️ IMPORTANT (probe-verified, 2026-10-01) — ye file isliye RAW SDK use NAHI karti:
 *   - `musicstream-sdk` **Node-only** hai (`child_process`, `fs`, `stream/promises`,
 *     `NodeJS.ReadableStream`, engines node>=22). React Native/Hermes isse bundle
 *     nahi kar sakta — direct import app ko break kar deta hai.
 *   - Uska `getStream()` is machine pe **fail** hota hai: pehle
 *     `format.decipher failed: you must provide your own JavaScript evaluator`
 *     (YouTube ne cipher rotate kiya), phir final fallback `spawn yt-dlp ENOENT`.
 *     Matlab yt-dlp binary ke bina koi playable URL nahi milta.
 *
 * Is file ka design is reality ke hisaab se hai:
 *   1. SCORING + decision yahan hai (pure, portable) — `songMatch.ts`.
 *   2. SEARCH injectable hai (`YouTubeSearchFn`). App apna search backend se
 *      laata hai (`createRemoteSearchFn` → `api/youtube-match.js`), Node scripts
 *      seedha SDK de sakte hain. Isse ye module RN me safely bundle hota hai.
 *   3. STREAMING yahan nahi hoti — platform decide karta hai (dekho CLAIM below).
 *
 * CLAIM (honest): full-length audio stream karne ke liye koi bhi rasta chahiye —
 *   (a) Node host + yt-dlp + IP-matched client (googlevideo URL IP-bound hota hai,
 *       isliye Vercel-resolve + phone-play 403 de sakta hai), ya
 *   (b) in-app YouTube player (WebView/official embed) — background play nahi.
 * Ye module sirf **kaun sa video** play karna hai wo decide karta hai, URL nahi.
 */
import {
  pickBestMatch,
  type MatchCandidate,
  type MatchDecision,
  type MatchSource,
  type ScoredCandidate,
} from './songMatch';

/* ---------- Result types ---------- */

export type YouTubeAudioStatus = 'exact' | 'partial' | 'unavailable';

export interface YouTubeAudioResult {
  status: YouTubeAudioStatus;
  /** Selected video ka id (status !== 'unavailable' pe) */
  videoId?: string;
  /** Selected video ka title (UI me "Powered by YouTube" ke saath dikhao) */
  title?: string;
  /** Selected video ka channel */
  channel?: string;
  score?: number;
  /** partial pe "May not be exact version", unavailable pe reason message */
  warning?: string;
  /** Score breakdown — debug/why-panel */
  reasons?: string[];
  /** Kitne candidates score hue (search me kya mila) */
  candidatesConsidered: number;
}

/** Injectable search — (query, limit) → candidates. */
export type YouTubeSearchFn = (query: string, limit: number) => Promise<MatchCandidate[]>;

/** Source track ka minimum shape — app ka `Song` isse satisfy karta hai. */
export interface AudioSourceTrack {
  title: string;
  artist: string;
  album?: string;
  /** ms */
  duration: number;
  releaseYear?: number;
}

/** Search me kitne results score karein (spec: top 5; SDK limit ignore karta hai) */
export const SEARCH_LIMIT = 5;

/** Koi bhi tarah se full-length na mile to UI ke liye message (spec wording) */
export const UNAVAILABLE_MESSAGE = 'This song is not available in full length';
/** partial status pe UI warning (spec wording) */
export const PARTIAL_WARNING = 'May not be exact version';

/* ---------- Query builder ---------- */

/**
 * spec: `${artist} - ${title} official audio`.
 * `album` query me nahi daalte — probe me album add karne se unrelated results
 * aane lage the; base query hi best precision deti hai.
 */
export function buildSearchQuery(track: Pick<AudioSourceTrack, 'artist' | 'title'>): string {
  const artist = (track.artist || '').trim();
  const title = (track.title || '').trim();
  if (!artist) return `${title} official audio`;
  return `${artist} - ${title} official audio`;
}

/** App `Song` → MatchSource (ms duration already) */
export function toMatchSource(track: AudioSourceTrack): MatchSource {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.duration,
    releaseYear: track.releaseYear,
  };
}


/* ---------- Core ---------- */

/**
 * Smart match: metadata → best YouTube video + status.
 *
 * Flow (spec ka Step 1-5):
 *   1. query banao (artist - title official audio)
 *   2. search → candidates
 *   3. har candidate ko score karo (`scoreCandidate`)
 *   4. best chuno
 *   5. score >= 70 → exact | >= 40 → partial+warning | warna unavailable
 *
 * Search fail ho jaye (network/backend down) to `unavailable` return hota hai —
 * kabhi throw nahi, kyunki caller (player) ko hamesha play/fallback decide
 * karna hota hai aur crash nahi hona chahiye.
 */
export async function findYouTubeAudio(
  track: AudioSourceTrack,
  search: YouTubeSearchFn,
  limit: number = SEARCH_LIMIT,
): Promise<YouTubeAudioResult> {
  const empty: YouTubeAudioResult = {
    status: 'unavailable',
    candidatesConsidered: 0,
    warning: UNAVAILABLE_MESSAGE,
  };

  let candidates: MatchCandidate[];
  try {
    candidates = await search(buildSearchQuery(track), limit);
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[youtubeAudio] search fail (${track.title}):`, err);
    }
    return empty;
  }
  if (!candidates || candidates.length === 0) return empty;

  // SDK `limit` ignore karta hai (probe: limit:5 pe 20 aaye) → yahan slice.
  const top = candidates.slice(0, limit);
  const decision: MatchDecision = pickBestMatch(top, toMatchSource(track));

  if (decision.status === 'unavailable' || !decision.best) {
    return {
      status: 'unavailable',
      candidatesConsidered: decision.ranked.length,
      reasons: decision.ranked[0]?.reasons,
      warning: UNAVAILABLE_MESSAGE,
    };
  }

  const best: ScoredCandidate = decision.best;
  return {
    status: decision.status,
    videoId: best.videoId,
    title: best.title,
    channel: best.channel,
    score: best.score,
    reasons: best.reasons,
    candidatesConsidered: decision.ranked.length,
    warning: decision.status === 'partial' ? PARTIAL_WARNING : undefined,
  };
}

/* ---------- Remote (backend) search adapter ---------- */

/**
 * RN app ke liye search: `api/youtube-match.js` (Vercel) ko call karta hai.
 * Server pe `musicstream-sdk` chalta hai (search yt-dlp ke bina bhi chalta hai —
 * probe-verified), app sirf JSON leta hai. Isse SDK ka Node-only code app
 * bundle me kabhi nahi aata.
 *
 * Response shape: `{ candidates: MatchCandidate[] }` ya `{ songs: [...] }`
 * (SDK ka raw shape bhi accept karte hain — server ka version badla to bhi chale).
 */
export function createRemoteSearchFn(baseUrl: string, timeoutMs = 8000): YouTubeSearchFn {
  const root = baseUrl.replace(/\/+$/, '');
  return async (query: string, limit: number): Promise<MatchCandidate[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}/api/youtube-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`youtube-match HTTP ${res.status}`);
      const data = (await res.json()) as { candidates?: unknown; songs?: unknown };
      return normalizeCandidates(data.candidates ?? data.songs);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Server/SDK se aaye raw rows ko `MatchCandidate[]` me badlo.
 * SDK `Song` shape: `{ videoId, title, artist, duration (seconds), thumbnails }`
 * — wahan `artist` hi channel jaisa treat karte hain (video hits me uploader hota hai).
 * Unknown shape pe safely skip (crash nahi).
 */
export function normalizeCandidates(raw: unknown): MatchCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: MatchCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const videoId = typeof r.videoId === 'string' ? r.videoId : '';
    const title = typeof r.title === 'string' ? r.title : '';
    if (!videoId || !title) continue;
    const channel =
      typeof r.channel === 'string' ? r.channel : typeof r.artist === 'string' ? r.artist : '';
    const durationSec =
      typeof r.durationSec === 'number'
        ? r.durationSec
        : typeof r.duration === 'number'
          ? r.duration
          : 0;
    out.push({
      videoId,
      title,
      channel,
      durationSec,
      verified: typeof r.verified === 'boolean' ? r.verified : undefined,
    });
  }
  return out;
}
