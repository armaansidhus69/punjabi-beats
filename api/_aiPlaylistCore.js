// api/_aiPlaylistCore.js — Phase 13b AI playlist ke PURE helpers.
//
// KYUN alag file hai:
//   Vercel handler (ai-playlist.js) me fazool boilerplate hota hai (req/res +
//   fetch + abort). Ye helpers pure hain — headless test (test-ai-playlist.mjs)
//   ise bina mock ke import karke test karta hai, aur handler sirf binding
//   karta hai. Same pattern jo publish token compare / youtube-match scoring
//   me use hota hai (pure core sirf alag).
//
// SCOPE (honest):
//   - Rate limiter INSTANCE-MEMORY best-effort hai. Vercel cold-start pe
//     buckets reset ho jaate — client hourly guard pe bhi bharosa (defense
//     in depth, spec Section 3).

/** response array ka max size — Gemini ki lambi lists bhi yahin kaat (cap) */
export const AI_MAX_TRACKS = 15;
// Gemini 2.5 new projects ko 404 deta hai; ye current free-tier stable default hai.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
/** per-device per-day generations (free tier ke niche safe) */
export const AI_DAILY_LIMIT = 10;
/** per-device per-hour generations */
export const AI_HOURLY_LIMIT = 4;
/** user prompt/refine text ki hard limit (server-side guard) */
export const AI_PROMPT_MAX_CHARS = 240;

/** taste block server pe bhi slice karta hai — client trust nahi */
export const TASTE_ARTISTS_LIMIT = 10;
export const TASTE_SONGS_LIMIT = 10;
export const TASTE_QUERIES_LIMIT = 5;

/**
 * Normalized input — handler ko pehle validate karke hi pass karte.
 */
export function normalizeAiRequest(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length === 0 || prompt.length > AI_PROMPT_MAX_CHARS) return null;
  const deviceIdRaw = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (deviceIdRaw.length === 0 || deviceIdRaw.length > 64) return null;

  const refineText = typeof body?.refineText === 'string' ? body.refineText.trim() : '';
  if (refineText.length > AI_PROMPT_MAX_CHARS) return null;

  const taste = normalizeTaste(body?.taste);
  return { prompt, deviceId: deviceIdRaw, refineText, taste };
}

/** taste arrays server-side slice — bade payload hit drop */
function normalizeTaste(raw) {
  const taste = raw && typeof raw === 'object' ? raw : {};
  return {
    topSongs: takeStrings(taste.topSongs, TASTE_SONGS_LIMIT),
    topArtists: takeStrings(taste.topArtists, TASTE_ARTISTS_LIMIT),
    recentQueries: takeStrings(taste.recentQueries, TASTE_QUERIES_LIMIT),
  };
}

function takeStrings(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => typeof entry === 'string' && entry.trim().length > 0).slice(0, limit);
}

/**
 * Gemini ke liye prompt — user text sirf dedicated quoted slot me aata hai
 * (injection isolation: system-like instructions user tokens se na mile).
 * Response contract STRICT JSON array of {title, artist} (strings-only).
 */
export function buildAiPrompt({ prompt, taste, refineText = '' }) {
  const safePrompt = prompt.replace(/\u2014/g, '-');
  const safeRefine = refineText.replace(/\u2014/g, '-');
  const lines = [
    'You are a Punjabi music DJ assistant for a mobile app.',
    'Return ONLY a JSON array of track suggestions to match the user request, shaped as: [{"title": "<song title>", "artist": "<artist name>"}].',
    `Give at most ${AI_MAX_TRACKS} tracks, order best-first, no duplicates, no objects other than title/artist (an optional short "reason" string is allowed).`,
    'Prefer real, well-known songs that likely exist on mainstream streaming catalogs (JioSaavn/Audius/YouTube).',
    `User request: "${safePrompt}"`,
  ];
  if (safeRefine.length > 0) {
    lines.push(`User wants to refine the SAME list; merge intent: "${safeRefine}" (keep tracks still fitting, adjust for the refine note).`);
  }
  if (taste.topArtists.length > 0) {
    lines.push(`User's most-played artists: ${taste.topArtists.join(', ')}.`);
  }
  if (taste.topSongs.length > 0) {
    lines.push(`Songs the user already plays/likes: ${taste.topSongs.join('; ')}. Match this taste unless the prompt says otherwise.`);
  }
  if (taste.recentQueries.length > 0) {
    lines.push(`Recent searches: ${taste.recentQueries.join(', ')}.`);
  }
  return lines.join('\n');
}

