/**
 * test-blend.mjs — Phase 10 Blend ka headless test suite.
 * Pure logic (snapshot, scoring, selection, labels, Song adapter) +
 * mobile↔Edge-Function parity guard. Koi network/native dep nahi.
 * NOTE: plain JS (Node .mjs pe TS-strip nahi hota) — .ts imports fine.
 *
 * Run: node test-blend.mjs (ya root pe npm test)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { fnv1a64Hex, buildTasteSnapshot, SNAPSHOT_VERSION } from './mobile/core/blend/snapshot.ts';
import {
  BLEND_ALGORITHM_VERSION,
  artistSet,
  jaccardPercent,
  scorePooledTracks,
  selectBlendItems,
  pooledTrackToBlendItem,
} from './mobile/core/blend/scoring.ts';
import { blendItemToSong } from './mobile/core/blend/song.ts';
import { blendComputeStatusShortLabel, blendComputeStatusDetailLabel } from './mobile/utils/blendLabels.ts';

/* ------------------------------ helpers ------------------------------ */

function song(id, overrides = {}) {
  return {
    id,
    title: `Song ${id}`,
    artist: overrides.artist ?? 'Test Artist',
    cover: `https://art.invalid/${id}.jpg`,
    preview: `https://audio.invalid/${id}.m4a`,
    duration: 180_000,
    source: overrides.source ?? 'jiosaavn',
    previewOnly: overrides.previewOnly ?? false,
  };
}

function snapshotSong(id, overrides = {}) {
  return {
    id,
    title: `Song ${id}`,
    artistNames: overrides.artistNames ?? ['test artist'],
    artworkUrl: `https://art.invalid/${id}.jpg`,
    provider: overrides.provider ?? 'jiosaavn',
    durationSec: 180,
    playableFull: overrides.playableFull ?? true,
    count: overrides.count ?? 1,
  };
}

function snapshot(songs, artists = []) {
  const ids = [...new Set(songs.map(entry => entry.id))].sort((a, b) => a.localeCompare(b));
  return { version: 1, libraryHash: fnv1a64Hex(ids), songs, artists };
}

function scoreDescPooled(ids, contributors = {}) {
  return ids.map((id, index) => ({
    trackId: id,
    userId: contributors[id] ?? 'u1',
    song: snapshotSong(id),
    share: 1,
    pref: 1,
    score: 1 / (index + 1), // deterministic desc helper
  }));
}

/* ------------------------------ FNV-1a 64 ------------------------------ */

test('fnv1a64Hex — official FNV-1a 64 test vectors', () => {
  assert.equal(fnv1a64Hex([]), 'cbf29ce484222325'); // empty = offset basis
  assert.equal(fnv1a64Hex(['a']), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64Hex(['foobar']), '85944171f73967e8');
});

test('fnv1a64Hex — deterministic + content-sensitive', () => {
  assert.equal(
    fnv1a64Hex(['diljit dosanjh', 'diljit dosanjh']),
    fnv1a64Hex(['diljit dosanjh', 'diljit dosanjh']),
  );
  assert.notEqual(fnv1a64Hex(['diljit dosanjh']), fnv1a64Hex(['sidhu moose wala']));
});

/* ------------------------------ snapshot ------------------------------ */

test('buildTasteSnapshot — like weight 2, playlist weight 1, count order', () => {
  const playlists = [
    { id: 'p1', name: 'P1', createdAt: 1, songs: [song('s1'), song('s2'), song('s3')] },
    { id: 'p2', name: 'P2', createdAt: 2, songs: [song('s2')] },
  ];
  const liked = [song('s1')];

  const snap = buildTasteSnapshot(liked, playlists);
  assert.equal(snap.version, SNAPSHOT_VERSION);

  const counts = Object.fromEntries(snap.songs.map(entry => [entry.id, entry.count]));
  assert.equal(counts.s1, 3); // like(2) + playlist(1)
  assert.equal(counts.s2, 2); // 2 playlists
  assert.equal(counts.s3, 1);

  assert.deepEqual(snap.songs.map(entry => entry.id), ['s1', 's2', 's3']);
});

