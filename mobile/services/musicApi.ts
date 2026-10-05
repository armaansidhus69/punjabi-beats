/**
 * Music API service — MULTI-SOURCE FALLBACK CHAIN (full songs priority).
 *
 * Order:
 *   1. JioSaavn mirrors  → full song (320kbps), 3-5 min
 *   2. Audius direct     → full song (free, no API key), 3-5 min
 *   3. iTunes (30s preview) + FULL-SONG UPGRADE passes:
 *        a. artist expansion — iTunes results ke artist names se Audius search
 *           ("Diljit party" → artist "Diljit Dosanjh" → 30 full songs)
 *        b. per-song upgrade — top iTunes tracks ko title-match karke Audius ke
 *           full version se replace (exact tracks, sabse precise match)
 *   4. getTrendingSongs → curated Punjabi artist rotation (probe-artists.mjs
 *      se 13/18 artists >=5 full verify) — home feed hamesha full songs
 *
 * Har source ka apna mapper hai → common `Song` type. `previewOnly` sirf tab
 * true rehta hai jab sach me 30s hi mile (ya dono upgrade pass fail ho jaayein)
 * — isliye SongItem ka "30s" badge aur player ka preview note usi pe dikhte hain.
 *
 * PROBE (2026-09-28, probe-mirrors.mjs + probe-audius.mjs + probe-search.mjs):
 * - JioSaavn (har mirror ke DONO paths test kiye: /api/search/songs + /search/songs):
 *     jiosaavn-api-v3, jiosaavn-api-sumitkolhe-v2, jiosaavn-api → 404 (dead)
 *     saavn-api       → /search/songs pe 200, lekin downloadUrl hi nahi
 *     jiosaavn-api-2  → /search/songs pe 200 + 320kbps downloadUrl + 30/30 full
 *                       songs… lekin aac.saavncdn.com pe saari files 404 (stale
 *                       links) — metadata sahi, bajta nahi
 *   → Isliye chain me AUDIO GUARD hai: mirror se songs aane pe pehle HEAD se
 *     download URL verify hota hai; fail ho to mirror 10 min dead-cache me.
 *     Koi mirror sach me revive ho (ya phone ke network pe CDN chale) to guard
 *     pass hote hi apne aap PRIMARY ban jayega.
 * - Audius: LIVE + PLAYABLE. `/v1/tracks/search?limit=30` → 30 results, sab 60s+.
 *   Stream: `/v1/tracks/:id/stream?app_name=…` → 302 → content node →
 *   206 audio/mpeg (probe-audius.mjs se playable verified).
 *   `app_name` param ZARURI hai — bina uske redirect ek down node (HTTP 522)
 *   pe jaata hai. Catalogue user-uploaded hai (Diljit/Karan Aujla/Sidhu/
 *   Sartaaj ke full tracks milte hain), official catalogue nahi — isliye
 *   iTunes fallback rakha hai.
 * - iTunes: free + reliable, lekin previewUrl hamesha 30s ka hota hai.
 * - UPGRADE PROBE (2026-09-29, probe-fullsong.mjs + probe-upgrade.mjs):
 *   8 app queries me se sirf 5 Audius pe direct full deti thin; "Diljit party"
 *   aur "Gurdas Maan" → 0 full (matlab 100% 30s). Expansion (artist name) +
 *   per-song upgrade (title match) ke baad dono queries pe full songs aate hain.
 */
import axios from 'axios';
// `import type` — Mood/Song sirf types hain; test-logic jaisi Node ESM testing
// ke liye import erase ho jaata hai (syncPayload.ts ka same pattern)
import type { Mood, Song } from '../types';

const ITUNES_BASE = 'https://itunes.apple.com/search';
/** IN store = best Punjabi results (probe-apis.mjs v3 se confirmed) */
const ITUNES_COUNTRY = process.env.EXPO_PUBLIC_ITUNES_COUNTRY ?? 'IN';

/** Audius public API — free, no key, full songs */
const AUDIUS_BASE = 'https://api.audius.co/v1';
/**
 * `app_name` Audius ke stream redirect ko healthy content node pe bhejta hai.
 * Bina iske 302 ek down discovery node (HTTP 522) pe ja sakta hai — probe se
 * verified. Isliye search aur stream URL dono me ye bhejte hain.
 */
const AUDIUS_APP_NAME = 'punjabi-beats';

