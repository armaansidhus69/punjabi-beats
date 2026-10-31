// api/youtube-match.js — Vercel serverless function
//
// KYUN ye endpoint chahiye:
//   `musicstream-sdk` Node-only hai (child_process/fs/youtubei.js) — React Native
//   app ise bundle NAHI kar sakta. Isliye YouTube search server pe hota hai aur
//   app sirf JSON (videoId/title/channel/durationSec) laata hai. Scoring app ke
//   andar hoti hai (`mobile/services/songMatch.ts`) — isse algorithm ek jagah
//   rehta hai, server pe duplicate nahi hota.
//
// SCOPE (honest):
//   - Ye SIRF SEARCH karta hai. Audio STREAM/RESOLVE nahi karta — dekho neeche.
//   - `getStream()` is machine pe fail hota hai (probe 2026-10-01):
//       `format.decipher failed: you must provide your own JavaScript evaluator`
//       → fallback `spawn yt-dlp ENOENT`. Matlab yt-dlp binary ke bina playable
//       URL nahi milta, aur Vercel serverless pe yt-dlp install nahi hota.
//     Isliye is endpoint me `getStream` deliberately NAHI hai (warna har call
//     10s+ latke aur 500 de).
//   - Search ke liye yt-dlp ki zarurat NAHI — probe-verified (3/3 queries ok).
import { MusicKit } from 'musicstream-sdk';

// SDK search ka default limit 20-40 ke aas paas hai (limit option ignore hota
// hai — probe: limit:5 pe 20 aaye), isliye server pe hi cap karte hain.
const MAX_RESULTS = 10;
const CACHE_TTL_MS = 10 * 60_000;

/** Warm instance me reuse — rate-limit bachane ke liye */
const kit = new MusicKit({ logLevel: 'silent' });

/** query → { at, candidates } (warm-instance cache) */
const cache = new Map();

/** Server-side result ko app ke MatchCandidate shape me badlo */
function toCandidate(song) {
  return {
    videoId: song.videoId,
    title: song.title,
    // SDK `Song.artist` — video hits me ye uploader/channel hota hai
    channel: song.artist ?? '',
    // SDK seconds me deta hai; app bhi seconds (`durationSec`) leta hai
    durationSec: typeof song.duration === 'number' ? song.duration : 0,
  };
}

function setCors(res) {
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-publish-token');
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
    }
    res.status(204);
    if (typeof res?.end === 'function') res.end();
    return;
  }

  // App POST karta hai; browser/curl se GET ?q= bhi chalega
  let query;
  let limit = 5;
  if (req.method === 'POST') {
    const body = req.body || {};
    query = body.query;
    if (typeof body.limit === 'number' && body.limit > 0) limit = body.limit;
  } else if (req.method === 'GET') {
    query = req.query?.q;
    const l = Number(req.query?.limit);
    if (Number.isFinite(l) && l > 0) limit = l;
  } else {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Missing query (string)' });
  }

  const q = query.trim().slice(0, 200);
  const capped = Math.min(Math.max(1, limit), MAX_RESULTS);

  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ query: q, candidates: hit.candidates.slice(0, capped) });
  }

  try {
    const songs = await kit.search(q, { filter: 'songs', limit: capped });
    const candidates = (Array.isArray(songs) ? songs : [])
      .map(toCandidate)
      .filter(c => c.videoId && c.title)
      .slice(0, capped);

    cache.set(q, { at: Date.now(), candidates });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ query: q, candidates });
  } catch (e) {
    console.error('youtube-match search failed:', e);
    return res.status(502).json({
      error: 'YouTube search failed',
      code: e?.code ?? 'UNKNOWN',
      candidates: [],
    });
  }
}
