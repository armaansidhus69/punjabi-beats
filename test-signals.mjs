/**
 * Phase 13a signals tests — pure core (core/signals/*), headless.
 * Node >= 23.6 (type stripping; core modules `.ts` suffix import).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SIGNALS_VERSION,
  MAX_LEDGER_SIGNALS,
  buildSignal,
  isSignalName,
  isValidSignal,
  createLedger,
  normalizeLedger,
  pushSignal,
} from './mobile/core/signals/schema.ts';
import {
  MIN_SIGNAL_DURATION_MS,
  SKIP_THRESHOLD_PCT,
  COMPLETE_THRESHOLD_PCT,
  completedPct,
  classifyPlayback,
} from './mobile/core/signals/skip.ts';
import {
  applySignal,
  aggregateSignals,
  tasteSongScore,
  artistStatsFromSignals,
  topSongIds,
} from './mobile/core/signals/stats.ts';

const TS = '2026-10-29T10:00:00.000Z';

function seed(overrides = {}) {
  return { songId: 'song-1', artistNames: ['Diljit Dosanjh'], provider: 'itunes', durationMs: 200_000, ...overrides };
}

test('schema: buildSignal + guard', () => {
  assert.equal(isSignalName('play_start'), true);
  assert.equal(isSignalName('bogus_event'), false);
  const signal = buildSignal('play_start', seed(), TS);
  assert.equal(signal.id.length, 16);
  assert.match(signal.id, /^[0-9a-f]{16}$/);
  assert.equal(isValidSignal(signal), true);
  assert.equal(isValidSignal({ ...signal, name: 'bogus' }), false);
  assert.equal(isValidSignal({ ...signal, id: '' }), false);
  assert.equal(isValidSignal(null), false);
  assert.equal(isValidSignal({ name: 'play_start' }), false);
  assert.equal(SIGNALS_VERSION, 1);
});

test('skip policy: threshold constants + completedPct', () => {
  assert.equal(MIN_SIGNAL_DURATION_MS, 30_000);
  assert.equal(SKIP_THRESHOLD_PCT, 80);
  assert.equal(COMPLETE_THRESHOLD_PCT, 95);
  assert.equal(completedPct(50_000, 200_000), 25);
  assert.equal(completedPct(0, 0), 0);
  assert.equal(completedPct(10_000, 0), 0);
  assert.equal(completedPct(300_000, 200_000), 100); // clamp
  assert.equal(completedPct(-5, 200_000), 0);
});

test('skip policy: <30s floor', () => {
  assert.equal(classifyPlayback({ durationMs: 30_000, positionMs: 0, manual: true }), null);
  assert.equal(classifyPlayback({ durationMs: 29_999, positionMs: 25_000, manual: true }), null);
});

test('skip policy: boundary 79.9 / 80 / neutral / 95', () => {
  // 79.9% manual → skip
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 159_800, manual: true }), 'play_skip');
  // 80% manual → neutral (pct >= 80 → null)
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 160_000, manual: true }), null);
  // >= 95% → complete (manual irrelevant)
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 190_000, manual: true }), 'play_complete');
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 190_000, manual: false }), 'play_complete');
});

test('skip policy: ended wins + !manual non-auto + remote exclude', () => {
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 199_000, ended: true, manual: false }), 'play_complete');
  // auto-advance NOT ended (TrackPlayer self-advance, position mid) & !manual → null
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 50_000, manual: false }), null);
  // remote room-follow — koi playback signal nahi
  assert.equal(classifyPlayback({ durationMs: 200_000, positionMs: 50_000, manual: true, remote: true }), null);
});

test('aggregate: applySignal — remote excluded, net clamp, queries tally', () => {
  let stats = aggregateSignals([]);
  assert.deepEqual(stats, { songs: {}, queries: {} });
  const songId = 'song-1';

  const like = buildSignal('song_like', seed(), TS);
  stats = applySignal(stats, like);
  stats = applySignal(stats, buildSignal('song_like', seed(), TS));
  stats = applySignal(stats, buildSignal('song_unlike', seed(), TS));
  assert.equal(stats.songs[songId].likes, 1); // net clamp

  const playlists = buildSignal('playlist_add', seed(), TS);
  stats = applySignal(stats, playlists);
  stats = applySignal(stats, buildSignal('playlist_remove', seed(), TS));
  assert.equal(stats.songs[songId].playlistAdds, 0); // add minus remove

  stats = applySignal(stats, buildSignal('play_start', seed(), TS));
  assert.equal(stats.songs[songId].plays, 1);

  // remote signal — ledger me hota par stats me NAHI
  const remote = buildSignal('play_start', { ...seed(), remote: true }, TS);
  const after = applySignal(stats, remote);
  assert.equal(after.songs[songId].plays, 1); // unchanged
  assert.deepEqual(after, stats);

  // search_query tally — lowercase key, raw value
  const query = buildSignal('search_query', { songId: null, artistNames: [], provider: null, query: 'Diljit Dosanjh' }, TS);
  const qStats = applySignal(stats, query);
  assert.deepEqual(qStats.queries, { 'diljit dosanjh': 'Diljit Dosanjh' });
  assert.equal(qStats.songs[songId].plays, 1); // static events counts untouched
  // empty query drop
  const blank = buildSignal('search_query', { songId: null, artistNames: [], provider: null, query: '  ' }, TS);
  assert.deepEqual(applySignal(qStats, blank).queries, { 'diljit dosanjh': 'Diljit Dosanjh' });
});

test('weights: tasteSongScore + artistStatsFromSignals + topSongIds', () => {
  const stats = aggregateSignals([
    buildSignal('play_start', seed(), '2026-10-29T10:00:00.000Z'),
    buildSignal('play_complete', seed(), '2026-10-29T10:01:00.000Z'),
    buildSignal('song_like', seed(), '2026-10-29T10:02:00.000Z'),
    buildSignal('play_skip', { songId: 'song-2', artistNames: ['Shubh'], provider: null, durationMs: 100_000 }, TS),
  ]);
  const song1 = stats.songs['song-1'];
  assert.equal(tasteSongScore(song1), 1.0 + 0.5 + 2.0); // completion + play + like

  const artists = artistStatsFromSignals([
    buildSignal('play_start', seed(), TS),
    buildSignal('play_complete', seed(), TS),
    buildSignal('play_skip', { songId: 's2', artistNames: ['Shubh'], provider: null, durationMs: 100_000 }, TS),
  ]);
  assert.deepEqual(artists[0], { name: 'diljit dosanjh', count: 2, score: 1.5 }); // 0.5 + 1.0
  assert.deepEqual(artists[1], { name: 'shubh', count: 0, score: -0.5 });
  // blend TasteArtist shape parity
  assert.equal(typeof artists[0].name, 'string');
  assert.equal(typeof artists[0].count, 'number');

  const top = topSongIds(stats.songs, 10);
  assert.equal(top[0].id, 'song-1'); // higher score first
  assert.ok(top.some(entry => entry.id === 'song-2' && entry.score < 0) === false); // skip-only song filtered
});

test('ledger: pushSignal cap oldest-drop + normalize + corruption guards', () => {
  let ledger = createLedger();
  for (let index = 0; index < MAX_LEDGER_SIGNALS + 5; index++) {
    ledger = pushSignal(
      ledger,
      buildSignal('play_start', { ...seed(), songId: `song-${index}` }, `2026-10-29T10:${String(index % 60).padStart(2, '0')}:00.000Z`),
    );
  }
  assert.equal(ledger.signals.length, MAX_LEDGER_SIGNALS);
  assert.equal(ledger.signals[0].songId, 'song-5'); // oldest 5 dropped
  assert.equal(ledger.signals[ledger.signals.length - 1].songId, 'song-1004'); // newest bachta

  // version mismatch → discard
  assert.deepEqual(normalizeLedger({ version: 99, signals: ledger.signals }).signals, []);
  assert.deepEqual(normalizeLedger(null), createLedger());
  assert.deepEqual(normalizeLedger([1, 2]), createLedger());
  // partial corruption — invalid rows drop, valid bachte
  const ledgerRaw = { version: 1, signals: [buildSignal('play_start', seed(), TS), { name: 'play_start', ts: '', id: 'x', artistNames: 'nope', songId: null, query: null, provider: null, durationMs: 0, positionMs: 0, completedPct: 0, ended: false, manual: false, remote: false }] };
  const normalized = normalizeLedger(ledgerRaw);
  assert.equal(normalized.signals.length, 1);
  assert.equal(normalized.signals[0].songId, 'song-1');
});

test('aggregate: rebuild determinism + lastTs monotonic', () => {
  const signals = [
    buildSignal('play_start', seed(), '2026-10-29T10:00:00.000Z'),
    buildSignal('play_start', seed(), '2026-10-29T09:00:00.000Z'), // older re-entry — lastTs stays newer
  ];
  const stats = aggregateSignals(signals);
  assert.equal(stats.songs['song-1'].plays, 2);
  assert.equal(stats.songs['song-1'].lastTs, '2026-10-29T10:00:00.000Z');
  // deterministic rebuild
  assert.deepEqual(aggregateSignals(signals), stats);
});
