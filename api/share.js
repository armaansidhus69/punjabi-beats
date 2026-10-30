// api/share.js — Phase 8a stateless signed share creation + public preview.
// POST signs strict public metadata; GET verifies and serves JSON or safe OG HTML.

import {
  SHARE_REQUEST_MAX_CHARS,
  SHARE_TOKEN_MAX_CHARS,
  buildShareUrl,
  normalizeSharePublicBase,
  normalizeShareRequest,
  renderShareErrorHtml,
  renderShareHtml,
  shareRateLimitBucket,
  signSharePayload,
  tokenMatches,
  verifyShareToken,
} from './_shareCore.js';

const rateState = new Map();

function readHeader(req, name) {
  const headers = req?.headers ?? {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-publish-token');
}

function config() {
  const secret = process.env.SHARE_SIGNING_SECRET ?? '';
  const publicBase = normalizeSharePublicBase(process.env.SHARE_PUBLIC_BASE_URL ?? '');
  const clientToken = process.env.PUBLISH_CLIENT_TOKEN ?? '';
  return secret.length >= 32 && publicBase !== null && clientToken.length > 0
    ? { secret, publicBase, clientToken }
    : null;
}

function parseBody(req) {
  try {
    const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (serialized.length > SHARE_REQUEST_MAX_CHARS) return null;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function requestIp(req) {
  const forwarded = readHeader(req, 'x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 80);
  }
  return typeof req?.socket?.remoteAddress === 'string'
    ? req.socket.remoteAddress.slice(0, 80)
    : 'unknown';
}

function sendHtml(res, status, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  return res.status(status).send(html);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const env = config();
  if (env === null) {
    return res.status(500).json({ error: 'no_key' });
  }
  const nowSec = Math.floor(Date.now() / 1000);

  if (req.method === 'POST') {
    if (!tokenMatches(readHeader(req, 'x-publish-token'), env.clientToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const body = parseBody(req);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
    if (body === null || deviceId.length === 0 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const bucket = shareRateLimitBucket(
      rateState,
      `${requestIp(req)}|${deviceId}`,
      Date.now(),
    );
    if (!bucket.allowed) {
      res.setHeader('Retry-After', String(bucket.retryAfterSec));
      return res.status(429).json({
        error: 'rate_limited',
        retryAfterSec: bucket.retryAfterSec,
      });
    }
    const payload = normalizeShareRequest(body, nowSec);
    if (payload === null) return res.status(400).json({ error: 'bad_request' });
    const token = signSharePayload(payload, env.secret);
    return res.status(200).json({
      token,
      url: buildShareUrl(env.publicBase, token),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      remaining: bucket.remaining,
    });
  }

  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  const format = typeof req.query?.format === 'string' ? req.query.format : '';
  if (token.length === 0 || token.length > SHARE_TOKEN_MAX_CHARS) {
    if (format === 'json') return res.status(400).json({ error: 'invalid' });
    return sendHtml(res, 400, renderShareErrorHtml('invalid'));
  }
  const verified = verifyShareToken(token, env.secret, nowSec);
  if (!verified.ok) {
    const status = verified.error === 'expired' ? 410 : 400;
    if (format === 'json') return res.status(status).json({ error: verified.error });
    return sendHtml(res, status, renderShareErrorHtml(verified.error));
  }
  if (format === 'json') {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ payload: verified.payload });
  }
  const publicUrl = buildShareUrl(env.publicBase, token);
  const maxAge = Math.max(0, Math.min(86_400, verified.payload.exp - nowSec));
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=60`);
  return sendHtml(res, 200, renderShareHtml(verified.payload, token, publicUrl));
}
