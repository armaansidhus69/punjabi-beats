// api/_shareCore.js — Phase 8a signed-share PURE server helpers.
// No Vercel req/res state: schemas, HMAC, preview HTML, limiter headless-testable.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHARE_TOKEN_VERSION = 'v1';
export const SHARE_TTL_SEC = 30 * 24 * 60 * 60;
export const SHARE_TOKEN_MAX_CHARS = 8192;
export const SHARE_REQUEST_MAX_CHARS = 16 * 1024;
export const SHARE_HOURLY_LIMIT = 30;
export const SHARE_DAILY_LIMIT = 100;
export const SHARE_CLOCK_SKEW_SEC = 5 * 60;

const SHARE_KINDS = new Set(['track', 'playlist', 'room', 'blend', 'jam']);
const INVITE_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const ROOM_CODE = /^\d{6}$/;

function cleanText(value, maxChars, required = true) {
  const clean = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars)
    : '';
  if (required && clean.length === 0) return null;
  return clean;
}

function cleanHttpsUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanInviteCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return INVITE_CODE.test(code) ? code : null;
}

function cleanRoomCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  return ROOM_CODE.test(code) ? code : null;
}

function normalizeTrackData(raw) {
  const title = cleanText(raw?.title, 120);
  const artist = cleanText(raw?.artist, 120);
  if (title === null || artist === null) return null;
  const data = { title, artist };
  const cover = cleanHttpsUrl(raw?.cover);
  if (cover !== null) data.cover = cover;
  return data;
}

function normalizePlaylistData(raw) {
  const name = cleanText(raw?.name, 80);
  if (name === null) return null;
  const countRaw = typeof raw?.totalCount === 'number' && Number.isFinite(raw.totalCount)
    ? Math.round(raw.totalCount)
    : 0;
  const totalCount = Math.min(5000, Math.max(0, countRaw));
  const tracks = [];
  if (Array.isArray(raw?.tracks)) {
    for (const candidate of raw.tracks.slice(0, 10)) {
      const title = cleanText(candidate?.title, 120);
      const artist = cleanText(candidate?.artist, 120);
      if (title !== null && artist !== null) tracks.push({ title, artist });
    }
  }
  return { name, totalCount: Math.max(totalCount, tracks.length), tracks };
}

function optionalName(raw) {
  const name = cleanText(raw, 80, false);
  return name && name.length > 0 ? name : null;
}

function normalizeRoomData(raw) {
  const code = cleanRoomCode(raw?.code);
  if (code === null) return null;
  const data = { code };
  const name = optionalName(raw?.name);
  if (name !== null) data.name = name;
  return data;
}

function normalizeBlendData(raw) {
  const code = cleanInviteCode(raw?.code);
  if (code === null) return null;
  const data = { code };
  const name = optionalName(raw?.name);
  if (name !== null) data.name = name;
  return data;
}

function normalizeJamData(raw) {
  const base = normalizeBlendData(raw);
  if (base === null) return null;
  const data = { ...base };
  if (raw?.roomType === 'jam' || raw?.roomType === 'party') data.roomType = raw.roomType;
  return data;
}

export function normalizeShareData(kind, raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  switch (kind) {
    case 'track':
      return normalizeTrackData(raw);
    case 'playlist':
      return normalizePlaylistData(raw);
    case 'room':
      return normalizeRoomData(raw);
    case 'blend':
      return normalizeBlendData(raw);
    case 'jam':
      return normalizeJamData(raw);
    default:
      return null;
  }
}

export function normalizeShareRequest(body, nowSec) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const kind = typeof body.kind === 'string' && SHARE_KINDS.has(body.kind) ? body.kind : null;
  if (kind === null || !Number.isInteger(nowSec) || nowSec < 0) return null;
  const data = normalizeShareData(kind, body.data);
  if (data === null) return null;
  return {
    v: 1,
    kind,
    data,
    iat: nowSec,
    exp: nowSec + SHARE_TTL_SEC,
  };
}

/** Rebuild canonical payload; null means shape/time invalid. */
export function validateSharePayload(raw, nowSec, options = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== 1 || typeof raw.kind !== 'string' || !SHARE_KINDS.has(raw.kind)) return null;
  if (!Number.isInteger(raw.iat) || !Number.isInteger(raw.exp)) return null;
  if (raw.iat < 0 || raw.iat > nowSec + SHARE_CLOCK_SKEW_SEC) return null;
  if (raw.exp <= raw.iat || raw.exp - raw.iat > SHARE_TTL_SEC) return null;
  if (options.allowExpired !== true && raw.exp <= nowSec) return null;
  const data = normalizeShareData(raw.kind, raw.data);
  if (data === null) return null;
  return { v: 1, kind: raw.kind, data, iat: raw.iat, exp: raw.exp };
}

function signatureBytes(version, encodedPayload, secret) {
  return createHmac('sha256', secret).update(`${version}.${encodedPayload}`).digest();
}