test('buildTasteSnapshot deterministic — same inputs, same hash + order', () => {
  const playlists = [{ id: 'p', name: 'P', createdAt: 1, songs: [song('b'), song('a')] }];
  assert.deepEqual(buildTasteSnapshot([song('c')], playlists), buildTasteSnapshot([song('c')], playlists));

  const snap = buildTasteSnapshot([], [{ id: 'p', name: 'P', createdAt: 1, songs: [song('a')] }]);
  assert.equal(snap.libraryHash.length, 16);
});

test('buildTasteSnapshot — 40-song cap + artist aggregation/dedupe', () => {
  const many = Array.from({ length: 45 }, (_, index) => song(`trk-${String(index + 1).padStart(2, '0')}`));
  assert.equal(buildTasteSnapshot(many, []).songs.length, 40);

  const dupArtists = [
    song('s1', { artist: 'Diljit Dosanjh, Test Artist' }),
    song('s2', { artist: 'Diljit Dosanjh, diljit dosanjh' }),
  ];
  const snapArtists = buildTasteSnapshot([], [{ id: 'p', name: 'P', createdAt: 1, songs: dupArtists }]);
  const diljit = snapArtists.artists.find(entry => entry.name === 'diljit dosanjh');
  assert.equal(diljit?.count, 2); // per-song dedupe, cross-song sum
});

test('buildTasteSnapshot — meher empty inputs safe', () => {
  const snap = buildTasteSnapshot([], []);
  assert.equal(snap.songs.length, 0);
  assert.equal(snap.artists.length, 0);
});

/* ------------------------------ scoring ------------------------------ */

test('artistSet + jaccardPercent', () => {
  assert.deepEqual(
    [...artistSet([' Diljit ', 'SARTAJ', 'sartaj'])].sort(),
    ['diljit', 'sartaj'],
  );
  assert.equal(jaccardPercent(['diljit dosanjh'], ['diljit dosanjh']), 100);
  assert.equal(jaccardPercent(['diljit dosanjh', 'sidhu moose wala'], ['diljit dosanjh']), 50);
  assert.equal(jaccardPercent(['a'], ['b']), 0);
  assert.equal(jaccardPercent([], []), 0);
});

test('scorePooledTracks — spec v1 formula (share 0.6 + pref 0.4)', () => {
  const members = [
    { userId: 'u1', snapshot: snapshot([snapshotSong('s1', { count: 2 }), snapshotSong('s2', { count: 1 })]) },
    { userId: 'u2', snapshot: snapshot([snapshotSong('s1', { count: 1 }), snapshotSong('s3', { count: 1 })]) },
  ];

  const pooled = scorePooledTracks(members);
  const s1 = pooled.find(entry => entry.trackId === 's1');
  const s2 = pooled.find(entry => entry.trackId === 's2');
  const s3 = pooled.find(entry => entry.trackId === 's3');

  // s1: dono members → share 1.0; pref (2/2 + 1/1)/2 = 1 → score 1
  assert.ok(Math.abs(s1.score - 1) < 1e-9);
  // s2: u1 only (max=2, count=1 ne nahi included?) → u1 max=2, count=1 → pref 0.5?
  //    careful: s2 count 1, u1 max 2 → pref = 1/2 = 0.5 → score 0.6*0.5 + 0.4*0.5 = 0.5
  assert.ok(Math.abs(s2.score - 0.5) < 1e-9);
  // s3: u2 only, max=1, count=1 → share 0.5, pref 1 → 0.6*0.5 + 0.4 = 0.7
  assert.ok(Math.abs(s3.score - 0.7) < 1e-9);

  // order: score desc (1, 0.7, 0.5)
  assert.deepEqual(pooled.map(entry => entry.trackId), ['s1', 's3', 's2']);

  // attribution: first-wins join order (u1 pehle)
  assert.equal(s1.userId, 'u1');
});

/* ------------------------------ selection ------------------------------ */

