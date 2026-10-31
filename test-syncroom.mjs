/**
 * test-syncroom.mjs — SyncRoom Core Sync Engine & Fair-Turns Queue tests.
 * Headless & deterministic (fixtures, zero network).
 * Run: node test-syncroom.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getIdealPositionMs,
  shouldResync,
  createAnchor,
  buildFairOrder,
  DRIFT_THRESHOLD_MS,
  RESYNC_COOLDOWN_MS,
} from './mobile/core/room/syncEngine.ts';

test('syncEngine constants — spec pins (drift threshold 400ms, cooldown 2500ms)', () => {
  assert.equal(DRIFT_THRESHOLD_MS, 400);
  assert.equal(RESYNC_COOLDOWN_MS, 2500);
});

test('getIdealPositionMs — paused returns base; playing computes elapsed; null track returns base', () => {
  const T0 = 100000;

  // Paused: no elapsed added
  const pausedAnchor = {
    trackId: 'track-1',
    status: 'paused',
    anchorPositionMs: 5000,
    anchorServerTime: T0,
    stateVersion: 1,
  };
  assert.equal(getIdealPositionMs(pausedAnchor, T0 + 3000), 5000);

  // Playing: adds elapsed
  const playingAnchor = {
    trackId: 'track-1',
    status: 'playing',
    anchorPositionMs: 5000,
    anchorServerTime: T0,
    stateVersion: 2,
  };
  assert.equal(getIdealPositionMs(playingAnchor, T0 + 3000), 8000);

  // Null track: returns base
  const nullTrackAnchor = {
    trackId: null,
    status: 'playing',
    anchorPositionMs: 0,
    anchorServerTime: T0,
    stateVersion: 3,
  };
  assert.equal(getIdealPositionMs(nullTrackAnchor, T0 + 3000), 0);
});

test('shouldResync — boundary checks & cooldown guard', () => {
  const now = 200000;

  // Within threshold (≤ 400ms): false
  assert.equal(shouldResync(5000, 5200, undefined, now), false);
  assert.equal(shouldResync(5000, 4700, undefined, now), false);

  // Exceeds threshold (> 400ms): true
  assert.equal(shouldResync(5000, 5500, undefined, now), true);
  assert.equal(shouldResync(5000, 4200, undefined, now), true);

  // Within cooldown (lastResyncAt was 1500ms ago < 2500ms): false despite drift
  assert.equal(shouldResync(5000, 7000, now - 1500, now), false);

  // Cooldown expired (lastResyncAt was 3000ms ago > 2500ms): true
  assert.equal(shouldResync(5000, 7000, now - 3000, now), true);
});

test('createAnchor — version monotonicity and timestamping', () => {
  const anchor = createAnchor('song-42', 12345.67, 'playing', 7);
  assert.equal(anchor.trackId, 'song-42');
  assert.equal(anchor.status, 'playing');
  assert.equal(anchor.anchorPositionMs, 12345);
  assert.equal(anchor.stateVersion, 8);
  assert.ok(anchor.anchorServerTime > 0);

  // Negative position clamped to 0
  const negAnchor = createAnchor('song-42', -50, 'paused', 1);
  assert.equal(negAnchor.anchorPositionMs, 0);
});

test('buildFairOrder — round-robin fair turns queuing', () => {
  // Empty queue
  assert.deepEqual(buildFairOrder([]), []);

  // Single user items: sorted by createdAt
  const singleUser = [
    { id: '1', addedBy: 'user-A', createdAt: '2026-10-31T10:05:00Z' },
    { id: '2', addedBy: 'user-A', createdAt: '2026-10-31T10:01:00Z' },
  ];
  const sortedSingle = buildFairOrder(singleUser);
  assert.equal(sortedSingle[0].id, '2');
  assert.equal(sortedSingle[1].id, '1');

  // Multi-user items: A adds 3 songs, B adds 1, C adds 2
  const multiUser = [
    { id: 'A1', addedBy: 'A', createdAt: '2026-10-31T10:01:00Z' },
    { id: 'A2', addedBy: 'A', createdAt: '2026-10-31T10:02:00Z' },
    { id: 'A3', addedBy: 'A', createdAt: '2026-10-31T10:03:00Z' },
    { id: 'B1', addedBy: 'B', createdAt: '2026-10-31T10:00:30Z' },
    { id: 'C1', addedBy: 'C', createdAt: '2026-10-31T10:01:30Z' },
    { id: 'C2', addedBy: 'C', createdAt: '2026-10-31T10:02:30Z' },
  ];

  const fair = buildFairOrder(multiUser);
  const ids = fair.map((i) => i.id);

  // Round 1: one from each user (A, B, C)
  // Round 2: one from remaining users (A, C)
  // Round 3: one from remaining user (A)
  assert.deepEqual(ids, ['A1', 'B1', 'C1', 'A2', 'C2', 'A3']);
});

