// api/publish.js — Vercel serverless function
// Frontend se direct Apinator publish nahi kar sakte (secrets expose ho jayenge),
// isliye ye proxy function secrets ko server-side rakh kar publish karta hai.
//
// 🔒 AUTH (2026-10-05): ye endpoint OPEN proxy tha — koi bhi POST karke kisi
// bhi room channel me arbitrary events bhej sakta tha (playback hijack, chat
// spam, Apinator quota drain). Room code 6 digits hai (1M space) to brute-force
// bhi realistic hai. Ab `x-publish-token` header MUST match server-side
// `PUBLISH_CLIENT_TOKEN`.
//
// ⚠️ HONEST LIMIT: ye token CLIENT bundle me hota hai (EXPO_PUBLIC_*), toh
// ye obfuscation hai, real authentication nahi — koi app binary decompile karke
// token nikal sakta hai. Isse casual/trivial abuse ruk jaata hai. Asli auth ke
// liye per-user signed session tokens chahiye (out of scope abhi).
//
// ⚠️ DEPLOY ORDER (zaroori): server par PUBLISH_CLIENT_TOKEN set karna padega.
//   Vercel: Settings → Env Variables → PUBLISH_CLIENT_TOKEN=<random 32 chars>
//   mobile/.env: EXPO_PUBLIC_PUBLISH_TOKEN=<SAME value>
//   Token set kiye BINA deploy kar doge to room sync TURANT band ho jayega
//   (har publish 401 milega) — isliye server env pehle, client env baad me.
import { timingSafeEqual } from 'node:crypto';
import { Apinator } from '@apinator/server';

/**
 * Client-bundle se aaya token header. Vercel node runtime headers lower-case
 * normalize karta hai, par `?.[...]` se dono cases safe rehte hain.
 */
function readHeader(req, name) {
  const headers = req?.headers ?? {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

/**
 * Timing-safe string compare — length mismatch pe `timingSafeEqual` throw karta
 * hai, isliye pehle length check. Token chhota/fixed hai, par constant-time
 * rakhne se brute-force me early-exit timing signal nahi milta.
 */
function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Apinator client LAZILY banao (module scope pe nahi) — Vercel env missing hone
// pe constructor throw karta to handler ka friendly 500 message kabhi reach hi
// nahi hota. Pehle ye module import-time pe env padhta tha.
let realtime = null;
function getRealtime() {
  if (!realtime) {
    realtime = new Apinator({
      appId: process.env.APINATOR_APP_ID,
      key: process.env.APINATOR_KEY,
      secret: process.env.APINATOR_SECRET,
      cluster: process.env.APINATOR_CLUSTER ?? 'eu', // EXPO_PUBLIC_APINATOR_CLUSTER se match rakho
    });
  }
  return realtime;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Env vars missing ho toh clear error do (silent 500 se bachne ke liye).
  // PUBLISH_CLIENT_TOKEN bhi zaroori hai — iske bina endpoint khula reh jayega.
  const missing = ['APINATOR_APP_ID', 'APINATOR_KEY', 'APINATOR_SECRET', 'PUBLISH_CLIENT_TOKEN'].filter(
    k => !process.env[k],
  );
  if (missing.length > 0) {
    return res.status(500).json({
      error: `Apinator env vars set nahi hain (${missing.join(', ')})`,
    });
  }

  // 🔒 Auth — body parse/validate se PEHLE (fail fast, kaam mat karo unauthorized pe)
  if (!tokenMatches(readHeader(req, 'x-publish-token'), process.env.PUBLISH_CLIENT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { channel, event, data } = req.body || {};

  if (!channel || !event || data == null) {
    return res.status(400).json({ error: 'Missing fields: channel, event, data' });
  }

  try {
    await getRealtime().trigger({
      name: event,
      channel: channel,
      // SDK docs: data = JSON string chahiye. Client string bhejta hai; object aaya toh normalize.
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Apinator publish failed:', e);
    return res.status(500).json({ error: 'Publish failed' });
  }
}