export function signSharePayload(payload, secret) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('share secret missing');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signatureBytes(SHARE_TOKEN_VERSION, encodedPayload, secret).toString('base64url');
  return `${SHARE_TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

export function verifyShareToken(token, secret, nowSec) {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > SHARE_TOKEN_MAX_CHARS ||
    typeof secret !== 'string' ||
    secret.length === 0
  ) {
    return { ok: false, error: 'invalid' };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SHARE_TOKEN_VERSION) {
    return { ok: false, error: 'invalid' };
  }
  const [, encodedPayload, encodedSignature] = parts;
  try {
    const expected = signatureBytes(SHARE_TOKEN_VERSION, encodedPayload, secret);
    const provided = Buffer.from(encodedSignature, 'base64url');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { ok: false, error: 'invalid' };
    }
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const payload = validateSharePayload(parsed, nowSec, { allowExpired: true });
    if (payload === null) return { ok: false, error: 'invalid' };
    if (payload.exp <= nowSec) return { ok: false, error: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function tokenMatches(provided, expected) {
  if (
    typeof provided !== 'string' ||
    provided.length === 0 ||
    typeof expected !== 'string' ||
    expected.length === 0
  ) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeSharePublicBase(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildShareUrl(publicBase, token) {
  return `${publicBase}/api/share?token=${encodeURIComponent(token)}`;
}

export function shareRateLimitBucket(state, key, nowMs) {
  const previous = state.get(key);
  const dayAgo = nowMs - 24 * 60 * 60_000;
  const hourAgo = nowMs - 60 * 60_000;
  const hits = Array.isArray(previous?.hits) ? previous.hits.filter(ts => ts > dayAgo) : [];
  const hourlyHits = hits.filter(ts => ts > hourAgo);
  let retryAfterSec = 0;
  if (hourlyHits.length >= SHARE_HOURLY_LIMIT) {
    retryAfterSec = Math.max(
      retryAfterSec,
      Math.ceil((hourlyHits[0] + 60 * 60_000 - nowMs) / 1000),
    );
  }
  if (hits.length >= SHARE_DAILY_LIMIT) {
    retryAfterSec = Math.max(
      retryAfterSec,
      Math.ceil((hits[0] + 24 * 60 * 60_000 - nowMs) / 1000),
    );
  }
  const allowed = retryAfterSec <= 0;
  if (allowed) hits.push(nowMs);
  state.set(key, { hits });
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, retryAfterSec),
    remaining: allowed
      ? Math.max(0, Math.min(SHARE_HOURLY_LIMIT - hourlyHits.length - 1, SHARE_DAILY_LIMIT - hits.length))
      : 0,
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sharePreview(payload) {
  switch (payload.kind) {
    case 'track':
      return {
        title: `${payload.data.title} — ${payload.data.artist}`,
        description: 'Punjabi Beats pe ye track suno.',
        image: payload.data.cover ?? null,
        label: 'Shared track',
      };
    case 'playlist':
      return {
        title: payload.data.name,
        description: `${payload.data.totalCount} songs wali Punjabi Beats playlist.`,
        image: null,
        label: 'Shared playlist',
      };
    case 'room':
      return {
        title: payload.data.name ?? 'Punjabi Beats Group Room',
        description: `Room code ${payload.data.code} — saath music suno.`,
        image: null,
        label: 'Group room invite',
      };
    case 'blend':
      return {
        title: payload.data.name ?? 'Punjabi Beats Blend',
        description: 'Dost ke saath shared taste playlist banao.',
        image: null,
        label: 'Blend invite',
      };
    case 'jam':
      return {
        title: payload.data.name ?? 'Punjabi Beats Jam',
        description: payload.data.roomType === 'party'
          ? 'Listening Party join karo.'
          : 'Live Jam room join karo.',
        image: null,
        label: 'Jam invite',
      };
    default:
      return { title: 'Punjabi Beats', description: 'Music saath suno.', image: null, label: 'Shared link' };
  }
}

export function renderShareHtml(payload, token, publicUrl) {
  const preview = sharePreview(payload);
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const label = escapeHtml(preview.label);
  const canonical = escapeHtml(publicUrl);
  const appUrl = escapeHtml(`punjabi-beats://share?token=${encodeURIComponent(token)}`);
  const imageMeta = preview.image
    ? `<meta property="og:image" content="${escapeHtml(preview.image)}"><meta name="twitter:card" content="summary_large_image">`
    : '<meta name="twitter:card" content="summary">';
  const expiry = new Date(payload.exp * 1000).toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<title>${title} | Punjabi Beats</title>
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Punjabi Beats">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">${imageMeta}
<meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">
<style>body{margin:0;background:#0a0a0f;color:#f7f7fb;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:560px;margin:24px;padding:32px;border:1px solid #2b2b36;border-radius:20px;background:#15151d}.tag{color:#b59cff;font-size:13px;text-transform:uppercase;letter-spacing:.08em}h1{font-size:28px;margin:10px 0}p{color:#b7b7c4;line-height:1.5}.button{display:inline-block;margin-top:18px;padding:13px 20px;border-radius:999px;background:#9b7cff;color:#0a0a0f;text-decoration:none;font-weight:700}.small{font-size:12px;margin-top:22px}</style>
</head><body><main class="card"><div class="tag">${label}</div><h1>${title}</h1><p>${description}</p><a class="button" href="${appUrl}">Open Punjabi Beats</a><p class="small">Link expires ${expiry}.</p></main></body></html>`;
}

export function renderShareErrorHtml(status) {
  const message = status === 'expired' ? 'This Punjabi Beats link has expired.' : 'This Punjabi Beats link is invalid.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Punjabi Beats link</title></head><body><h1>${message}</h1></body></html>`;
}
