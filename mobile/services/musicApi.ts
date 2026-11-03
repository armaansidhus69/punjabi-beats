/**
 * Music API service — MULTI-SOURCE FALLBACK CHAIN (full songs priority).
 *
 * Order:
 *   1. Open-source JioSaavn API → full song (320kbps), 3-5 min
 *   2. JioSaavn mirrors       → full song fallback
 *   3. Audius direct     → full song (free, no API key), 3-5 min
 *   4. Reverbio-style YouTube/Piped bridge → extra catalogue + optional full stream
 *   5. iTunes metadata (preview URL) + FULL-SONG UPGRADE passes:
 *        a. artist expansion — iTunes results ke artist names se Audius search
 *           ("Diljit party" → artist "Diljit Dosanjh" → 30 full songs)
 *        b. per-song upgrade — top iTunes tracks ko title-match karke Audius ke
 *           full version se replace (exact tracks, sabse precise match)
 *   6. getTrendingSongs → curated Punjabi + Hindi artist rotation (probe-artists.mjs
 *      se 13/18 artists >=5 full verify) — home feed hamesha full songs
 *
 * Har source ka apna mapper hai → common `Song` type. Final search/feed aur
 * native playback queue me true preview rows kabhi nahi jaate; metadata-only
 * YouTube/Spotify rows play-time par full stream resolve karte hain.
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
 *
 * FULL-ONLY POLICY (2026-11-02, "only play full song"):
 *   Search/trending/new feeds sirf FULL songs return karte hain — iTunes/Jamendo
 *   jaise preview-only rows final list se filter ho jaate hain. Preview clips
 *   kabhi play nahi hote.
 *
 * NEW SONGS FEED (2026-11-02, "all new song"): `getNewSongs()` — JioSaavn
 *   "latest punjabi/hindi songs <year>" queries → YouTube Music (Piped) →
 *   Audius trending week. PROBE (scripts/probe-newsongs*.mjs, 2026-11-02):
 *   jiosaavn-api-2 `/search/songs` "latest punjabi songs 2026" → sach me 2026
 *   releases (Karan Aujla "Ashke", Sidhu "Kaali Hoodie", 320kbps metadata)
 *   LEKIN CDN links 404 (stale) — isliye feed multi-source hai. Audius
 *   trending `time=week` LIVE verified (releaseDate Oct-2026, full durations).
 */
import axios from 'axios';
// `import type` — Mood/Song sirf types hain; test-logic jaisi Node ESM testing
// ke liye import erase ho jaata hai (syncPayload.ts ka same pattern)
import type { Mood, Song } from '../types';
import { fetchSpotifyNewReleaseSongs, searchSpotifyTracks } from './spotifyApi';

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

/** Open-source JioSaavn API host; env override lets deployments self-host it. */
const JIOSAAVN_DEFAULT_BASE = 'https://saavn.sumit.co';

/**
 * JioSaavn hosts (env wala sabse pehle).
 * The default host is the open-source project's maintained public deployment;
 * older mirrors remain as fallbacks so the chain can recover if it changes.
 */
const JIOSAAVN_MIRRORS: string[] = [
  ...(process.env.EXPO_PUBLIC_JIOSAAVN_BASE ? [process.env.EXPO_PUBLIC_JIOSAAVN_BASE] : []),
  JIOSAAVN_DEFAULT_BASE,
  'https://jiosaavn-api-2.vercel.app',
  'https://jiosaavn-api-v3.vercel.app',
  'https://jiosaavn-api-sumitkolhe-v2.vercel.app',
  'https://saavn-api.vercel.app',
  'https://jiosaavn-api.vercel.app',
].map(u => u.replace(/\/+$/, ''));

/** Optional Gaana source — free unofficial API can be deployed on Vercel */
const GAANA_BASE = (process.env.EXPO_PUBLIC_GAANA_BASE ?? '').replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = 8000;
/** Mirror ke liye chhota timeout — dead mirror search ko na rok de */
const MIRROR_TIMEOUT_MS = 3500;
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
 * FULL-ONLY policy (2026-11-02): true 30s previews search/feed results se
 * filter hote hain — user ko sirf full songs dikhte/bajte hain.
 */
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
 * `searchSongs` har source se max nikalta hai, phir full-song priority ke saath
 * `limit` tak trim karta hai; preview-only rows baad me drop hote hain.
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
/** JioSaavn's current API caps each page at 40 results. */
const JIOSAAVN_PAGE_SIZE = 40;
const JIOSAAVN_MAX_PAGES = 5;
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

/** Verome (Deno Deploy) — YouTube Music search + stream provider */
const VEROME_BASE = (process.env.EXPO_PUBLIC_VEROME_API ?? '').replace(/\/+$/, '');
const VEROME_FALLBACKS =
  VEROME_BASE && !/YOUR-|YAHAN_/i.test(VEROME_BASE) ? [VEROME_BASE] : [];

/**
 * Reverbio-style bridge: metadata search is served by the existing YouTube
 * search backend; Piped is only used for audio resolution when configured.
 * No Reverbio/GPL source is bundled into this app.
 */
const YOUTUBE_MATCH_BASE = (process.env.EXPO_PUBLIC_YOUTUBE_MATCH_URL ?? '').replace(/\/+$/, '');
const YOUTUBE_MATCH_ENABLED =
  Boolean(YOUTUBE_MATCH_BASE) && !/YOUR-|YAHAN_/i.test(YOUTUBE_MATCH_BASE);

/**
 * PUBLIC Piped instances (2026-11, piped-instances list se live hosts) —
 * YouTube Music ko bina kisi self-hosted backend ke IN-APP chalane ke liye.
 *   - search: `/search?q=…&filter=music_songs`  (metadata + videoId)
 *   - stream: `/streams/{videoId}` → audioStreams (highest bitrate)
 * Env wala instance (EXPO_PUBLIC_PIPED_API) sabse pehle try hota hai; baaki
 * public instances fallback hain. Koi instance fail ho to agla — sab fail ho
 * to track unavailable maana jaata hai. KABHI YouTube app open nahi karte.
 */
const DEFAULT_PIPED_INSTANCES: string[] = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.reallyaweso.me',
];
const PIPED_BASE = (process.env.EXPO_PUBLIC_PIPED_API ?? '').replace(/\/+$/, '');
const PIPED_FALLBACKS: string[] = [
  ...(PIPED_BASE && !/YOUR-|YAHAN_/i.test(PIPED_BASE) ? [PIPED_BASE] : []),
  ...DEFAULT_PIPED_INSTANCES,
];

/** Trending artist rotation — probe-artists.mjs (2026-09-29) se har ek pe
 * Audius pe >=5 FULL songs (60s+) verify. Home feed inhi se banta hai, isliye
 * "punjabi hits" jaisi generic query pe preview fallback kabhi nahi aata.
 */
