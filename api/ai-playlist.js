// api/ai-playlist.js — Vercel serverless function (Phase 13b).
//
// KYUN ye endpoint chahiye:
//   Gemini API key kabhi client pe nahi ja sakta (NFR-4.1) — generation
//   server pe hoti hai aur client ko sirf track {title, artist} refs jata hai.
//   Actual playable Songs client apne existing search chain
//   (JioSaavn → Audius → iTunes) se resolve karta hai — audio URLs server pe
//   resolve karna fragile + quota-heavy hota.
//
// FAIL-CLOSED:
//   - GEMINI_API_KEY missing → 400 no_key (deploy order rule: key PEHLE
//     Vercel env me, phir `npx vercel`).
//   - Rate limit instance-memory best-effort (2-window limiter core me).
//   - Gemini timeout/network fail → 502 upstream; garbage JSON → 502.
import {
  AI_DAILY_LIMIT,
  AI_HOURLY_LIMIT,
  DEFAULT_GEMINI_MODEL,
  buildAiPrompt,
  buildGeminiRequest,
  extractGeminiText,
  normalizeAiRequest,
  parseAiResponse,
  rateLimitBucket,
} from './_aiPlaylistCore.js';

/** Gemini timeout budget — free tier latency ~10s, 20s buffer */
const GEMINI_TIMEOUT_MS = 20_000;
/** model pin — free-tier friendly flash; env override deployments ke liye */
const DEFAULT_MODEL = (process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL).replace(/[^a-z0-9.\-]/gi, '');

const rateState = new Map(); // deviceId → {hits: number[]} — warm-instance only

function setCors(res) {
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-publish-token');
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'POST, OPTIONS');
    }
    res.status(204);
    if (typeof res?.end === 'function') res.end();
    return;
  }

  if (req.method !== 'POST') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'POST, OPTIONS');
    }
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) {
    res.status(400).json({ error: 'no_key' });
    return;
  }

  const body = req.body ?? {};
  const input = normalizeAiRequest(body);
  if (!input) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  // per-device limiter (2-window; instance-memory honest)
  const bucket = rateLimitBucket(rateState, input.deviceId, Date.now());
  if (!bucket.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, bucket.retryAfterSec)));
    res.status(429).json({ error: 'rate_limited', retryAfterSec: bucket.retryAfterSec });
    return;
  }

  const { url, init } = buildGeminiRequest(DEFAULT_MODEL, apiKey, buildAiPrompt(input));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const geminiRes = await fetch(url, { ...init, signal: controller.signal });
    if (!geminiRes.ok) {
      console.warn('[ai-playlist] gemini status:', geminiRes.status);
      res.status(502).json({ error: 'upstream' });
      return;
    }
    const payload = await geminiRes.json();
    const text = extractGeminiText(payload);
    const tracks = parseAiResponse(text);
    if (!tracks) {
      res.status(502).json({ error: 'upstream' });
      return;
    }
    // disclosure flag — client isse strip render karta hai (hard contract)
    res.status(200).json({
      tracks,
      remaining: bucket.remaining,
      disclosure: true,
      limits: { daily: AI_DAILY_LIMIT, hourly: AI_HOURLY_LIMIT },
    });
  } catch (err) {
    console.warn('[ai-playlist] gemini call failed:', err);
    res.status(502).json({ error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
}