/**
 * JioSaavn mirrors (env wala sabse pehle).
 * 2026-09-28 probe: neeche ke 5/5 abhi 404 hain — list rakhi hai taaki koi
 * revive kare to chain me apne aap aa jaye.
 */
const JIOSAAVN_MIRRORS: string[] = [
  ...(process.env.EXPO_PUBLIC_JIOSAAVN_BASE ? [process.env.EXPO_PUBLIC_JIOSAAVN_BASE] : []),
  'https://jiosaavn-api-v3.vercel.app',
  'https://jiosaavn-api-sumitkolhe-v2.vercel.app',
  'https://saavn-api.vercel.app',
  'https://jiosaavn-api-2.vercel.app',
  'https://jiosaavn-api.vercel.app',
].map(u => u.replace(/\/+$/, ''));

const REQUEST_TIMEOUT_MS = 8000;
/** Mirror ke liye chhota timeout — dead mirror search ko na rok de */
const MIRROR_TIMEOUT_MS = 3500;
/** Fail hue mirror ko itni der tak dobara mat maaro (har search pe latency bachti hai) */
const MIRROR_DEAD_TTL_MS = 10 * 60_000;
/**
 * Audius tab "success" maana jaata hai jab kam se kam itne FULL songs aayein.
 * 1-4 results aaye to iTunes se top-up karte hain (full songs aage), warna
 * jaise "punjabi hits" pe Audius sirf 1 gaana deta hai — wahan list 1 pe fail
 * ho jaati thi.
 */
const AUDIUS_MIN_FULL_SONGS = 5;
/** 1 min se chhote clips (jingles/reels) full song nahi hain */
const MIN_FULL_SONG_MS = 60_000;
/**
 * iTunes results ko upgrade karne ke liye kitne parallel Audius calls chalte hain.
 * Zyada cap = search latency badhti hai; 6 se zyada tracks user waise bhi nahi chunta.
 */
const UPGRADE_CAP = 6;
/** Artist-expansion me kitne alag artist names try karne hain (parallel) */
const ARTIST_EXPAND_MAX = 4;
/**
 * Expansion tab hi chalta hai jab iTunes ne kam se kam itne results diye hain.
 * Kam results = fuzzy/garbage query ("xyzabc" → sirf 3 unrelated tracks) —
 * wahan artist expansion random gaane la deta tha jo query se related hi nahi.
 */
const MIN_ITUNES_FOR_EXPANSION = 6;

/* ---------- Pagination caps (probe-verified 2026-10-05) ---------- */
/**
 * Kitna ORIGINAL fetch karein — caller ke `limit` se independent. Isse
 * `searchSongs` har source se max nikalta hai, phir top-quality wala `limit`
 * tak trim karta hai (precision order: full song → preview).
 */
const AUDIUS_FETCH_MAX = 90;
/**
 * iTunes ek call me 200 tak deta hai.
 * ⚠️ PROBE: iTunes `offset` PARAM IGNORE KARTA HAI — offset=0 aur offset=200
 * ka response byte-identical aata hai. Isliye pagination nahi, ek hi bada
 * call (limit=200). Isse hi 30 → 200 ka jump milta hai.
 */
const ITUNES_FETCH_MAX = 200;
/**
 * Audius search ek page me ~30 deta hai (offset=30 pe 28, offset=60 pe 0).
 * Probe: page0 ∩ page1 = 0 overlap → 2 pages genuinely ~58 unique dete hain.
 * 3+ page pool khaali ho jaata hai, isliye 2 page cap.
 */
const AUDIUS_PAGE_SIZE = 30;
const AUDIUS_MAX_PAGES = 2;
/** Jamendo se kitne maangein (full/legal tracks) */
const JAMENDO_FETCH_MAX = 50;

/**
 * Jamendo (free, legal, full songs) — OPTIONAL source.
 * Bina key ke gracefully skip (app crash nahi hota).
 * Key kahan se: https://devportal.jamendo.com/ → free account → "Get API key".
 * NOTE: catalogue chhota hai aur bohot kuch 30s preview hote hain — isliye
 * `previewOnly` duration se honestly set hota hai, full ka daava nahi.
 */
const JAMENDO_KEY = process.env.EXPO_PUBLIC_JAMENDO_KEY ?? '';
const JAMENDO_BASE = 'https://api.jamendo.com/v3.0';

/** Trending artist rotation — probe-artists.mjs (2026-09-29) se har ek pe
 * Audius pe >=5 FULL songs (60s+) verify. Home feed inhi se banta hai, isliye
 * "punjabi hits" jaisi generic query pe 30s fallback kabhi nahi aata.
 */
