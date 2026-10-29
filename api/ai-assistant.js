// api/ai-assistant.js — Vercel serverless function (Phase 13c).
//
// KYUN ye endpoint chahiye:
//   Chat intent protocol server pe decide hota hai (Gemini key NFR-4.1
//   server-side), par EXECUTION client pe hota hai — playback local hai,
//   catalog resolve client ke search chain se. Sirf {action, args, reply}
//   JSON jata hai, koi audio/URL nahi (13b jaisi honest boundary).
//
// FAIL-CLOSED:
//   - GEMINI_API_KEY missing → 400 no_key (13b ke saath SAME key share)
//   - Rate limit 20/day + 5/hour per device (2-window limiter,
//     instance-memory best-effort)
//   - Gemini timeout/network/garbage → 502 upstream
import {
  ASSISTANT_DAILY_LIMIT,
  ASSISTANT_HOURLY_LIMIT,
  buildAssistantGeminiRequest,
  buildAssistantPrompt,
  normalizeAssistantRequest,
  parseAssistantResponse,
  rateLimitBucket,
} from './_aiAssistantCore.js';
import { extractGeminiText } from './_aiPlaylistCore.js';

/** Gemini timeout budget — free tier latency ~10s, 20s buffer (13b parity) */
const GEMINI_TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').replace(/[^a-z0-9.\-]/gi, '');

const rateState = new Map(); // deviceId → {hits} — assistant apna bucket state

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) {
    res.status(400).json({ error: 'no_key' });
    return;
  }

  const body = req.body ?? {};
  const input = normalizeAssistantRequest(body);
  if (!input) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  const bucket = rateLimitBucket(rateState, input.deviceId, Date.now(), {
    daily: ASSISTANT_DAILY_LIMIT,
    hourly: ASSISTANT_HOURLY_LIMIT,
  });
  if (!bucket.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, bucket.retryAfterSec)));
    res.status(429).json({ error: 'rate_limited', retryAfterSec: bucket.retryAfterSec });
    return;
  }

  const { url, init } = buildAssistantGeminiRequest(
    DEFAULT_MODEL,
    apiKey,
    buildAssistantPrompt(input),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const geminiRes = await fetch(url, { ...init, signal: controller.signal });
    if (!geminiRes.ok) {
      console.warn('[ai-assistant] gemini status:', geminiRes.status);
      res.status(502).json({ error: 'upstream' });
      return;
    }
    const payload = await geminiRes.json();
    const text = extractGeminiText(payload);
    const reply = parseAssistantResponse(text);
    if (!reply) {
      res.status(502).json({ error: 'upstream' });
      return;
    }
    res.status(200).json({
      ...reply,
      remaining: bucket.remaining,
      disclosure: true,
      limits: { daily: ASSISTANT_DAILY_LIMIT, hourly: ASSISTANT_HOURLY_LIMIT },
    });
  } catch (err) {
    console.warn('[ai-assistant] gemini call failed:', err);
    res.status(502).json({ error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
}