/** Gemini generateContent body shape (v1beta REST) */
export function buildGeminiRequest(model, apiKey, promptText) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
    },
  };
}

/** generateContent response se model text nikaalo (first candidate) */
export function extractGeminiText(payload) {
  const candidate = payload?.candidates?.find(entry => Array.isArray(entry?.content?.parts));
  if (!candidate) return null;
  const textParts = candidate.content.parts
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .filter(part => part.length > 0);
  return textParts.length > 0 ? textParts.join('') : null;
}

/**
 * Model text → validated {title, artist} track list.
 * Garbage / non-array / saare invalid rows → null (caller generic upstream).
 */
export function parseAiResponse(rawText) {
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return null;
  }
  const list = extractList(parsed);
  if (list === null) return null;

  const tracks = [];
  const seen = new Set();
  for (const candidate of list) {
    const track = toTrackRef(candidate);
    if (track === null) continue;
    const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(track);
    if (tracks.length >= AI_MAX_TRACKS) break;
  }
  return tracks.length > 0 ? tracks : null;
}

/** array ya {tracks: [...]} dono shapes accept (model kabhi wrap karta hai) */
function extractList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.tracks)) return parsed.tracks;
  if (Array.isArray(parsed?.songs)) return parsed.songs;
  return null;
}

function toTrackRef(candidate) {
  if (candidate === null || typeof candidate !== 'object') return null;
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const artistValue =
    typeof candidate.artist === 'string'
      ? candidate.artist
      : Array.isArray(candidate.artists) && typeof candidate.artists[0] === 'string'
        ? candidate.artists[0]
        : '';
  const artist = artistValue.trim();
  if (title.length === 0 || artist.length === 0) return null;
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
  const track = { title: title.slice(0, 120), artist: artist.slice(0, 120) };
  if (reason.length > 0) track.reason = reason.slice(0, 80);
  return track;
}

/**
 * 2-window per-device limiter (pure — caller state Map owns karta hai).
 * Uses optional custom limits (assistant chat apne 20/day + 5/hour ke liye);
 * default playlist generator ke 10/day + 4/hour.
 */
export function rateLimitBucket(state, deviceId, nowMs, limits) {
  const dailyLimit = typeof limits?.daily === 'number' && limits.daily > 0 ? limits.daily : AI_DAILY_LIMIT;
  const hourlyLimit = typeof limits?.hourly === 'number' && limits.hourly > 0 ? limits.hourly : AI_HOURLY_LIMIT;
  let device = state.get(deviceId);
  if (!device || !Array.isArray(device.hits)) {
    device = { hits: [] };
  }
  const hourAgo = nowMs - 60 * 60_000;
  const dayAgo = nowMs - 24 * 60 * 60_000;
  const hits = device.hits.filter(ts => ts > dayAgo);
  const hitsThisHour = hits.filter(ts => ts > hourAgo).length;
  const hitsThisDay = hits.length;

  // hourly window kab free hoga (sabse purana in-window hit + 1h)
  let retryAfterSec = 0;
  if (hitsThisHour >= hourlyLimit) {
    const oldestThisHour = hits.filter(ts => ts > hourAgo)[0] ?? nowMs;
    // day cap pehle aa sakta hai — retry dono me min
    retryAfterSec = Math.max(0, Math.ceil((oldestThisHour + 60 * 60_000 - nowMs) / 1000));
  }
  if (hitsThisDay >= dailyLimit) {
    const oldestThisDay = hits[0] ?? nowMs;
    const dayWait = Math.max(0, Math.ceil((oldestThisDay + 24 * 60 * 60_000 - nowMs) / 1000));
    retryAfterSec = retryAfterSec === 0 ? dayWait : Math.min(retryAfterSec, dayWait);
  }

  const allowed = retryAfterSec === 0;
  if (allowed) {
    hits.push(nowMs);
  }
  state.set(deviceId, { hits });

  return {
    allowed,
    retryAfterSec,
    remaining: allowed ? Math.min(dailyLimit - (hitsThisDay + 1), hourlyLimit - (hitsThisHour + 1)) : 0,
  };
}