const TRENDING_ARTISTS: string[] = [
  'Diljit Dosanjh',
  'Sidhu Moose Wala',
  'Karan Aujla',
  'AP Dhillon',
  'Shubh',
  'Jazzy B',
  'Ammy Virk',
  'Guru Randhawa',
  'Ninja',
  'Satinder Sartaaj',
  'Bohemia',
  'Yo Yo Honey Singh',
  'Badshah',
];

/** base → ms tak dead (JioSaavn mirror dead cache) */
const mirrorDeadUntil = new Map<string, number>();

/* ---------- JioSaavn mirror shapes (alag mirrors alag shape dete hain) ---------- */

interface JioSaavnImage {
  quality?: string;
  /** purana shape */
  url?: string;
  /** jiosaavn-api-2 jaisa naya shape */
  link?: string;
}

function cdnUrl(item?: JioSaavnImage): string {
  return item?.url ?? item?.link ?? '';
}

interface JioSaavnArtist {
  name?: string;
}

interface JioSaavnSongRaw {
  id?: string;
  name?: string;
  duration?: string | number;
  /** purana shape: artists.primary[] */
  artists?: { primary?: JioSaavnArtist[] };
  /** naya shape: comma-separated string */
  primaryArtists?: string;
  image?: JioSaavnImage[];
  downloadUrl?: JioSaavnImage[];
}

/**
 * Response wrapper alag mirrors pe alag hota hai:
 *   `{ data: { results: [...] } }` (saavn.dev style)
 *   `{ status: 'SUCCESS', results: [...] }` (jiosaavn-api-2 style)
 *   `[{ ... }, ...]` (flat array — saavn-api style)
 */
function extractJioSaavnResults(payload: unknown): JioSaavnSongRaw[] {
  if (Array.isArray(payload)) return payload as JioSaavnSongRaw[];
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as { data?: { results?: unknown }; results?: unknown };
  const nested = obj.data?.results ?? obj.results;
  return Array.isArray(nested) ? (nested as JioSaavnSongRaw[]) : [];
}

/* ---------- Audius shapes ---------- */

interface AudiusArtwork {
  /** '150x150' | '480x480' | '1000x1000' — 'mirrors' key string[] hai, isliye unknown */
  [key: string]: unknown;
}

interface AudiusUser {
  name?: string;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  /** seconds */
  duration?: number;
  artwork?: AudiusArtwork;
  user?: AudiusUser;
}

