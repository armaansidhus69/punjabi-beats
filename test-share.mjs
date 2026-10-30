/**
 * Phase 8a signed-share tests — server core + client pure mirror, no network.
 * Node >= 23.6 TypeScript type stripping required for mobile core import.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SHARE_DAILY_LIMIT,
  SHARE_HOURLY_LIMIT,
  SHARE_TOKEN_MAX_CHARS,
  SHARE_TTL_SEC,
  buildShareUrl,
  normalizeSharePublicBase,
  normalizeShareRequest,
  renderShareErrorHtml,
  renderShareHtml,
  sharePreview,
  shareRateLimitBucket,
  signSharePayload,
  tokenMatches,
  verifyShareToken,
} from './api/_shareCore.js';
import {
  buildBlendShare,
  buildJamShare,
  buildPlaylistShare,
  buildRoomShare,
  buildTrackShare,
  fallbackShareText,
  shareAction,
  validateCreateResponse,
  validateResolvedShare,
} from './mobile/core/share/share.ts';

const NOW = 1_800_000_000;
const SECRET = 's'.repeat(32);

const KIND_FIXTURES = [
  { kind: 'track', data: { title: 'Softly', artist: 'Karan Aujla', cover: 'https://img.example/a.jpg' } },
  { kind: 'playlist', data: { name: 'Gym', totalCount: 2, tracks: [{ title: 'A', artist: 'B' }] } },
  { kind: 'room', data: { code: '123456', name: 'Dost Room' } },
  { kind: 'blend', data: { code: 'ABCDEFGH', name: 'Besties' } },
  { kind: 'jam', data: { code: '23456789', name: 'Friday Jam', roomType: 'party' } },
];

test('server normalize: five strict schemas + private fields drop', () => {
  for (const fixture of KIND_FIXTURES) {
    const payload = normalizeShareRequest(
      { ...fixture, data: { ...fixture.data, userId: 'private', audioUrl: 'https://secret/audio' } },
      NOW,
    );
    assert.ok(payload, fixture.kind);
    assert.equal(payload.v, 1);
    assert.equal(payload.kind, fixture.kind);
    assert.equal(payload.iat, NOW);
    assert.equal(payload.exp, NOW + SHARE_TTL_SEC);
    assert.equal('userId' in payload.data, false);
    assert.equal('audioUrl' in payload.data, false);
  }
  assert.equal(normalizeShareRequest({ kind: 'bogus', data: {} }, NOW), null);
  assert.equal(normalizeShareRequest(null, NOW), null);
});

test('server normalize: string/code/cover/playlist caps', () => {
  const track = normalizeShareRequest({
    kind: 'track',
    data: { title: `  Hi\u0000 ${'x'.repeat(200)}`, artist: ' Artist ', cover: 'http://bad/img' },
  }, NOW);
  assert.equal(track.data.title.length, 120);
  assert.equal(track.data.artist, 'Artist');
  assert.equal(track.data.cover, undefined);

  const playlist = normalizeShareRequest({
    kind: 'playlist',
    data: {
      name: 'Long list',
      totalCount: 99999,
      tracks: Array.from({ length: 15 }, (_, index) => ({ title: `T${index}`, artist: 'A' })),
    },
  }, NOW);
  assert.equal(playlist.data.totalCount, 5000);
  assert.equal(playlist.data.tracks.length, 10);
  assert.equal(normalizeShareRequest({ kind: 'room', data: { code: '12345' } }, NOW), null);
  assert.equal(normalizeShareRequest({ kind: 'blend', data: { code: 'ABCDI234' } }, NOW), null);
  assert.equal(normalizeShareRequest({ kind: 'jam', data: { code: 'ABCDEFGH', roomType: 'evil' } }, NOW)?.data.roomType, undefined);
});

test('HMAC token: deterministic sign + valid verify', () => {
  const payload = normalizeShareRequest(KIND_FIXTURES[0], NOW);
  const first = signSharePayload(payload, SECRET);
  const second = signSharePayload(payload, SECRET);
  assert.equal(first, second);
  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verifyShareToken(first, SECRET, NOW + 1), { ok: true, payload });
});

test('HMAC token: tamper, wrong key, malformed and oversize fail', () => {
  const payload = normalizeShareRequest(KIND_FIXTURES[0], NOW);
  const token = signSharePayload(payload, SECRET);
  const parts = token.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  assert.deepEqual(verifyShareToken(parts.join('.'), SECRET, NOW), { ok: false, error: 'invalid' });
  assert.deepEqual(verifyShareToken(token, 'x'.repeat(32), NOW), { ok: false, error: 'invalid' });
  assert.deepEqual(verifyShareToken('v1.bad', SECRET, NOW), { ok: false, error: 'invalid' });
  assert.deepEqual(verifyShareToken('x'.repeat(SHARE_TOKEN_MAX_CHARS + 1), SECRET, NOW), { ok: false, error: 'invalid' });
});

test('HMAC token: expiry and future-issued payload guards', () => {
  const payload = normalizeShareRequest(KIND_FIXTURES[0], NOW);
  const token = signSharePayload(payload, SECRET);
  assert.deepEqual(verifyShareToken(token, SECRET, payload.exp), { ok: false, error: 'expired' });

  const future = { ...payload, iat: NOW + 301, exp: NOW + 301 + SHARE_TTL_SEC };
  const futureToken = signSharePayload(future, SECRET);
  assert.deepEqual(verifyShareToken(futureToken, SECRET, NOW), { ok: false, error: 'invalid' });
});

test('public base + canonical URL guards', () => {
  assert.equal(normalizeSharePublicBase('https://api.example.com/'), 'https://api.example.com');
  assert.equal(normalizeSharePublicBase('http://api.example.com'), null);
  assert.equal(normalizeSharePublicBase('https://api.example.com/path'), null);
  assert.equal(normalizeSharePublicBase('https://user@api.example.com'), null);
  assert.equal(buildShareUrl('https://api.example.com', 'v1.a.b'), 'https://api.example.com/api/share?token=v1.a.b');
});

test('preview HTML escapes metadata and includes security/app-link surface', () => {
  const payload = normalizeShareRequest({
    kind: 'track',
    data: { title: '<script>alert(1)</script>', artist: 'A & B', cover: 'https://img.example/a.jpg?x=1&y=2' },
  }, NOW);
  const token = signSharePayload(payload, SECRET);
  const url = buildShareUrl('https://api.example.com', token);
  const preview = sharePreview(payload);
  assert.match(preview.title, /<script>/);
  const html = renderShareHtml(payload, token, url);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /punjabi-beats:\/\/share\?token=/);
  assert.match(html, /og:title/);
  assert.match(renderShareErrorHtml('expired'), /expired/);
});

test('rate limiter: 30/hour and Retry-After', () => {
  const state = new Map();
  const start = 2_000_000_000;
  for (let index = 0; index < SHARE_HOURLY_LIMIT; index += 1) {
    assert.equal(shareRateLimitBucket(state, 'device', start + index * 1000).allowed, true);
  }
  const blocked = shareRateLimitBucket(state, 'device', start + SHARE_HOURLY_LIMIT * 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
});

test('rate limiter: 100/day with spread-out hits', () => {
  const state = new Map();
  const start = 3_000_000_000;
  const gap = 13 * 60_000;
  for (let index = 0; index < SHARE_DAILY_LIMIT; index += 1) {
    assert.equal(shareRateLimitBucket(state, 'device', start + index * gap).allowed, true);
  }
  const blocked = shareRateLimitBucket(state, 'device', start + SHARE_DAILY_LIMIT * gap);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
});

test('timing-safe client token compare', () => {
  assert.equal(tokenMatches('same-token', 'same-token'), true);
  assert.equal(tokenMatches('wrong', 'same-token'), false);
  assert.equal(tokenMatches('', 'same-token'), false);
  assert.equal(tokenMatches(null, 'same-token'), false);
});

test('client builders keep private IDs/audio outside signed data + legacy parity', () => {
  const song = {
    id: 'private-id',
    title: 'Softly',
    artist: 'Karan Aujla',
    cover: 'https://img.example/a.jpg',
    preview: 'https://audio.example/secret.m4a',
    duration: 200000,
  };
  const track = buildTrackShare(song);
  assert.ok(track);
  assert.equal(JSON.stringify(track.data).includes('private-id'), false);
  assert.equal(JSON.stringify(track.data).includes('audio.example'), false);
  assert.match(fallbackShareText(track), /audio\.example/); // legacy-only text

  const playlist = buildPlaylistShare({
    id: 'playlist-private',
    name: 'Gym',
    songs: Array.from({ length: 12 }, (_, index) => ({ ...song, id: `id-${index}`, title: `T${index}` })),
    createdAt: 0,
  });
  assert.ok(playlist);
  assert.equal(playlist.data.tracks.length, 10);
  assert.equal(JSON.stringify(playlist.data).includes('playlist-private'), false);
  assert.match(fallbackShareText(playlist), /aur 2 songs/);
  assert.ok(buildRoomShare('123456'));
  assert.ok(buildBlendShare('Besties', 'ABCDEFGH'));
  assert.ok(buildJamShare('Friday', '23456789', 'listening_party'));
});

test('client second guard + typed action allowlist', () => {
  for (const fixture of KIND_FIXTURES) {
    const server = normalizeShareRequest(fixture, NOW);
    const client = validateResolvedShare(server, NOW + 1);
    assert.deepEqual(client, server, fixture.kind); // drift guard
    const action = shareAction(client);
    if (fixture.kind === 'room') assert.deepEqual(action, { type: 'navigate', target: 'room', code: '123456' });
    if (fixture.kind === 'blend') assert.equal(action.target, 'blend');
    if (fixture.kind === 'jam') assert.equal(action.target, 'jam');
  }
  const expired = normalizeShareRequest(KIND_FIXTURES[0], NOW);
  assert.equal(validateResolvedShare(expired, expired.exp), null);
  assert.equal(validateResolvedShare({ v: 1, kind: 'evil', data: {}, iat: NOW, exp: NOW + 1 }, NOW), null);
});

test('create response guard pins HTTPS origin/path/token/expiry', () => {
  const token = 'v1.abc.def';
  const expiresAt = new Date((NOW + 1000) * 1000).toISOString();
  const valid = {
    token,
    url: `https://api.example.com/api/share?token=${token}`,
    expiresAt,
    remaining: 7,
  };
  assert.deepEqual(validateCreateResponse(valid, 'https://api.example.com', NOW * 1000), valid);
  assert.equal(validateCreateResponse({ ...valid, url: `https://evil.example/api/share?token=${token}` }, 'https://api.example.com', NOW * 1000), null);
  assert.equal(validateCreateResponse({ ...valid, url: `https://api.example.com/api/share?token=${token}&next=evil` }, 'https://api.example.com', NOW * 1000), null);
  assert.equal(validateCreateResponse({ ...valid, expiresAt: new Date((NOW - 1) * 1000).toISOString() }, 'https://api.example.com', NOW * 1000), null);
});
