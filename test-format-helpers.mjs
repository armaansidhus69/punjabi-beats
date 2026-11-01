/**
 * Test suite for format & SSRF helpers (extracted from Qwen pure modules).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  albumKey,
  cleanName,
  formatDuration,
  initials,
  isPublicHttpUrl,
  parseAlbumKey,
  progressRatio,
} from './mobile/utils/format.ts';

test('formatDuration & progressRatio calculations', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(-500), '0:00');
  assert.equal(formatDuration(185000), '3:05');
  assert.equal(formatDuration(63123), '1:03');
  assert.equal(progressRatio(50, 100), 0.5);
  assert.equal(progressRatio(0, 0), 0);
  assert.equal(progressRatio(120, 100), 1);
});

test('cleanName: trims, strips control characters & applies fallback', () => {
  assert.equal(cleanName('  Simran Kaur  '), 'Simran Kaur');
  assert.equal(cleanName('\u0000Harminder\u001F Singh'), 'Harminder Singh');
  assert.equal(cleanName('', 'Guest'), 'Guest');
  assert.equal(cleanName(null, 'Anonymous'), 'Anonymous');
});

test('albumKey & parseAlbumKey: encodes and decodes artist/album pairs', () => {
  const key = albumKey('Diljit Dosanjh', 'G.O.A.T.');
  const parsed = parseAlbumKey(key);
  assert.equal(parsed?.artist, 'Diljit Dosanjh');
  assert.equal(parsed?.album, 'G.O.A.T.');

  assert.equal(parseAlbumKey('invalid-key'), null);
  assert.equal(parseAlbumKey(':::'), null);
});

test('initials: extracts 2-letter uppercase initials', () => {
  assert.equal(initials('Diljit Dosanjh'), 'DD');
  assert.equal(initials('Sidhu Moose Wala'), 'SM');
  assert.equal(initials('Karan'), 'K');
  assert.equal(initials(''), 'PB');
});

test('isPublicHttpUrl: blocks SSRF targets, loopbacks & internal subnets', () => {
  // Safe public URLs
  assert.equal(isPublicHttpUrl('https://saavn.sumit.co/track.mp4'), true);
  assert.equal(isPublicHttpUrl('https://api.audius.co/v1/tracks'), true);

  // Blocked SSRF loopbacks
  assert.equal(isPublicHttpUrl('http://localhost:8080/secret'), false);
  assert.equal(isPublicHttpUrl('http://127.0.0.1/admin'), false);
  assert.equal(isPublicHttpUrl('http://0.0.0.0/'), false);

  // Blocked internal & link-local networks
  assert.equal(isPublicHttpUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isPublicHttpUrl('http://192.168.1.1/router'), false);
  assert.equal(isPublicHttpUrl('http://10.0.0.1/internal'), false);
  assert.equal(isPublicHttpUrl('http://172.20.0.1/docker'), false);
  assert.equal(isPublicHttpUrl('https://service.internal/api'), false);
  assert.equal(isPublicHttpUrl('not a url'), false);
});