interface AudiusResponse {
  data?: AudiusTrack[];
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

/* ---------- Helpers ---------- */

/**
 * Cross-source / duplicate-upload hatao (Audius pe same gaana 3 baar milta hai).
 *
 * ⚠️ KEY = title + artist (2026-10-05): pehle sirf title tha, jisse do ALAG
 * artists ke same-title gaane ("Vibe" — Artist A vs "Vibe" — Artist B) ek maan
 * liye jaate the. Ab artist bhi key me hai — full songs kam kat-te hain par
 * result zyada accurate.
 * Latin + Gurmukhi dono normalize me rakhte hain — warna Punjabi-script titles
 * sab "" ban jaate aur galat se sab ek hi song samajh lete.
 */
function dedupeByTitle(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter(song => {
    const key = `${song.title.toLowerCase().replace(/[^a-z0-9਀-੿]+/g, '')}|${song.artist
      .toLowerCase()
      .replace(/[^a-z0-9਀-੿]+/g, '')}`;
    // title+artist dono normalize hone pe khaali → key khaali mat rakhna
    // (warna "Unknown" artist ke sabhi songs ek ho jaate)
    if (key === '|') return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Saare tasks parallel chalao; JO PEHLA non-empty songs laye wo jeet jaaye.
 * Fail hue tasks apni jagah se mirrorDeadUntil update karte rehte hain.
 */
function firstNonEmpty(tasks: Promise<Song[]>[]): Promise<Song[]> {
  return new Promise<Song[]>(resolve => {
    if (tasks.length === 0) {
      resolve([]);
      return;
    }
    let pending = tasks.length;
    let settled = false;
    const onSettled = (songs: Song[] | null) => {
      if (settled) return;
      if (songs && songs.length > 0) {
        settled = true;
        resolve(songs);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve([]);
      }
    };
    tasks.forEach(task => task.then(onSettled, () => onSettled(null)));
  });
}

/** Console me source visibility — release me silent (`__DEV__` guard) */
function logSource(query: string, source: string, count: number, note?: string) {
  if (__DEV__) {
    console.log(`[musicApi] "${query}" → ${source} (${count} songs${note ? `, ${note}` : ''})`);
  }
}

/* ---------- Full-song upgrade helpers ---------- */

/** Title normalize — dedupe ke key jaisa (Latin + Gurmukhi dono) */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9਀-੿]+/g, '');
}

/**
 * Kya iTunes title Audius ke full track ka same gaana hai?
 * Rule: exact match HAMESHA valid; warna chhota side >=5 chars ho tabhi prefix/
 * contains match — isse "Vibe" ≠ "Vibe Tonight" jaise false positives kat-te hain
 * (probe-upgrade.mjs me isi rule se 8/18 exact upgrades mile).
 */
function titleMatches(iTunesTitle: string, fullTitle: string): boolean {
  const a = normalizeTitle(iTunesTitle);
  const b = normalizeTitle(fullTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  return a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
}

/**
 * iTunes `artistName` ko alag artist candidates me baant lo (split):
 * "Gurdas Maan, Diljit Dosanjh & Ikky" → ['Gurdas Maan', 'Diljit Dosanjh', 'Ikky']
 *
 * Sirf wo candidates rakho jo query se related hain:
 *   - artist kam se kam 2 results me aaya (genuine match), YA
 *   - query me artist ka naam hai (query 'Gurdas Maan' → artist 'Gurdas Maan')
 * Frequent pehle, cap ARTIST_EXPAND_MAX — isse garbage queries pe unrelated
 * artists expansion me nahi ghus paate.
 */
function extractArtistCandidates(songs: Song[], query: string): string[] {
  const counts = new Map<string, number>();
  for (const song of songs) {
    for (const piece of song.artist.split(/,| & | and |; | feat\. | ft\. | x /i)) {
      const name = piece.replace(/\s+/g, ' ').trim();
      if (name.length < 3 || /^(unknown|various artists)$/i.test(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const normQuery = normalizeTitle(query);
  return [...counts.entries()]
    .filter(([name, count]) => {
      const normName = normalizeTitle(name);
      const queryMentions = normQuery.length >= 3 && (normQuery.includes(normName) || normName.includes(normQuery));
      return count >= 2 || queryMentions;
    })
    .sort((x, y) => y[1] - x[1])
    .map(([name]) => name)
    .slice(0, ARTIST_EXPAND_MAX);
}

/** Fisher-Yates — trending rotation me har open pe nayi variety ho */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------- Mappers ---------- */

function pickBestAudioUrl(downloadUrl: JioSaavnImage[]): string | null {
  if (downloadUrl.length === 0) return null;
  // 320kbps preferred (FR-2.8); warna available me sabse high quality (list ka last entry)
  const explicit = downloadUrl.find(d => d.quality === '320kbps');
  const picked = explicit ?? downloadUrl[downloadUrl.length - 1];
  return cdnUrl(picked) || null;
}

function mapJioSaavnSong(raw: JioSaavnSongRaw): Song | null {
  const id = raw.id;
  const title = raw.name;
  const preview = raw.downloadUrl ? pickBestAudioUrl(raw.downloadUrl) : null;
  if (!id || !title || !preview) return null;

  const fromArtists =
    raw.artists?.primary
      ?.map(a => a.name ?? '')
      .filter(Boolean)
      .join(', ') ?? '';
  // naya shape: `primaryArtists` comma-separated string
  const artist = fromArtists || raw.primaryArtists?.trim() || 'Unknown';

  const cover =
    cdnUrl(raw.image?.find(i => i.quality === '500x500')) ||
    cdnUrl(raw.image?.[raw.image.length - 1]);

  const durationMs = (Number(raw.duration) || 0) * 1000;

  return {
    id,
    title,
    artist,
    cover,
    preview,
    duration: durationMs || 30_000,
    // duration na pata ho to full song ka daava galat hoga — honest rehna better
    previewOnly: durationMs < MIN_FULL_SONG_MS,
  };
}

/** Audius → Song. 60s se chhote clips drop (garbage queries 20s clips deti hain) */
function mapAudiusTrack(raw: AudiusTrack): Song | null {
  const id = raw.id;
  const title = raw.title?.trim();
  const durationMs = (Number(raw.duration) || 0) * 1000;
  if (!id || !title || durationMs < MIN_FULL_SONG_MS) return null;

  const artwork = raw.artwork;
  const pick = (k: string) => {
    const v = artwork?.[k];
    return typeof v === 'string' && v ? v : '';
  };

  return {
    id: `audius-${id}`,
    title,
    artist: raw.user?.name?.trim() || 'Unknown',
    cover: pick('480x480') || pick('150x150'),
    // Stable API URL rakhte hain (direct content-node URL nahi): 302 pe Audius
    // khud healthy node chunta hai — koi node down ho to agli baar doosra milega.
    preview: `${AUDIUS_BASE}/tracks/${id}/stream?app_name=${AUDIUS_APP_NAME}`,
    duration: durationMs,
    // Audius full song deta hai → "30s" badge / preview note nahi dikhega
    previewOnly: false,
  };
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

/* ---------- Jamendo shapes (optional source) ---------- */

interface JamendoTrack {
  id?: number;
  name?: string;
  /** seconds */
  duration?: number;
  /** direct mp3 (legal, CDN-hosted) */
  audio?: string;
  album_image?: string;
  image?: string;
  artist?: { name?: string };
}

interface JamendoResponse {
  results?: JamendoTrack[];
}

/**
 * Jamendo → Song. Audio URL DIRECT milti hai (koi WebView nahi) — isliye ye
 * source TrackPlayer ke saath poori tarah compatible hai (notification +
 * background play + room sync sab normal chalta hai).
 * `previewOnly` duration se honestly set (60s se chhota = preview).
 */
function mapJamendoTrack(raw: JamendoTrack): Song | null {
  const id = raw.id;
  const title = raw.name?.trim();
  const preview = raw.audio;
  if (!id || !title || !preview) return null;
  const durationMs = (Number(raw.duration) || 0) * 1000;
  return {
    id: `jamendo-${id}`,
    title,
    artist: raw.artist?.name?.trim() || 'Unknown',
    cover: raw.album_image ?? raw.image ?? '',
    preview,
    duration: durationMs || 30_000,
    previewOnly: durationMs < MIN_FULL_SONG_MS,
  };
}

/* ---------- Sources ---------- */

/** Mirror ko TTL ke liye skip karo (HTTP-dead ya audio-dead — dono ka same lag) */
function markMirrorDead(base: string, why: string) {
  mirrorDeadUntil.set(base, Date.now() + MIRROR_DEAD_TTL_MS);
  console.warn(`[musicApi] JioSaavn mirror skip ${MIRROR_DEAD_TTL_MS / 60000}min (${base}) — ${why}`);
}

/**
 * Audio guard — HEAD request se check karo ki download URL zinda hai ya nahi.
 * Zaroori kyun: `jiosaavn-api-2` jaise mirrors perfect metadata (320kbps link
 * tak) dete hain lekin CDN par file 404 hoti hai — warna app me "full song"
 * dikhkar bajta hi nahi. Ye check ek baar chalta hai (phir 10 min dead cache).
 * RN-safe: AbortController + manual timeout (AbortSignal.timeout RN me nahi).
 */
function headOk(url: string): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (value: boolean) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      finish(false);
    }, MIRROR_TIMEOUT_MS);
    fetch(url, { method: 'HEAD', signal: controller.signal })
      .then(res => finish(res.ok))
      .catch(() => finish(false))
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Ek JioSaavn mirror try karo (do paths: /api/search/songs aur /search/songs —
 * alag mirrors alag path + alag response shape use karte hain).
 * Fail hone ke teen reasons hain, teeno pe mirror TTL ke liye dead:
 *   1. HTTP error/network/timeout
 *   2. results aaye lekin kisi me downloadUrl hi nahi (unusable shape)
 *   3. downloadUrl hai lekin HEAD pe 404 (zombie metadata mirror)
 */
async function probeJioSaavnMirror(base: string, query: string, limit: number): Promise<Song[]> {
  const paths = ['/api/search/songs', '/search/songs'];
  let gotHttpOk = false;

  for (const path of paths) {
    try {
      const res = await axios.get<unknown>(`${base}${path}`, {
        params: { query, limit },
        timeout: MIRROR_TIMEOUT_MS,
      });
      gotHttpOk = true;

      const raw = extractJioSaavnResults(res.data);
      // 0 results = is query pe match nahi hua — mirror galat nahi hai
      if (raw.length === 0) continue;

      const songs = raw
        .map(mapJioSaavnSong)
        .filter((s): s is Song => s !== null);
      if (songs.length === 0) {
        markMirrorDead(base, 'results hue lekin downloadUrl nahi (unusable shape)');
        return [];
      }

      if (!(await headOk(songs[0].preview))) {
        markMirrorDead(base, 'metadata mila par audio CDN 404 (stale links)');
        return [];
      }
      return songs;
    } catch {
      // 404 / network / timeout — agla path try karo
    }
  }

  if (!gotHttpOk) markMirrorDead(base, 'HTTP error / timeout (sare paths)');
  return [];
}

/** Try 1 — JioSaavn mirrors (full song, 320kbps) */
async function searchJioSaavn(query: string, limit: number): Promise<Song[]> {
  const now = Date.now();
  const candidates = JIOSAAVN_MIRRORS.filter(base => (mirrorDeadUntil.get(base) ?? 0) < now);
  if (candidates.length === 0) return [];

  // Parallel + pehla success jeeta — ek slow mirror baaki ko na rok de
  const songs = await firstNonEmpty(candidates.map(base => probeJioSaavnMirror(base, query, limit)));
  return songs.slice(0, limit);
}

/** Try 2 — Audius (free, no API key, full songs 60s+) */
async function searchAudius(query: string, limit: number): Promise<Song[]> {
  const res = await axios.get<AudiusResponse>(`${AUDIUS_BASE}/tracks/search`, {
    params: { query, limit, app_name: AUDIUS_APP_NAME },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const songs = (res.data.data ?? [])
    .map(mapAudiusTrack)
    .filter((s): s is Song => s !== null);
  return dedupeByTitle(songs).slice(0, limit);
}

/**
 * Audius PAGINATED (2026-10-05) — ek page ~30 deta hai, isliye offsets parallel
 * maangein. PROBE: offset=0 → 30, offset=30 → 28, offset=60 → 0, aur page0 ∩
 * page1 = 0 overlap. Matlab 2 page GENUINELY ~58 unique dete hain (pehle sirf
 * 30). 3rd page pool khaali hai — isliye AUDIUS_MAX_PAGES=2.
 *
 * Pages parallel chalti hain (latency ek hi round-trip jitni rehti hai) aur
 * merge order preserve hota hai taaki dedupe stable rahe.
 */
async function searchAudiusPaginated(query: string, maxResults: number): Promise<Song[]> {
  const pages = Math.max(1, Math.min(AUDIUS_MAX_PAGES, Math.ceil(maxResults / AUDIUS_PAGE_SIZE)));
  if (pages === 1) return searchAudius(query, Math.min(maxResults, AUDIUS_PAGE_SIZE));

  const fetched = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) =>
      axios
        .get<AudiusResponse>(`${AUDIUS_BASE}/tracks/search`, {
          params: {
            query,
            limit: AUDIUS_PAGE_SIZE,
            offset: i * AUDIUS_PAGE_SIZE,
            app_name: AUDIUS_APP_NAME,
          },
          timeout: REQUEST_TIMEOUT_MS,
        })
        .then(res =>
          (res.data.data ?? [])
            .map(mapAudiusTrack)
            .filter((s): s is Song => s !== null),
        ),
    ),
  );
  const all: Song[] = [];
  fetched.forEach((r, i) => {
    if (r.status === 'fulfilled') all.push(...r.value);
    else console.warn(`[musicApi] Audius page ${i} fail:`, r.reason);
  });
  return dedupeByTitle(all).slice(0, maxResults);
}

/**
 * Jamendo (OPTIONAL) — key na ho to [] (app normal chalta rehta hai).
 * Audio direct CDN URL hai → TrackPlayer ke saath 100% compatible.
 */
async function searchJamendo(query: string, limit: number): Promise<Song[]> {
  if (!JAMENDO_KEY || JAMENDO_KEY.startsWith('YAHAN_') || JAMENDO_KEY.startsWith('YOUR')) {
    return [];
  }
  const res = await axios.get<JamendoResponse>(`${JAMENDO_BASE}/tracks/`, {
    params: {
      client_id: JAMENDO_KEY,
      search: query,
      limit: Math.min(limit, JAMENDO_FETCH_MAX),
      // legal-safe: downloadable tracks only
      audioformat: 'mp31',
      include: 'musicinfo',
    },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const songs = (res.data.results ?? [])
    .map(mapJamendoTrack)
    .filter((s): s is Song => s !== null);
  return dedupeByTitle(songs).slice(0, limit);
}

/** Try 3 — iTunes (sirf 30s preview) */
async function searchITunes(query: string, limit: number): Promise<Song[]> {
  const res = await axios.get<ITunesResponse>(ITUNES_BASE, {
    params: { term: query, media: 'music', entity: 'song', limit, country: ITUNES_COUNTRY },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return (res.data.results ?? [])
    .map(mapITunesSong)
    .filter((s): s is Song => s !== null);
}

/**
 * Ek artist ka Audius search — naam poora miss ho to pehla word try karo.
 * Probe-se-verified case: "Gurdas Maan" → Audius 0 (exact-phrase miss), lekin
 * "gurdas" → 24 results / 20 full (asli Gurdas Mann tracks). Token fallback ke
 * baad sirf wahi tracks rakhte hain jismein wahi token title/artist me hai —
 * random fuzzy hits nahi chahiye.
 */
async function searchAudiusArtist(name: string, limit: number): Promise<Song[]> {
  const direct = await searchAudius(name, limit);
  if (direct.length >= 3) return direct;

  const tokenWord = name.split(/\s+/).find(w => w.length >= 5);
  if (!tokenWord || tokenWord.toLowerCase() === name.toLowerCase()) return direct;

  const token = normalizeTitle(tokenWord);
  const alt = await searchAudius(tokenWord, limit).catch(() => [] as Song[]);
  const filtered = alt.filter(
    s => normalizeTitle(s.title).includes(token) || normalizeTitle(s.artist).includes(token),
  );
  return dedupeByTitle([...direct, ...filtered]);
}

/**
 * Artist expansion — iTunes results ke artist names se Audius search.
 * Ye un queries ka ilaaj hai jahan Audius direct query pe 0 deta hai:
 * "Diljit party" → 0, lekin artist "Diljit Dosanjh" → 30 full songs.
 * Ek artist fail ho to doosra chal raha hota hai (sare parallel).
 */
async function searchAudiusByArtists(artists: string[], perArtistLimit = 20): Promise<Song[]> {
  if (artists.length === 0) return [];
  const batches = await Promise.all(
    artists.map(name =>
      searchAudiusArtist(name, perArtistLimit).catch((err: unknown) => {
        console.warn('[musicApi] Audius artist fail:', name, err);
        return [] as Song[];
      }),
    ),
  );
  return dedupeByTitle(batches.flat());
}

/**
 * Per-song upgrade — iTunes ke top tracks ko Audius ke FULL version se replace
 * karo (title match). Ye sabse precise pass hai: user ko wahi gaana chahiye jo
 * iTunes list me tha, bas 30s ki jagah pura. Fail ho to wahi 30s preview rehta hai.
 */
async function upgradeITunesWithAudius(songs: Song[], cap: number): Promise<Song[]> {
  const targets: number[] = [];
  for (let i = 0; i < songs.length && targets.length < cap; i++) {
    if (songs[i].previewOnly) targets.push(i);
  }
  if (targets.length === 0) return songs;

  const upgraded = await Promise.all(
    targets.map(async idx => {
      const song = songs[idx];
      try {
        const candidates = await searchAudius(`${song.title} ${song.artist}`, 10);
        const hit = candidates.find(c => titleMatches(song.title, c.title));
        if (!hit) return song;
        return {
          ...song,
          preview: hit.preview,
          duration: hit.duration,
          cover: song.cover || hit.cover,
          previewOnly: false,
        };
      } catch {
        return song;
      }
    }),
  );

  const out = [...songs];
  targets.forEach((idx, k) => {
    out[idx] = upgraded[k];
  });
  return out;
}

/* ---------- Public API ---------- */

/**
 * Search songs — full-song-first chain:
 * JioSaavn (full) → Audius direct (full) → iTunes + upgrade passes.
 * Kaunsa source chala wo console me `[musicApi] …` line me dikhta hai.
 */
export async function searchSongs(query: string, limit = 30): Promise<Song[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // ---- Try 1: JioSaavn mirrors (full song) ----
  try {
    const songs = await searchJioSaavn(trimmed, limit);
    if (songs.length > 0) {
      logSource(trimmed, 'jiosaavn', songs.length, 'full');
      return songs;
    }
  } catch (err) {
    console.warn('[musicApi] JioSaavn fail:', err);
  }

  // ---- Try 2 + 3 + 4 (parallel): Audius paginated + iTunes(big) + Jamendo ----
  // iTunes ab sirf fallback nahi — uske artist/title se upgrade passes chalte hain
  let audius: Song[] = [];
  let itunes: Song[] = [];
  let jamendo: Song[] = [];
  const [audiusRes, itunesRes, jamendoRes] = await Promise.allSettled([
    searchAudiusPaginated(trimmed, AUDIUS_FETCH_MAX),
    searchITunes(trimmed, ITUNES_FETCH_MAX),
    searchJamendo(trimmed, JAMENDO_FETCH_MAX),
  ]);
  if (audiusRes.status === 'fulfilled') audius = audiusRes.value;
  else console.warn('[musicApi] Audius fail:', audiusRes.reason);
  if (itunesRes.status === 'fulfilled') itunes = itunesRes.value;
  else console.warn('[musicApi] iTunes fail:', itunesRes.reason);
  if (jamendoRes.status === 'fulfilled') jamendo = jamendoRes.value;
  else console.warn('[musicApi] Jamendo fail:', jamendoRes.reason);

  // Fast path: direct query se hi kaafi full songs mile → extra calls ki zarurat nahi
  if (audius.length >= AUDIUS_MIN_FULL_SONGS) {
    const merged = dedupeByTitle([...audius, ...jamendo, ...itunes]).slice(0, limit);
    logSource(trimmed, 'audius', merged.length, `full (jam=${jamendo.length}, previews=${itunes.length})`);
    return merged;
  }

  // ---- Upgrade passes (parallel): artist expansion + per-song upgrade ----
  // Expansion gate: iTunes results kam = fuzzy/garbage query → unrelated artists
  // expansion me nahi bhejte (wahan preview hi sahi hai, random full song nahi)
  const expandable = itunes.length >= MIN_ITUNES_FOR_EXPANSION;
  const candidates = expandable ? extractArtistCandidates(itunes, trimmed) : [];
  const [expanded, upgraded] = await Promise.all([
    searchAudiusByArtists(candidates).catch(() => [] as Song[]),
    upgradeITunesWithAudius(itunes, UPGRADE_CAP),
  ]);

  // Merge order = precision order: direct query > exact upgraded tracks >
  // artist matches > Jamendo full > baaki 30s previews. Full songs top pe.
  // NOTE: `upgradeITunesWithAudius` sirf UPGRADE_CAP(6) tak hi upgrade karta hai
  // (latency deliberate) — baaki itunes previews hi rehte hain, isliye 200-row
  // list me most entries 30s badge ke saath aayengi (that's honest + intended).
  const upgradedFull = upgraded.filter(s => !s.previewOnly);
  const previews = upgraded.filter(s => s.previewOnly);
  const merged = dedupeByTitle([
    ...audius,
    ...upgradedFull,
    ...expanded,
    ...jamendo,
    ...previews,
  ]).slice(0, limit);

  if (merged.length === 0) {
    logSource(trimmed, 'none', 0);
    return [];
  }

  const fullCount = merged.filter(s => !s.previewOnly).length;
  const source =
    fullCount === merged.length
      ? expanded.length > 0 || upgradedFull.length > 0
        ? 'itunes+upgrade'
        : 'audius'
      : fullCount > 0
        ? 'itunes+upgrade'
        : 'itunes';
  logSource(
    trimmed,
    source,
    merged.length,
    `${fullCount} full, ${merged.length - fullCount} 30s (audius=${audius.length}, artist=${expanded.length}, upgraded=${upgradedFull.length}, jamendo=${jamendo.length})`,
  );
  return merged;
}

/**
 * Home screen trending — probe-verified artist rotation se FULL songs.
 * Purana `searchSongs('punjabi hits')` sirf 1 full deta tha (baaki 29 × 30s),
 * isliye har call pe 3 random artist pick hote hain — fresh variety + guarantee
 * ki list full songs ki hai. Rotation kam pade to wahi query fallback.
 */
export async function getTrendingSongs(limit = 20): Promise<Song[]> {
  try {
    const picked = shuffle(TRENDING_ARTISTS).slice(0, 3);
    const songs = await searchAudiusByArtists(picked, Math.ceil(limit / 2) + 5);
    if (songs.length >= Math.min(10, limit)) {
      logSource('trending', `artists(${picked.join(' / ')})`, songs.length, 'full');
      return shuffle(songs).slice(0, limit);
    }
  } catch (err) {
    console.warn('[musicApi] trending rotation fail:', err);
  }
  return searchSongs('punjabi hits', limit);
}

/** Mood-based playlist (Phase 4) — trending mood seedhi artist rotation se */
export async function getSongsByMood(mood: Mood, limit = 30): Promise<Song[]> {
  if (mood.id === 'trending') return getTrendingSongs(limit);
  return searchSongs(mood.query, limit);
}