test('selectBlendItems — 30/2 → 15+15 quota + exclusions + score desc', () => {
  const A = Array.from({ length: 20 }, (_, index) => `a-${String(index).padStart(2, '0')}`);
  const B = Array.from({ length: 20 }, (_, index) => `b-${String(index).padStart(2, '0')}`);
  const pooled = [
    ...scoreDescPooled(A, Object.fromEntries(A.map(id => [id, 'u1']))),
    ...scoreDescPooled(B, Object.fromEntries(B.map(id => [id, 'u2']))),
  ];
  const selection = selectBlendItems(pooled, new Set(['a-00', 'b-00']), ['u1', 'u2'], 30);

  assert.equal(selection.items.length, 30);
  assert.equal(selection.items.filter(entry => entry.userId === 'u1').length, 15);
  assert.equal(selection.items.filter(entry => entry.userId === 'u2').length, 15);
  assert.ok(!selection.items.some(entry => entry.trackId === 'a-00'));
  assert.ok(!selection.items.some(entry => entry.trackId === 'b-00'));

  const scores = selection.items.map(entry => entry.score);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  assert.equal(new Set(selection.items.map(entry => entry.trackId)).size, 30);
});

test('selectBlendItems — thin member quota skips, fill karta hai', () => {
  const pooled = scoreDescPooled(['t1', 't2', 't3'], { t1: 'u1', t2: 'u1', t3: 'u1' });
  const selection = selectBlendItems(pooled, new Set(), ['u1', 'u2'], 3);
  assert.equal(selection.items.length, 3);
  assert.ok(selection.items.every(entry => entry.userId === 'u1'));
});

test('pooledTrackToBlendItem — denormalized item mapping', () => {
  const pooled = scorePooledTracks([
    { userId: 'u1', snapshot: snapshot([snapshotSong('s1', { count: 3, artistNames: ['a', 'b'] })]) },
  ]);
  const item = pooledTrackToBlendItem(pooled[0], 'blend-1', 7);
  assert.equal(item.blendId, 'blend-1');
  assert.equal(item.position, 7);
  assert.equal(item.trackId, 's1');
  assert.equal(item.track.playableFull, true);
  assert.equal(item.track.artistNames.length, 2);
});

/* ------------------------------ song adapter + labels ------------------------------ */

test('blendItemToSong — player pipeline ke liye Song', () => {
  const itemSong = blendItemToSong({
    id: 'it-1',
    blendId: 'b1',
    trackId: 'saavn-42',
    sourceUserId: 'u1',
    score: 1,
    position: 0,
    origin: 'generated',
    track: {
      title: 'Born to Shine',
      artistNames: ['Diljit Dosanjh'],
      artworkUrl: 'https://art.invalid/42.jpg',
      provider: 'jiosaavn',
      durationSec: 191,
      playableFull: true,
    },
  });
  assert.equal(itemSong.id, 'saavn-42');
  assert.equal(itemSong.artist, 'Diljit Dosanjh');
  assert.equal(itemSong.duration, 191_000);
  assert.equal(itemSong.previewOnly, false);
  assert.equal(itemSong.preview, ''); // playerStore resolve khud karta hai
});

test('blend labels — compute status mapping', () => {
  assert.equal(blendComputeStatusShortLabel('ready'), 'updated hai');
  assert.equal(blendComputeStatusShortLabel('offline'), undefined);
  assert.equal(blendComputeStatusShortLabel('error'), 'compute fail hua');
  assert.equal(blendComputeStatusShortLabel('pending'), 'taste sync wait…');
  assert.ok(blendComputeStatusDetailLabel('computing').length > 0);
});

/* ------------------------------ parity guard ------------------------------ */

test('scoring copy — drift guard (mobile ↔ edge function identical)', () => {
  const normalize = path => {
    const txt = readFileSync(path, 'utf8');
    // strip block comments, phir per-line cleanup
    const noBlock = txt.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'))
      .join('\n')
      // header ka description differs — scoring body copies same rehne chahiye
      .replace(/^export const BLEND_TARGET_ITEMS.*$/m, 'BLEND_TARGET_ITEMS')
      ;
  };

  const mobile = normalize('./mobile/core/blend/scoring.ts');
  const edge = normalize('./supabase/functions/_shared/blend-scoring.ts');
  const diffIndex = (() => {
    const mLines = mobile.split('\n');
    const eLines = edge.split('\n');
    for (let i = 0; i < Math.max(mLines.length, eLines.length); i++) {
      if (mLines[i] !== eLines[i]) return { i, m: mLines[i], e: eLines[i] };
    }
    return null;
  })();
  assert.ok(diffIndex === null, `scoring drift at line ${diffIndex?.i}: ${JSON.stringify(diffIndex)}`);
});

test('algorithm version pin (spec-approved v1)', () => {
  assert.equal(BLEND_ALGORITHM_VERSION, 'v1');
});
