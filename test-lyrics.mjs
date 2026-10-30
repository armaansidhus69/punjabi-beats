/**
 * Phase 7a lyrics tests — pure client core only (headless).
 * Node >= 23.6 TypeScript type stripping required.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LYRICS_CACHE_CAP,
  cacheFromEnvelope,
  cacheGet,
  cachePut,
  cacheToEnvelope,
  isSyncedLines,
  lineAt,
  parseLrc,
  plainToLines,
} from './mobile/core/lyrics/lyrics.ts';

function lyricsData(index, fetchedAt = index) {
  return {
    synced: true,
    lines: [{ text: `line-${index}`, timeMs: index * 1000 }],
    plain: `line-${index}`,
    artist: 'Artist',
    title: `Song ${index}`,
    fetchedAt,
  };
}

test('parseLrc: standard timestamps + fraction scaling', () => {
  assert.deepEqual(parseLrc('[00:01.1] one\n[00:02.12] two\n[01:03.123] three'), [
    { text: 'one', timeMs: 1100 },
    { text: 'two', timeMs: 2120 },
    { text: 'three', timeMs: 63_123 },
  ]);
});

test('parseLrc: multi-timestamp, metadata/junk drop, sort + positive offset', () => {
  const raw = [
    '[ar:Artist]',
    '[offset:+500]',
    '[00:05.00] Five',
    '[00:02.50][00:04.000] Repeat',
    'plain junk without timestamp',
    '[00:03.1] Three',
    '[00:99.00] invalid seconds',
    '[00:06.00]',
  ].join('\n');

  assert.deepEqual(parseLrc(raw), [
    { text: 'Repeat', timeMs: 2000 },
    { text: 'Three', timeMs: 2600 },
    { text: 'Repeat', timeMs: 3500 },
    { text: 'Five', timeMs: 4500 },
  ]);
});

test('parseLrc: negative offset delays lines and clamps positive offset at zero', () => {
  assert.deepEqual(parseLrc('[offset:-500]\n[00:01.00] later'), [
    { text: 'later', timeMs: 1500 },
  ]);
  assert.deepEqual(parseLrc('[offset:+2000]\n[00:01.00] start'), [
    { text: 'start', timeMs: 0 },
  ]);
  assert.deepEqual(parseLrc(''), []);
});

test('lineAt: before/exact/between/after boundaries', () => {
  const lines = [
    { text: 'one', timeMs: 1000 },
    { text: 'two', timeMs: 2500 },
    { text: 'three', timeMs: 5000 },
  ];
  assert.equal(lineAt(lines, 999), -1);
  assert.equal(lineAt(lines, 1000), 0);
  assert.equal(lineAt(lines, 4000), 1);
  assert.equal(lineAt(lines, 9999), 2);
  assert.equal(lineAt([], 1000), -1);
  assert.equal(lineAt(lines, Number.NaN), -1);
});

test('plainToLines: blank rows drop and timing stays unsynced', () => {
  const lines = plainToLines(' first \n\n second \r\n third ', 30_000);
  assert.deepEqual(lines, [
    { text: 'first', timeMs: 0 },
    { text: 'second', timeMs: 0 },
    { text: 'third', timeMs: 0 },
  ]);
  assert.equal(isSyncedLines(lines), true); // shape valid; caller owns synced flag
  assert.deepEqual(plainToLines('  \n ', 30_000), []);
});

test('cache envelope: version + entry shape guards', () => {
  const valid = lyricsData(1, 100);
  const restored = cacheFromEnvelope({ version: 1, lyrics: { song: valid } });
  assert.deepEqual(cacheGet(restored, 'song'), valid);
  assert.equal(cacheGet(restored, 'missing'), null);
  assert.deepEqual(cacheToEnvelope(restored), { version: 1, lyrics: { song: valid } });

  assert.deepEqual(cacheFromEnvelope({ version: 2, lyrics: { song: valid } }), {});
  assert.deepEqual(cacheFromEnvelope(null), {});
  assert.deepEqual(
    cacheFromEnvelope({
      version: 1,
      lyrics: {
        bad: { ...valid, lines: [{ text: '', timeMs: -1 }] },
      },
    }),
    {},
  );
});

test('cachePut: cap 50 oldest-drop + duplicate refresh', () => {
  let cache = {};
  for (let index = 0; index <= LYRICS_CACHE_CAP; index += 1) {
    cache = cachePut(cache, `song-${index}`, lyricsData(index, index));
  }
  assert.equal(Object.keys(cache).length, LYRICS_CACHE_CAP);
  assert.equal(cacheGet(cache, 'song-0'), null);
  assert.ok(cacheGet(cache, `song-${LYRICS_CACHE_CAP}`));

  const refreshed = lyricsData(1, 9999);
  cache = cachePut(cache, 'song-1', refreshed);
  assert.deepEqual(cacheGet(cache, 'song-1'), refreshed);
  assert.equal(Object.keys(cache).length, LYRICS_CACHE_CAP);
  assert.equal(cachePut(cache, '', lyricsData(99)), cache);
});