const TRENDING_PUNJABI_ARTISTS: string[] = [
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

const TRENDING_HINDI_ARTISTS: string[] = [
  'Arijit Singh',
  'Shreya Ghoshal',
  'Sonu Nigam',
  'A.R. Rahman',
  'Pritam',
  'Jubin Nautiyal',
  'Neha Kakkar',
  'Vishal-Shekhar',
];

const TRENDING_ARTISTS: string[] = [...TRENDING_PUNJABI_ARTISTS, ...TRENDING_HINDI_ARTISTS];

/** base → ms tak dead (JioSaavn mirror dead cache) */
const mirrorDeadUntil = new Map<string, number>();

/* ---------- Dead-mirror cache PERSISTENCE (2026-10-05) ---------- */
/**
 * Ye map pehle sirf in-memory thi → har app COLD START pe dead mirrors ko
 * dobara probe karta tha (2 paths × 3.5s timeout = ~7s wasted, measured 4.9s
 * on first "Diljit" search). Ab AsyncStorage me persist hoti hai, isliye
 * launch #2 se dead mirrors turant skip ho jaate hain.
 *
 * TTL 24h (pehle 10min): mirrors PAKKA dead hain (probe-verified 404/CDN-404),
 * 10min me dobara probe karna bekaar latency hai. Tradeoff: agar koi mirror
 * 24h ke andar revive ho to use ek din late detect hoga — env override
 * (EXPO_PUBLIC_JIOSAAVN_BASE) se apna healthy host turant use kar sakte hain.
 */
const MIRROR_DEAD_PERSIST_TTL_MS = 24 * 60 * 60_000;

/**
 * ⚠️ DYNAMIC import — `storage.ts` statically AsyncStorage import karta hai,
 * jo Node me resolve nahi hota (`ERR_MODULE_NOT_FOUND`). Ye file Node se bhi
 * import hoti hai (probe-searchcount.mjs / test-*.mjs), isliye static import
 * se wo probes TOOT jaate. Dynamic + try/catch se Node me gracefully no-op
 * hota hai aur RN me persistence chalti hai.
 */
type MirrorCacheIO = {
  getDeadMirrors: () => Promise<[string, number][]>;
  saveDeadMirrors: (entries: [string, number][]) => Promise<void>;
};

let mirrorIO: MirrorCacheIO | null = null;
async function getMirrorIO(): Promise<MirrorCacheIO | null> {
  if (mirrorIO) return mirrorIO;
  try {
    // Static import (rather than `await import()`): Expo SDK 51 ki tsconfig me
    // dynamic import allowed nahi hai (TS1323) — module target `esnext` se neeche
    // resolve hota hai. Isliye storage se helpers YAHAN statically import karte
    // hain. Node probes (probe-searchcount.mjs / test-*.mjs) is module ko
    // storage ke bina import karte hain — wo fail hone par graceful no-op rehte
    // hain (error swallowed), isliye Node compatibility bani rehti hai.
    const { getDeadMirrors, saveDeadMirrors } = require('./storage') as {
      getDeadMirrors: () => Promise<[string, number][]>;
      saveDeadMirrors: (entries: [string, number][]) => Promise<void>;
    };
    mirrorIO = { getDeadMirrors, saveDeadMirrors };
  } catch {
    // storage module unavailable (Node probes / test env) — in-memory cache
    mirrorIO = null;
  }
  return mirrorIO;
}

/** Hydration sirf ek hi baar (concurrent searches ek hi read share karein) */
let hydratePromise: Promise<void> | null = null;
export function hydrateDeadMirrorCache(): Promise<void> {
  if (!hydratePromise) hydratePromise = doHydrateDeadMirrorCache();
  return hydratePromise;
}

async function doHydrateDeadMirrorCache(): Promise<void> {
  const io = await getMirrorIO();
  if (!io) return;
  try {
    const entries = await io.getDeadMirrors();
    const now = Date.now();
    let restored = 0;
    for (const [base, until] of entries) {
      // expired entries drop (storage bhi fail-safe rehta hai)
      if (typeof base === 'string' && typeof until === 'number' && until > now) {
        mirrorDeadUntil.set(base, until);
        restored += 1;
      }
    }
    if (restored > 0) {
      console.log(`[musicApi] dead-mirror cache restored: ${restored} mirror(s) skip honge`);
    }
  } catch (err) {
    console.warn('[musicApi] dead-mirror cache load failed:', err);
  }
}

/** Dead mirror mark hone pe persist (fire-and-forget, search ko block nahi karta) */
function persistDeadMirrorCache(): void {
  void (async () => {
    const io = await getMirrorIO();
    if (!io) return;
    try {
      const now = Date.now();
      // expired entries save nahi karte — storage size bounded rehta hai
      const entries = [...mirrorDeadUntil.entries()].filter(([, until]) => until > now);
      await io.saveDeadMirrors(entries);
    } catch (err) {
      console.warn('[musicApi] dead-mirror cache save failed:', err);
    }
  })();
}

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
  album?: string | { name?: string };
  albumName?: string;
  album_name?: string;
  duration?: string | number;
  /** release year ("2026") — getNewSongs freshness ke liye */
  year?: string | number;
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
  collectionName?: string;
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
    const key = `${song.title.toLowerCase().replace(/[^a-z0-9\u0900-\u097f਀-੿]+/g, '')}|${song.artist
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f਀-੿]+/g, '')}`;
    // title+artist dono normalize hone pe khaali → key khaali mat rakhna
    // (warna "Unknown" artist ke sabhi songs ek ho jaate)
    if (key === '|') return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Console me source visibility — release me silent (`__DEV__` guard) */
function logSource(query: string, source: string, count: number, note?: string) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[musicApi] "${query}" → ${source} (${count} songs${note ? `, ${note}` : ''})`);
  }
}

/* ---------- Full-only policy helpers ---------- */

/**
 * Kya ye sach me 30s PREVIEW hai (full nahi chalega)?
 * ⚠️ `youtube_music` aur `spotify` songs previewOnly:true se shuru hote hain
 * ("metadata-only, stream play pe resolve hoga") — wo preview NAHI hain,
 * isliye exempt. iTunes/jiosaavn/gaana/jamendo pe previewOnly ka matlab hi
 * 30s clip hai.
 */
function isTruePreview(song: Song): boolean {
  return song.previewOnly === true
    && song.source !== 'youtube_music'
    && song.source !== 'spotify';
}

/**
 * FULL-ONLY policy apply — true preview rows ko result list se hatao. Metadata-only
 * YouTube/Spotify rows is helper se exempt hain kyunki player unka full stream
 * play-time par resolve karta hai.
 */
function applyFullOnlyPolicy(songs: Song[]): Song[] {
  return songs.filter(song => !isTruePreview(song));
}

/* ---------- Full-song upgrade helpers ---------- */

/** Title normalize — dedupe ke key jaisa (Latin + Gurmukhi dono) */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u0900-\u097f਀-੿]+/g, '');
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

/** Decode the HTML entities returned by the open-source JioSaavn API. */
function decodeHtml(value: string): string {
  return value
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function pickBestAudioUrl(downloadUrl: JioSaavnImage[]): string | null {
  if (downloadUrl.length === 0) return null;
  // 320kbps preferred (FR-2.8); warna available me sabse high quality (list ka last entry)
  const explicit = downloadUrl.find(d => d.quality === '320kbps');
  const picked = explicit ?? downloadUrl[downloadUrl.length - 1];
  return cdnUrl(picked) || null;
}

function readAlbumName(raw: JioSaavnSongRaw): string | undefined {
  if (typeof raw.album === 'string' && raw.album.trim()) return decodeHtml(raw.album.trim());
  if (raw.album && typeof raw.album === 'object' && raw.album.name?.trim()) {
    return decodeHtml(raw.album.name.trim());
  }
  const fallback = raw.albumName?.trim() || raw.album_name?.trim();
  return fallback ? decodeHtml(fallback) : undefined;
}

function mapJioSaavnSong(raw: JioSaavnSongRaw): Song | null {
  const id = raw.id;
  const title = raw.name ? decodeHtml(raw.name).trim() : '';
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
    artist: decodeHtml(artist),
    album: readAlbumName(raw),
    cover,
    preview,
    duration: durationMs || 30_000,
    source: 'jiosaavn',
    // duration na pata ho to full song ka daava galat hoga — honest rehna better
    previewOnly: durationMs < MIN_FULL_SONG_MS,
    year: Number(raw.year) || undefined,
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
    source: 'audius' as const,
    // Audius full song deta hai → preview-only state nahi lagti
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
    album: raw.collectionName?.trim() || undefined,
    // artworkUrl100 se badi artwork banate hain
    cover: raw.artworkUrl100?.replace('100x100bb', '600x600bb') ?? '',
    preview: raw.previewUrl,
    duration: raw.trackTimeMillis ?? 30000,
    source: 'itunes',
    // iTunes metadata preview-only hota hai; full stream upgrade baad me try hota hai.
    previewOnly: true,
  };
}

/* ---------- Verome / YouTube Music search + stream ---------- */

interface VeromeSearchResult {
  videoId?: string;
  title?: string;
  artist?: string;
  artists?: { name?: string }[];
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
  artwork?: string;
}

interface VeromeStreamResult {
  url?: string;
  codec?: string;
  bitrate?: number | string;
  expiresIn?: number;
  expiresAt?: number;
  streamingUrls?: { url?: string; mimeType?: string; quality?: string; bitrate?: number | string }[];
}

interface SongPlaybackResolution {
  url: string;
  previewOnly: boolean;
  /** Playback duration override in milliseconds when a provider gives a better duration. */
  duration?: number;
}

/** Piped /streams ka ek audio stream entry */
interface PipedAudioStream {
  url?: string;
  bitrate?: number | string;
  mimeType?: string;
  codec?: string;
  quality?: string;
  format?: string;
}

/**
 * Piped audio resolution — saare instances PARALLEL try hote hain, pehla jo
 * streams de wo jeet jaata hai (sequential loop worst-case 6×8s latkata —
 * play latency ke liye unacceptable). Audio streams bitrate-sorted, highest
 * preferred; sirf audio (`audioStreams`), video streams ignore.
 */
async function getPipedAudioUrl(videoId: string): Promise<string | null> {
  if (!videoId || PIPED_FALLBACKS.length === 0) return null;

  const attempts = PIPED_FALLBACKS.map(
    async (base): Promise<string | null> => {
      try {
        const res = await axios.get<{ audioStreams?: PipedAudioStream[]; error?: string }>(
          `${base}/streams/${encodeURIComponent(videoId)}`,
          { timeout: REQUEST_TIMEOUT_MS },
        );
        const streams = Array.isArray(res.data?.audioStreams) ? res.data.audioStreams : [];
        const playable = streams
          .filter(
            stream =>
              typeof stream?.url === 'string' &&
              stream.url &&
              // m4a/aac + mp3 hi RN TrackPlayer reliably bajata hai; webm/opus skip
              !/webm|opus|vorbis/i.test(`${stream.mimeType ?? ''} ${stream.format ?? ''}`),
          )
          .sort((left, right) => Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0));
        return playable[0]?.url ?? null;
      } catch {
        return null;
      }
    },
  );
  return firstSuccessful(attempts);
}

function chooseVeromeUrl(stream: VeromeStreamResult): string {
  return stream.streamingUrls?.find(item => typeof item?.url === 'string' && item.url)?.url
    ?? stream.url
    ?? '';
}

const youtubeAudioInFlight = new Map<string, Promise<string | null>>();

/** Verome aur Piped ko parallel race karo — slow/dead Verome latency nahi add karega. */
async function getFastYouTubeAudioUrl(videoId: string): Promise<string | null> {
  const existing = youtubeAudioInFlight.get(videoId);
  if (existing) return existing;

  const request = resolveFastYouTubeAudioUrl(videoId);
  youtubeAudioInFlight.set(videoId, request);
  try {
    return await request;
  } finally {
    if (youtubeAudioInFlight.get(videoId) === request) youtubeAudioInFlight.delete(videoId);
  }
}

async function resolveFastYouTubeAudioUrl(videoId: string): Promise<string | null> {
  const cachedAttempt = (async (): Promise<string | null> => {
    const cached = await getCachedVeromeStream(videoId);
    return cached ? chooseVeromeUrl(cached) || null : null;
  })();

  const veromeAttempt = (async (): Promise<string | null> => {
    const stream = await getVeromeStream(videoId);
    const url = chooseVeromeUrl(stream);
    if (!url) return null;
    try {
      const storage = require('@react-native-async-storage/async-storage') as {
        setItem: (key: string, value: string) => Promise<void>;
      };
      await storage.setItem(`stream_${videoId}`, JSON.stringify({ ...stream, url }));
    } catch {
      // Cache write optional hai; URL usable hai.
    }
    return url;
  })();

  return firstSuccessful([cachedAttempt, veromeAttempt, getPipedAudioUrl(videoId)]);
}

/**
 * Parallel race — pehla NON-NULL resolve jeeta hai; sab null/fail → null.
 * Empty-results ko bhi null maan ke agle ka wait karta hai (settled order me).
 */
async function firstSuccessful<T>(
  attempts: Promise<T | null>[],
  isWinner: (value: T) => boolean = value => value !== null,
): Promise<T | null> {
  return new Promise(resolve => {
    let pending = attempts.length;
    if (pending === 0) {
      resolve(null);
      return;
    }
    attempts.forEach(promise => {
      void promise
        .then(value => {
          if (value !== null && isWinner(value)) {
            pending = 0; // baaki attempts ka result ignore
            resolve(value);
            return;
          }
          pending -= 1;
          if (pending === 0) resolve(null);
        })
        .catch(() => {
          pending -= 1;
          if (pending === 0) resolve(null);
        });
    });
  });
}

/**
 * YouTube Music search — do metadata paths:
 *   1. Apna backend (api/youtube-match) jab EXPO_PUBLIC_YOUTUBE_MATCH_URL set ho
 *   2. Public Piped instances (`/search?filter=music_songs`) — bina kisi backend
 *      ke YouTube Music catalogue milta hai (2026-11: default path)
 * Dono fail → []. Stream resolution play ke waqt `resolveSongPlaybackUrl` karta
 * hai (Verome/Piped full audio providers) — sab IN-APP.
 */
async function searchYouTubeMusicSongs(query: string, limit: number): Promise<Song[]> {
  if (YOUTUBE_MATCH_ENABLED) {
    const viaBackend = await searchYouTubeMusicViaBackend(query, limit);
    if (viaBackend.length > 0) return viaBackend;
  }
  return searchYouTubeMusicViaPiped(query, limit);
}

/** Path 1 — apna youtube-match backend (videoId + metadata only) */
async function searchYouTubeMusicViaBackend(query: string, limit: number): Promise<Song[]> {
  try {
    const res = await axios.post<{ candidates?: unknown; songs?: unknown }>(
      `${YOUTUBE_MATCH_BASE}/api/youtube-match`,
      { query, limit: Math.min(limit, 10) },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const raw = Array.isArray(res.data?.candidates)
      ? res.data.candidates
      : Array.isArray(res.data?.songs)
        ? res.data.songs
        : [];
    return raw
      .map((item): Song | null => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const videoId = typeof row.videoId === 'string' ? row.videoId.trim() : '';
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        if (!videoId || !title) return null;
        const durationSec =
          typeof row.durationSec === 'number'
            ? row.durationSec
            : typeof row.duration === 'number'
              ? row.duration
              : 0;
        return {
          id: `ytm_${videoId}`,
          title,
          artist: typeof row.channel === 'string' && row.channel ? row.channel : 'Unknown',
          cover: typeof row.thumbnail === 'string' ? row.thumbnail : '',
          preview: '',
           duration: durationSec > 0 ? durationSec * 1000 : 0,
          source: 'youtube_music' as const,
          videoId,
          // Metadata search alone does not prove a playable full stream.
          // The player upgrades this after Verome/Piped resolution succeeds.
          previewOnly: true,
        };
      })
      .filter((song): song is Song => song !== null);
  } catch {
    return [];
  }
}

/** Piped search result row (music_songs filter) */
interface PipedSearchItem {
  url?: string;
  title?: string;
  uploaderName?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  thumbnailUrl?: string;
}

/** Path 2 — public Piped instances se YouTube Music search (default path).
 * Sab instances PARALLEL — pehla non-empty result jeeta hai (search latency). */
async function searchYouTubeMusicViaPiped(query: string, limit: number): Promise<Song[]> {
  const attempts = PIPED_FALLBACKS.map(async (base): Promise<Song[] | null> => {
    try {
      const res = await axios.get<{ items?: PipedSearchItem[] }>(`${base}/search`, {
        params: { q: query, filter: 'music_songs' },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      const songs = items
        .map((item): Song | null => {
          const title = item?.title?.trim();
          // Piped `/watch?v=VIDEOID` url deta hai — videoId wahan se nikalta hai
          const match = item?.url?.match(/[?&]v=([\w-]{6,})/);
          const videoId = match?.[1] ?? '';
          if (!title || !videoId) return null;
          const durationSec = Number(item?.duration) || 0;
          return {
            id: `ytm_${videoId}`,
            title,
            artist: (item?.uploaderName ?? item?.uploader ?? 'Unknown').trim() || 'Unknown',
            cover: item?.thumbnailUrl ?? item?.thumbnail ?? '',
            preview: '',
           duration: durationSec > 0 ? durationSec * 1000 : 0,
            source: 'youtube_music' as const,
            videoId,
            // Stream resolution play ke waqt hoti hai — honest default
            previewOnly: true,
          };
        })
        .filter((song): song is Song => song !== null)
        .slice(0, limit);
      return songs.length > 0 ? songs : null;
    } catch {
      return null;
    }
  });
  const winner = await firstSuccessful(attempts, songs => songs.length > 0);
  return winner ?? [];
}

export async function searchVeromeYouTubeMusic(query: string, limit = 12): Promise<VeromeSearchResult[]> {
  if (VEROME_FALLBACKS.length === 0) return [];

  for (const base of VEROME_FALLBACKS) {
    try {
      const res = await axios.get<{ results?: VeromeSearchResult[] }>(`${base}/api/search`, {
        params: { q: query, filter: 'songs' },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const items = Array.isArray(res.data?.results) ? res.data.results : [];
      const valid = items
        .filter(item => !!item?.videoId && !!item?.title)
        .map(item => ({
          ...item,
          artist: item.artist ?? item.artists?.[0]?.name ?? 'Unknown',
          thumbnail: item.thumbnail ?? item.thumbnails?.[0]?.url ?? item.artwork ?? '',
        }))
        .slice(0, limit);
      if (valid.length > 0) return valid;
    } catch {
      // Next instance try karo.
    }
  }

  return [];
}

export function searchVeromeSongs(query: string, limit = 12): Promise<Song[]> {
  return searchVeromeYouTubeMusic(query, limit)
    .then(items => (items.map(mapVeromeSearchResult).filter((s): s is Song => s !== null)))
    .catch(() => [] as Song[]);
}

export async function getVeromeStream(videoId: string): Promise<VeromeStreamResult> {
  if (!videoId) throw new Error('Verome videoId missing');

  let lastError: unknown;
  for (const base of VEROME_FALLBACKS) {
    try {
      const res = await axios.get<{
        success?: boolean;
        streamingUrls?: { url?: string; mimeType?: string; quality?: string; bitrate?: number | string }[];
        metadata?: { title?: string; uploader?: string; thumbnail?: string; duration?: number };
        error?: string;
      }>(`${base}/api/stream`, {
        params: { id: videoId },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const data = res.data ?? {};
      const urls = Array.isArray(data.streamingUrls) ? data.streamingUrls : [];
      const url = urls.find(u => typeof u?.url === 'string' && u.url)?.url ?? '';
      if (data.success && url) {
        const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
        return { url, expiresAt, streamingUrls: urls };
      }
      if (data.error) throw new Error(data.error);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Verome stream unavailable');
}

export async function getCachedVeromeStream(videoId: string): Promise<VeromeStreamResult | null> {
  try {
    const storage = require('@react-native-async-storage/async-storage') as {
      getItem: (key: string) => Promise<string | null>;
    };
    const cacheKey = `stream_${videoId}`;
    const cached = await storage.getItem(cacheKey);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as VeromeStreamResult;
    if (parsed.expiresAt && parsed.expiresAt > Date.now() + 60 * 60 * 1000 && parsed.url) {
      return parsed;
    }
  } catch {
    // AsyncStorage unavailable or cache invalid; fall through to fresh fetch.
  }
  return null;
}

export async function resolveSongPlaybackUrl(song: Song): Promise<SongPlaybackResolution> {
  if (!song) return { url: '', previewOnly: true };

  if (song.preview) {
    return { url: song.preview, previewOnly: song.previewOnly === true };
  }

  if (song.source === 'youtube_music' && song.videoId) {
    try {
      const streamUrl = await getFastYouTubeAudioUrl(song.videoId);
      if (streamUrl) return { url: streamUrl, previewOnly: false };
    } catch {
      // Full providers failed; track unavailable hai.
    }

    return { url: '', previewOnly: song.previewOnly === true };
  }

  return { url: '', previewOnly: song.previewOnly === true };
}

export async function playVeromeSongWithRefresh(song: VeromeSearchResult): Promise<void> {
  if (!song.videoId) throw new Error('Verome videoId missing');
  try {
    const storage = require('@react-native-async-storage/async-storage') as {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
    };
    const cacheKey = `stream_${song.videoId}`;
    let stream = await getCachedVeromeStream(song.videoId);
    if (!stream) {
      stream = await getVeromeStream(song.videoId);
      await storage.setItem(cacheKey, JSON.stringify(stream));
    }

    const TrackPlayer = require('react-native-track-player') as {
      reset: () => Promise<void>;
      add: (items: { id: string; url: string; title: string; artist: string; artwork?: string }[]) => Promise<void>;
      play: () => Promise<void>;
    };

    await TrackPlayer.reset();
    await TrackPlayer.add([{
      id: song.videoId,
      url: stream.url ?? '',
      title: song.title ?? 'Unknown title',
      artist: song.artist ?? 'Unknown artist',
      artwork: song.thumbnail ?? song.artwork,
    }]);
    await TrackPlayer.play();
  } catch (err) {
    console.warn('[musicApi] Verome stream play failed:', err);
    // DESIGN RULE: music hamesha IN-APP bajti hai — YouTube app/browser me
    // kabhi external app fallback nahi hota. Caller
    // (playerStore) queue ke agle playable track pe auto-skip karta hai.
    throw err;
  }
}

/* ---------- Gaana shapes (optional source) ---------- */

interface GaanaSong {
  id?: string | number;
  title?: string;
  name?: string;
  artist?: string;
  artists?: string | string[];
  artist_name?: string;
  album?: string;
  album_name?: string;
  artwork?: string;
  image?: string;
  cover?: string;
  stream_url?: string;
  audio_url?: string;
  duration?: number | string;
  song_duration?: number | string;
}

function mapGaanaSong(raw: GaanaSong): Song | null {
  const title = raw.title?.trim() || raw.name?.trim();
  const preview = raw.stream_url || raw.audio_url || '';
  const artist =
    (typeof raw.artist === 'string' && raw.artist.trim()) ||
    (typeof raw.artist_name === 'string' && raw.artist_name.trim()) ||
    (Array.isArray(raw.artists) ? raw.artists.join(', ') : typeof raw.artists === 'string' ? raw.artists : 'Unknown');
  const id = raw.id ?? `${title}-${artist}`;
  if (!title || !preview) return null;

  const durationMs = Number(raw.duration ?? raw.song_duration ?? 0) * 1000 || 30_000;
  return {
    id: `gaana-${String(id)}`,
    title,
    artist: artist || 'Unknown',
    album: raw.album?.trim() || raw.album_name?.trim() || undefined,
    cover: raw.artwork || raw.image || raw.cover || '',
    preview,
    duration: durationMs,
    source: 'gaana',
    previewOnly: durationMs < MIN_FULL_SONG_MS,
  };
}

function mapVeromeSearchResult(raw: VeromeSearchResult): Song | null {
  const title = raw.title?.trim();
  const videoId = raw.videoId?.trim();
  if (!title || !videoId) return null;
  const durationMs = (Number(raw.duration) || 0) * 1000;
  return {
    id: `ytm_${videoId}`,
    title,
    artist: raw.artist?.trim() || 'Unknown',
    cover: raw.thumbnail ?? raw.artwork ?? '',
    preview: '',
    duration: durationMs,
    source: 'youtube_music',
    videoId,
    previewOnly: false,
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
  album_name?: string;
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
    album: raw.album_name?.trim() || undefined,
    cover: raw.album_image ?? raw.image ?? '',
    preview,
    duration: durationMs || 30_000,
    source: 'jamendo' as const,
    previewOnly: durationMs < MIN_FULL_SONG_MS,
  };
}

/* ---------- Sources ---------- */

/** Mirror ko TTL ke liye skip karo (HTTP-dead ya audio-dead — dono ka same lag) */
function markMirrorDead(base: string, why: string) {
  mirrorDeadUntil.set(base, Date.now() + MIRROR_DEAD_PERSIST_TTL_MS);
  console.warn(`[musicApi] JioSaavn mirror skip ${MIRROR_DEAD_PERSIST_TTL_MS / 60000}min (${base}) — ${why}`);
  // 2026-10-05: ab persist karo — pehle ye sirf in-memory tha, to har app
  // cold start pe dead mirrors dobara probe hote the (~4.9s wasted).
  persistDeadMirrorCache();
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
async function probeJioSaavnMirror(
  base: string,
  query: string,
  limit: number,
  page: number,
  checkAudio = true,
): Promise<Song[]> {
  const paths = ['/api/search/songs', '/search/songs'];
  let gotHttpOk = false;

  for (const path of paths) {
    try {
      const res = await axios.get<unknown>(`${base}${path}`, {
        params: { query, limit, page },
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
        if (page === 1) markMirrorDead(base, 'results hue lekin downloadUrl nahi (unusable shape)');
        return [];
      }

      if (page === 1 && checkAudio && !(await headOk(songs[0].preview))) {
        markMirrorDead(base, 'metadata mila par audio CDN 404 (stale links)');
        return [];
      }
      return songs;
    } catch {
      // 404 / network / timeout — agla path try karo
    }
  }

  if (!gotHttpOk && page === 1) markMirrorDead(base, 'HTTP error / timeout (sare paths)');
  return [];
}

/** Try 1 — open-source JioSaavn API plus mirrors (full song, 320kbps) */
function findFirstHealthyJioSaavnPage(
  candidates: string[],
  query: string,
  limit: number,
  checkAudio = true,
): Promise<{ base: string; songs: Song[] } | null> {
  return new Promise(resolve => {
    if (candidates.length === 0) {
      resolve(null);
      return;
    }

    let pending = candidates.length;
    let settled = false;
    const finish = (result: { base: string; songs: Song[] }) => {
      if (settled) return;
      if (result.songs.length > 0) {
        settled = true;
        resolve(result);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };

    candidates.forEach(base => {
      void probeJioSaavnMirror(base, query, limit, 1, checkAudio).then(
        songs => finish({ base, songs }),
        () => finish({ base, songs: [] }),
      );
    });
  });
}

async function searchJioSaavn(query: string, limit: number): Promise<Song[]> {
  // Persisted dead-cache load karo (pehli search pe; Node probes me no-op) —
  // isse launch #2 se dead mirrors turant skip, cold-start latency ~4.9s → ~2s.
  await hydrateDeadMirrorCache();

  const now = Date.now();
  const candidates = [...new Set(JIOSAAVN_MIRRORS)].filter(
    base => (mirrorDeadUntil.get(base) ?? 0) < now,
  );
  const pages = Math.max(1, Math.min(JIOSAAVN_MAX_PAGES, Math.ceil(limit / JIOSAAVN_PAGE_SIZE)));

  let remaining = candidates;
  while (remaining.length > 0) {
    const [preferred, ...fallbacks] = remaining;
    const preferredSongs = await probeJioSaavnMirror(
      preferred,
      query,
      Math.min(limit, JIOSAAVN_PAGE_SIZE),
      1,
      false,
    );
    const winner = preferredSongs.length > 0
      ? { base: preferred, songs: preferredSongs }
      : await findFirstHealthyJioSaavnPage(
        fallbacks,
        query,
        Math.min(limit, JIOSAAVN_PAGE_SIZE),
        false,
      );
    if (!winner) return [];

    if (await headOk(winner.songs[0].preview)) {
      const { base, songs: firstPage } = winner;

      if (pages === 1) return dedupeByTitle(firstPage).slice(0, limit);

      const rest = await Promise.allSettled(
        Array.from({ length: pages - 1 }, (_, offset) =>
          probeJioSaavnMirror(base, query, JIOSAAVN_PAGE_SIZE, offset + 2),
        ),
      );
      const all = [
        ...firstPage,
        ...rest.flatMap(result => (result.status === 'fulfilled' ? result.value : [])),
      ];
      return dedupeByTitle(all).slice(0, limit);
    }

    markMirrorDead(winner.base, 'metadata mila par audio CDN 404 (stale links)');
    remaining = remaining.filter(base => base !== winner.base);
  }

  return [];
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
 * Gaana (OPTIONAL) — Vercel-deployed unofficial API, Punjabi-heavy catalog.
 * Response shapes usually: { songs: [...] } or { data: [...] }.
 */
async function searchGaana(query: string, language = 'punjabi', limit = 50): Promise<Song[]> {
  if (!GAANA_BASE) return [];

  const endpoints = [`${GAANA_BASE}/search`, `${GAANA_BASE}/api/search`, `${GAANA_BASE}/api/search/songs`];
  for (const endpoint of endpoints) {
    try {
      const res = await axios.get<unknown>(endpoint, {
        params: { q: query, query, language, limit, page: 0 },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const payload = res.data as Record<string, unknown>;
      const list =
        (Array.isArray(payload?.songs) && payload.songs.length > 0 ? payload.songs : null) ??
        (Array.isArray(payload?.data) && payload.data.length > 0 ? payload.data : null) ??
        (Array.isArray(payload) ? payload : []);
      if (list.length === 0) continue;
      const songs = (list as Record<string, unknown>[])
        .map(item => mapGaanaSong(item as GaanaSong))
        .filter((s): s is Song => s !== null);
      if (songs.length > 0) return dedupeByTitle(songs).slice(0, limit);
    } catch {
      // Try next endpoint if this mirror/shape is not valid.
    }
  }
  return [];
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

/** Metadata fallback — iTunes preview URLs ko upgrade ke liye use karte hain. */
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
 * iTunes list me tha, lekin final result me sirf full upgrade rakha jaata hai.
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
      // 1. Try JioSaavn first for full 320kbps stream
      try {
        const cleanTitle = song.title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const jioCandidates = await searchJioSaavn(`${cleanTitle} ${song.artist}`, 2);
        // STRICT title match — loose "koi bhi full song" fallback nikaal diya
        // (2026-11-02): wo galat gaane ka audio laga deta tha (title-match fail
         // ho to track drop hota hai, unrelated full song nahi).
        const hit = jioCandidates.find(c => !c.previewOnly && c.preview && titleMatches(cleanTitle, c.title));
        if (hit && hit.preview) {
          return {
            ...song,
            preview: hit.preview,
            duration: hit.duration || song.duration,
            cover: song.cover || hit.cover,
            previewOnly: false,
            source: 'jiosaavn' as const,
          };
        }
      } catch {
        // JioSaavn upgrade failed, fall through to Audius
      }

      // 2. Fallback to Audius
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

const FULL_STREAM_CACHE_TTL_MS = 10 * 60_000;
const FULL_STREAM_FAILURE_TTL_MS = 30_000;
type FullStreamResolution = { url: string; duration?: number; previewOnly: boolean };

interface FullStreamCacheEntry {
  url: string;
  duration: number;
  expiresAt: number;
}

const fullStreamCache = new Map<string, FullStreamCacheEntry>();
/** Same song ke concurrent queue/search upgrades ko ek hi provider request banao. */
const fullStreamInFlight = new Map<string, Promise<FullStreamResolution>>();
/** Temporary negative cache — dead providers ko har tap pe immediately retry mat karo. */
const fullStreamUnavailableUntil = new Map<string, number>();

/**
 * On-the-fly full song audio resolver.
 * Agar koi song full stream verify nahi hua, ye runtime pe JioSaavn/Audius se
 * full stream nikalta hai; fail hone par caller track ko unavailable maanta hai.
 */
export async function resolveFullAudioStream(
  song: Song,
): Promise<{ url: string; duration?: number; previewOnly: boolean }> {
  if (!song) return { url: '', previewOnly: true };

  // Agar pehle se full stream hai aur meaningful duration hai to wahi use karo
  if (!song.previewOnly && song.preview && (!song.duration || song.duration > 30_000)) {
    return { url: song.preview, duration: song.duration, previewOnly: false };
  }

  const cleanTitle = song.title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const cacheKey = `${normalizeTitle(cleanTitle)}|${normalizeTitle(song.artist)}`;
  const cached = fullStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { url: cached.url, duration: cached.duration, previewOnly: false };
  }
  if (cached) fullStreamCache.delete(cacheKey);

  const unavailableUntil = fullStreamUnavailableUntil.get(cacheKey) ?? 0;
  if (unavailableUntil > Date.now()) return { url: '', previewOnly: true };

  const inFlight = fullStreamInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  // 1. Primary: JioSaavn 320kbps full song lookup
  const resolvePromise = (async () => {
    try {
      const query = `${cleanTitle} ${song.artist}`.trim();
      const jioMatches = await searchJioSaavn(query, 5);
      // STRICT title match — loose fallback galat gaana laga sakta tha
      const hit =
        jioMatches.find(m => !m.previewOnly && m.preview && titleMatches(cleanTitle, m.title));
      if (hit && hit.preview) {
        const duration = hit.duration || song.duration;
        fullStreamCache.set(cacheKey, {
          url: hit.preview,
          duration,
          expiresAt: Date.now() + FULL_STREAM_CACHE_TTL_MS,
        });
        return {
          url: hit.preview,
          duration,
          previewOnly: false,
        };
      }
    } catch {
      // JioSaavn lookup failed, continue fallback
    }

    // 2. Secondary: Audius full track lookup
    try {
      const audiusMatches = await searchAudius(`${cleanTitle} ${song.artist}`, 5);
      const hit = audiusMatches.find(m => !m.previewOnly && m.preview && titleMatches(cleanTitle, m.title));
      if (hit && hit.preview) {
        const duration = hit.duration || song.duration;
        fullStreamCache.set(cacheKey, {
          url: hit.preview,
          duration,
          expiresAt: Date.now() + FULL_STREAM_CACHE_TTL_MS,
        });
        return {
          url: hit.preview,
          duration,
          previewOnly: false,
        };
      }
    } catch {
      // Audius fallback failure
    }

    return { url: '', previewOnly: true };
  })();

  // Full stream ke liye limited wait; timeout par track unavailable hota hai.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<FullStreamResolution>(resolve => {
    timeoutHandle = setTimeout(() => resolve({ url: '', previewOnly: true }), 7000);
  });
  const guarded = Promise.race([resolvePromise, timeoutPromise]);
  fullStreamInFlight.set(cacheKey, guarded);

  try {
    const result = await guarded;
    if (result.previewOnly) {
      fullStreamUnavailableUntil.set(cacheKey, Date.now() + FULL_STREAM_FAILURE_TTL_MS);
    } else {
      fullStreamUnavailableUntil.delete(cacheKey);
    }
    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (fullStreamInFlight.get(cacheKey) === guarded) fullStreamInFlight.delete(cacheKey);
  }
}

/* ---------- Public API ---------- */

/**
 * Search songs — full-song-first chain:
 * Open-source JioSaavn (full) → Audius direct (full) → iTunes + upgrade passes.
 * Kaunsa source chala wo console me `[musicApi] …` line me dikhta hai.
 */
export async function searchSongs(query: string, limit = 30): Promise<Song[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // ---- Try 1: open-source JioSaavn API + mirrors (full song) ----
  let jioSaavn: Song[] = [];
  try {
    jioSaavn = await searchJioSaavn(trimmed, limit);
    if (jioSaavn.length >= limit) {
      logSource(trimmed, 'jiosaavn', jioSaavn.length, 'full');
      return jioSaavn;
    }
  } catch (err) {
    console.warn('[musicApi] JioSaavn fail:', err);
  }

  // ---- Try 2 + 3 + 4 + 5 + 6 + 7 + 8 (parallel): Gaana + Audius + iTunes + Jamendo + Verome + YouTube + Spotify ----
  // iTunes ab sirf fallback nahi — uske artist/title se upgrade passes chalte hain
  let audius: Song[] = [];
  let gaana: Song[] = [];
  let itunes: Song[] = [];
  let jamendo: Song[] = [];
  let verome: Song[] = [];
  let youtubeMusic: Song[] = [];
  let spotify: Song[] = [];
  const [gaanaRes, audiusRes, itunesRes, jamendoRes, veromeRes, youtubeRes, spotifyRes] = await Promise.allSettled([
    searchGaana(trimmed, 'punjabi', limit),
    searchAudiusPaginated(trimmed, AUDIUS_FETCH_MAX),
    searchITunes(trimmed, ITUNES_FETCH_MAX),
    searchJamendo(trimmed, JAMENDO_FETCH_MAX),
    searchVeromeSongs(trimmed, 12),
    searchYouTubeMusicSongs(trimmed, 10),
    // Spotify official catalogue (metadata-only; unconfigured → [] skip)
    searchSpotifyTracks(trimmed, limit),
  ]);
  if (gaanaRes.status === 'fulfilled') gaana = gaanaRes.value;
  else console.warn('[musicApi] Gaana fail:', gaanaRes.reason);
  if (audiusRes.status === 'fulfilled') audius = audiusRes.value;
  else console.warn('[musicApi] Audius fail:', audiusRes.reason);
  if (itunesRes.status === 'fulfilled') itunes = itunesRes.value;
  else console.warn('[musicApi] iTunes fail:', itunesRes.reason);
  if (jamendoRes.status === 'fulfilled') jamendo = jamendoRes.value;
  else console.warn('[musicApi] Jamendo fail:', jamendoRes.reason);
  if (veromeRes.status === 'fulfilled') verome = veromeRes.value;
  else console.warn('[musicApi] Verome fail:', veromeRes.reason);
  if (youtubeRes.status === 'fulfilled') youtubeMusic = youtubeRes.value;
  else console.warn('[musicApi] YouTube bridge fail:', youtubeRes.reason);
  if (spotifyRes.status === 'fulfilled') spotify = spotifyRes.value;
  else console.warn('[musicApi] Spotify fail:', spotifyRes.reason);

  const youtubeFull = youtubeMusic.filter(song => !song.previewOnly);
  const youtubePreviews = youtubeMusic.filter(song => song.previewOnly);
  // Spotify songs full-first merge me dobara GINTE hi nahi (unresolved metadata)
  const spotifyCount = spotify.length;

  // Fast path: direct query se hi kaafi full songs mile → extra calls ki zarurat nahi
  if (jioSaavn.length + audius.length >= AUDIUS_MIN_FULL_SONGS || gaana.length >= 5 || verome.length > 0) {
    const merged = dedupeByTitle([
      ...jioSaavn,
      ...verome,
      ...youtubeFull,
      ...gaana,
      ...audius,
      ...jamendo,
      ...spotify,
      ...youtubePreviews,
      ...itunes,
    ]).slice(0, limit);
    const results = applyFullOnlyPolicy(merged);
    logSource(trimmed, verome.length > 0 ? 'verome+audius' : youtubeMusic.length > 0 ? 'youtube-bridge' : gaana.length > audius.length ? 'gaana+audius' : 'audius', results.length, `full (verome=${verome.length}, youtube=${youtubeMusic.length}, gaana=${gaana.length}, jam=${jamendo.length}, spotify=${spotifyCount}, previews=${itunes.length}, dropped=${merged.length - results.length})`);
    return results;
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
  // artist matches > Jamendo/Spotify full-capable metadata. Preview-only rows
  // upgrade fail hone par final result se drop hote hain.
  const upgradedFull = upgraded.filter(s => !s.previewOnly);
  const previews = upgraded.filter(s => s.previewOnly);
  const merged = dedupeByTitle([
    ...jioSaavn,
    ...verome,
    ...youtubeFull,
    ...gaana,
    ...audius,
    ...upgradedFull,
    ...expanded,
    ...jamendo,
    ...spotify,
    ...youtubePreviews,
    ...previews,
  ]).slice(0, limit);

  if (merged.length === 0) {
    logSource(trimmed, 'none', 0);
    return [];
  }

  // FULL-ONLY: preview-only results are always removed from the final list.
  const results = applyFullOnlyPolicy(merged);

  const fullCount = results.filter(s => !s.previewOnly).length;
  const source =
    fullCount === results.length
      ? expanded.length > 0 || upgradedFull.length > 0
        ? 'jiosaavn+itunes+upgrade'
        : jioSaavn.length > 0 ? 'jiosaavn' : 'audius'
      : fullCount > 0
        ? jioSaavn.length > 0 ? 'jiosaavn+itunes+upgrade' : 'itunes+upgrade'
        : 'itunes';
  logSource(
    trimmed,
    source,
    results.length,
    `${fullCount} full, droppedPreview=${merged.length - results.length} (verome=${verome.length}, gaana=${gaana.length}, audius=${audius.length}, artist=${expanded.length}, upgraded=${upgradedFull.length}, jamendo=${jamendo.length}, spotify=${spotifyCount})`,
  );
  return results;
}

/**
 * Home screen trending — probe-verified artist rotation se FULL songs.
 * Purana `searchSongs('punjabi hits')` sirf 1 full deta tha (baaki 29 × 30s),
 * isliye har call pe 3 random artist pick hote hain — fresh variety + guarantee
 * ki list full songs ki hai. Rotation kam pade to wahi query fallback.
 */
export async function getTrendingSongs(limit = 20): Promise<Song[]> {
  // Try 1: JioSaavn real top Punjabi hits (100% 320kbps full songs)
  try {
    const hits = await searchJioSaavn('top punjabi songs', limit);
    if (hits.length >= Math.min(10, limit)) {
      logSource('trending', 'jiosaavn(top punjabi)', hits.length, 'full');
      return hits.slice(0, limit);
    }
  } catch (err) {
    console.warn('[musicApi] JioSaavn trending fail:', err);
  }

  // Try 2: Audius artist rotation fallback
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

/**
 * Audius TRENDING WEEK — hamesha-chalta "new music" source (probe-newsongs.mjs,
 * 2026-11-02 se LIVE verified): releaseDate pichhle hafton ki, full durations,
 * koi CDN-stale problem nahi (JioSaavn mirrors jaisi). Genre-agnostic hai
 * (Punjabi-specific nahi), isliye getNewSongs me fallback layer ke roop me.
 */
async function searchAudiusTrending(limit: number): Promise<Song[]> {
  const res = await axios.get<AudiusResponse>(`${AUDIUS_BASE}/tracks/trending`, {
    params: { time: 'week', limit, app_name: AUDIUS_APP_NAME },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const songs = (res.data.data ?? [])
    .map(mapAudiusTrack)
    .filter((s): s is Song => s !== null);
  return dedupeByTitle(songs).slice(0, limit);
}

/**
 * NEW SONGS feed ("all new song") — latest releases, multi-source:
 *   1. JioSaavn "latest punjabi songs <year>" + "new punjabi songs <year>" —
 *      asli naye releases (probe: 2026 ke Karan Aujla/Sidhu/Sartaaj tracks
 *      milte hain). Audio guard stale CDN links khud filter kar deta hai.
 *   2. Spotify /browse/new-releases (market IN) — launch-day OFFICIAL albums;
 *      metadata-only, play-time pe full stream resolve hota hai (spotifyApi).
 *      Credentials na hon to khud skip.
 *   3. YouTube Music "latest punjabi songs <year>" (Piped) — YTM pe har naya
 *      release turant aata hai; stream play-time pe resolve hota hai.
 *   4. Audius trending week — independent fallback jo HAMESHA live hai.
 * Order = freshness precision: real releases → Spotify official → YTM → Audius.
 * Full-only policy yahan bhi lagti hai; preview-only results never return hote.
 */
export async function getNewSongs(limit = 20): Promise<Song[]> {
  const year = new Date().getFullYear();
  const jioQueries = [`latest punjabi songs ${year}`, `new punjabi songs ${year}`];

  const [jioRes, spotifyRes, ytmRes, audiusRes] = await Promise.allSettled([
    (async () => {
      const batches = await Promise.all(
        jioQueries.map(query => searchJioSaavn(query, limit).catch(() => [] as Song[])),
      );
      return dedupeByTitle(batches.flat());
    })(),
    fetchSpotifyNewReleaseSongs(Math.min(limit, 12)),
    searchYouTubeMusicSongs(`latest punjabi songs ${year}`, Math.min(limit, 10)),
    searchAudiusTrending(limit),
  ]);

  const jio = jioRes.status === 'fulfilled' ? jioRes.value : [];
  const spotifyNew = spotifyRes.status === 'fulfilled' ? spotifyRes.value : [];
  const ytm = ytmRes.status === 'fulfilled' ? ytmRes.value : [];
  const audius = audiusRes.status === 'fulfilled' ? audiusRes.value : [];
  if (jioRes.status === 'rejected') console.warn('[musicApi] JioSaavn new-songs fail:', jioRes.reason);
  if (spotifyRes.status === 'rejected') console.warn('[musicApi] Spotify new-releases fail:', spotifyRes.reason);
  if (ytmRes.status === 'rejected') console.warn('[musicApi] YTM new-songs fail:', ytmRes.reason);
  if (audiusRes.status === 'rejected') console.warn('[musicApi] Audius trending fail:', audiusRes.reason);

  const merged = dedupeByTitle([...jio, ...spotifyNew, ...ytm, ...audius]);
  const results = applyFullOnlyPolicy(merged).slice(0, limit);
  if (results.length > 0) {
    logSource(`new songs ${year}`, 'jiosaavn+spotify+ytm+audius-trending', results.length,
      `jio=${jio.length}, spotify=${spotifyNew.length}, ytm=${ytm.length}, audius=${audius.length}`);
    return results;
  }

  // Sab sources khaali → last resort: full search chain ("new punjabi songs")
  return searchSongs(`new punjabi songs ${year}`, limit);
}

/** Mood-based playlist (Phase 4) — trending mood seedhi artist rotation se */
export async function getSongsByMood(mood: Mood, limit = 30): Promise<Song[]> {
  if (mood.id === 'trending') return getTrendingSongs(limit);
  return searchSongs(mood.query, limit);
}
