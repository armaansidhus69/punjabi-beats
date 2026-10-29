/**
 * test-jam.mjs — Phase 11 Jam + Listening Party ka headless test suite.
 * Pure logic (timeModel, versioning, permissions matrix, Song adapter,
 * labels) + mobile↔Edge-Function permissions parity guard.
 * Koi network/native dep nahi — Node ka TS type-stripping .ts imports pe.
 * NOTE: Node >= 23.6 chahiye (type stripping stable) — test-logic.mjs jaisa.
 *
 * Run: node test-jam.mjs (ya root pe npm test)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  SYNC_EPSILON_MS,
  SYNC_SMOOTH_MAX_MS,
  SYNC_DRIFT_MS_PER_MIN,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_STALE_MS,
  captureClockSkew,
  serverNow,
  predictPositionMs,
  evaluateSync,
  smoothCorrectionDurationMs,
  isPresenceStale,
} from './mobile/core/room/timeModel.ts';
import { shouldApply, stampFromRow } from './mobile/core/room/versioning.ts';
import { can, canModerateMember } from './mobile/core/room/permissions.ts';
import { jamTrackToSong, jamQueueItemToSong, playbackToSong } from './mobile/core/room/song.ts';
import {
  roomTypeLabel,
  roomTypeSubtitleLabel,
  roomStatusLabel,
  roomRoleLabel,
} from './mobile/utils/jamLabels.ts';

/* ------------------------------ helpers ------------------------------ */

const T0 = Date.parse('2026-10-29T12:00:00.000Z');

function playbackState(overrides = {}) {
  return {
    roomId: 'room-1',
    trackId: 'track-1',
    track: {
      title: 'Chaan De',
      artistNames: ['Test Singer'],
      artworkUrl: 'https://art.invalid/track-1.jpg',
      provider: 'jiosaavn',
      durationSec: 200,
      playableFull: true,
    },
    positionMs: 10_000,
    isPlaying: true,
    queueVersion: 0,
    stateVersion: 1,
    updatedBy: 'user-1',
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

/* ------------------------------ timeModel ------------------------------ */

test('constants — spec pins (epsilon 250ms, smooth ≤2s, drift rate, heartbeat, presence)', () => {
  assert.equal(SYNC_EPSILON_MS, 250);
  assert.equal(SYNC_SMOOTH_MAX_MS, 2000);
  assert.equal(SYNC_DRIFT_MS_PER_MIN, 500);
  assert.equal(HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(PRESENCE_STALE_MS, 90_000);
});

test('captureClockSkew — server ahead/behind; garbage ISO → 0', () => {
  const deviceNow = T0;
  assert.equal(captureClockSkew(new Date(T0 + 5000).toISOString(), deviceNow), 5000);
  assert.equal(captureClockSkew(new Date(T0 - 3000).toISOString(), deviceNow), -3000);
  assert.equal(captureClockSkew('not-a-date', deviceNow), 0);
});

test('serverNow — device + skew', () => {
  assert.equal(serverNow(1000, 500), 1500);
  assert.equal(serverNow(1000, -200), 800);
});

test('predictPositionMs — paused frozen; playing adds elapsed; negative elapsed clamps', () => {
  // paused: position hi
  assert.equal(predictPositionMs(playbackState({ isPlaying: false }), T0 + 60_000), 10_000);
  // playing: base + elapsed (server-adjusted)
  assert.equal(
    predictPositionMs(playbackState({ isPlaying: true, positionMs: 10_000 }), T0 + 2500),
    12_500,
  );
  // future-dated row (elapsed negative) → clamp, base position
  assert.equal(
    predictPositionMs(playbackState({ isPlaying: true }), T0 - 5000),
    10_000,
  );
  // NaN updatedAt → base position
  assert.equal(predictPositionMs(playbackState({ updatedAt: 'garbage' }), T0), 10_000);
});

test('evaluateSync — boundaries: ≤250ms none; ≤2000ms smooth; >2000ms seek', () => {
  // drift +250 exactly → none (state predicting +0ms ahead of local baseline)
  const at = (elapsed, local) =>
    evaluateSync(playbackState({ isPlaying: true }), T0 + elapsed, local);

  // server predicts 10_000 + elapsed; local = server + drift
  assert.deepEqual(at(1000, 11_250), { driftMs: 250, action: 'none', seekToMs: null });
  assert.deepEqual(at(1000, 11_251), { driftMs: 251, action: 'smooth', seekToMs: null });
  assert.deepEqual(at(1000, 10_751), { driftMs: -249, action: 'none', seekToMs: null });
  assert.deepEqual(at(1000, 12_000), { driftMs: 1000, action: 'smooth', seekToMs: null });
  // exactly 2s → smooth (spec: |drift| ≤ 2s smooth)
  assert.deepEqual(at(1000, 13_000), { driftMs: 2000, action: 'smooth', seekToMs: null });
  assert.deepEqual(at(1000, 9_000), { driftMs: -2000, action: 'smooth', seekToMs: null });
  // 2001ms → hard seek to server predicted position (11_000)
  assert.deepEqual(at(1000, 13_001), { driftMs: 2001, action: 'seek', seekToMs: 11_000 });
  assert.deepEqual(at(1000, 8_999), { driftMs: -2001, action: 'seek', seekToMs: 11_000 });
});

test('smoothCorrectionDurationMs — 500ms drift/min rate', () => {
  assert.equal(smoothCorrectionDurationMs(500), 60_000);
  assert.equal(smoothCorrectionDurationMs(-250), 30_000);
});

test('isPresenceStale — >90s stale; exactly 90s fresh; garbage ISO stale', () => {
  const seen = T0;
  assert.equal(isPresenceStale(new Date(seen).toISOString(), seen + 89_999), false);
  assert.equal(isPresenceStale(new Date(seen).toISOString(), seen + 90_000), false);
  assert.equal(isPresenceStale(new Date(seen).toISOString(), seen + 90_001), true);
  assert.equal(isPresenceStale('garbage', seen), true);
});

/* ------------------------------ versioning ------------------------------ */

test('shouldApply — first-sync apply; fresh apply; equal duplicate no-op; old ignored', () => {
  assert.equal(shouldApply({ stateVersion: 10, queueVersion: 0 }, null), 'apply');
  assert.equal(shouldApply({ stateVersion: 11, queueVersion: 0 }, { stateVersion: 10, queueVersion: 3 }), 'apply');
  assert.equal(shouldApply({ stateVersion: 10, queueVersion: 0 }, { stateVersion: 10, queueVersion: 9 }), 'noop_duplicate');
  assert.equal(shouldApply({ stateVersion: 9, queueVersion: 9 }, { stateVersion: 10, queueVersion: 3 }), 'ignore_old');
});

test('stampFromRow — snake_case row → stamp; missing fields fail-closed (-1)', () => {
  assert.deepEqual(stampFromRow({ state_version: 3, queue_version: 2 }), { stateVersion: 3, queueVersion: 2 });
  assert.deepEqual(stampFromRow({}), { stateVersion: -1, queueVersion: -1 });
  assert.deepEqual(stampFromRow({ state_version: null }), { stateVersion: -1, queueVersion: -1 });
});

/* ------------------------------ permissions matrix ------------------------------ */

const ROLES = ['owner', 'co_host', 'moderator', 'participant', 'listener'];

test('playback_control — sirf owner + co_host (dono room types)', () => {
  for (const roomType of ['jam', 'listening_party']) {
    assert.equal(can('owner', 'playback_control', roomType), true);
    assert.equal(can('co_host', 'playback_control', roomType), true);
    assert.equal(can('moderator', 'playback_control', roomType), false);
    assert.equal(can('participant', 'playback_control', roomType), false);
    assert.equal(can('listener', 'playback_control', roomType), false);
  }
});

test('queue add/remove-own — participant JAM me allowed, PARTY me nahi', () => {
  for (const role of ROLES) {
    const expected = role !== 'listener';
    assert.equal(can(role, 'queue_add', 'jam'), expected, `queue_add jam ${role}`);
    assert.equal(can(role, 'queue_add', 'listening_party'), role !== 'listener' && role !== 'participant');
    assert.equal(can(role, 'queue_remove_own', 'jam'), expected);
    assert.equal(can(role, 'queue_remove_own', 'listening_party'), role !== 'listener' && role !== 'participant');
  }
});

test('queue_remove_any + reorder — moderation roles only (dono types)', () => {
  for (const roomType of ['jam', 'listening_party']) {
    for (const role of ROLES) {
      const expected = ['owner', 'co_host', 'moderator'].includes(role);
      assert.equal(can(role, 'queue_remove_any', roomType), expected, `remove_any ${role} ${roomType}`);
      assert.equal(can(role, 'queue_reorder', roomType), expected, `reorder ${role} ${roomType}`);
    }
  }
});

test('member_remove — moderator JAM only; member_mute — moderation roles all types', () => {
  assert.equal(can('moderator', 'member_remove', 'jam'), true);
  assert.equal(can('moderator', 'member_remove', 'listening_party'), false);
  for (const roomType of ['jam', 'listening_party']) {
    assert.equal(can('owner', 'member_mute', roomType), true);
    assert.equal(can('co_host', 'member_mute', roomType), true);
    assert.equal(can('moderator', 'member_mute', roomType), true);
    assert.equal(can('participant', 'member_mute', roomType), false);
    assert.equal(can('listener', 'member_mute', roomType), false);
    // participant/listener kabhi remove nahi kar sakte
    assert.equal(can('participant', 'member_remove', roomType), false);
    assert.equal(can('listener', 'member_remove', roomType), false);
  }
});

test('role_assign + close_room — owner only; chat_send — sab allowed', () => {
  for (const roomType of ['jam', 'listening_party']) {
    for (const role of ROLES) {
      assert.equal(can(role, 'role_assign', roomType), role === 'owner');
      assert.equal(can(role, 'close_room', roomType), role === 'owner');
      assert.equal(can(role, 'chat_send', roomType), true);
    }
  }
});

test('canModerateMember — khud pe hamesha false; target-based delegation', () => {
  assert.equal(canModerateMember('owner', 'owner', 'member_remove', 'jam'), false);
  assert.equal(canModerateMember('moderator', 'participant', 'member_remove', 'jam'), true);
  assert.equal(canModerateMember('moderator', 'participant', 'member_remove', 'listening_party'), false);
  assert.equal(canModerateMember('moderator', 'participant', 'member_mute', 'listening_party'), true);
  assert.equal(canModerateMember('listener', 'listener', 'member_remove', 'jam'), false);
});

/* ------------------------------ Song adapter ------------------------------ */

test('jamTrackToSong — denormalized track → Song (durationSec→ms, preview empty)', () => {
  const song = jamTrackToSong(
    {
      title: 'Bombay',
      artistNames: ['Sehaj', 'Ch_both'],
      artworkUrl: 'https://art.invalid/x.jpg',
      provider: 'audius',
      durationSec: 253,
      playableFull: true,
    },
    'track-42',
  );
  assert.equal(song.id, 'track-42');
  assert.equal(song.title, 'Bombay');
  assert.equal(song.artist, 'Sehaj, Ch_both');
  assert.equal(song.cover, 'https://art.invalid/x.jpg');
  assert.equal(song.preview, '');
  assert.equal(song.duration, 253_000);
  assert.equal(song.source, 'audius');
  assert.equal(song.previewOnly, false);
});

test('jamTrackToSong — previewOnly flip', () => {
  const song = jamTrackToSong(
    {
      title: 'T',
      artistNames: ['A'],
      artworkUrl: '',
      provider: 'jiosaavn',
      durationSec: 30,
      playableFull: false,
    },
    't1',
  );
  assert.equal(song.previewOnly, true);
});

test('jamQueueItemToSong + playbackToSong — queue/state → Song pipeline', () => {
  const item = {
    id: 'q1',
    roomId: 'room-1',
    trackId: 'track-9',
    track: {
      title: 'Goat',
      artistNames: ['Shubh'],
      artworkUrl: 'https://art.invalid/9.jpg',
      provider: 'jiosaavn',
      durationSec: 190,
      playableFull: true,
    },
    addedBy: 'user-1',
    position: 0,
    playedAt: null,
    createdAt: new Date(T0).toISOString(),
  };
  const song = jamQueueItemToSong(item);
  assert.equal(song.id, 'track-9');
  assert.equal(song.artist, 'Shubh');

  // playback state → song + position
  const resolved = playbackToSong(playbackState());
  assert.ok(resolved !== null);
  assert.equal(resolved.song.id, 'track-1');
  assert.equal(resolved.positionMs, 10_000);

  // khaali state → null
  assert.equal(playbackToSong(playbackState({ trackId: null, track: null })), null);
});

/* ------------------------------ labels ------------------------------ */

test('jamLabels — type/status/role Hinglish labels', () => {
  assert.equal(roomTypeLabel('jam'), 'Jam');
  assert.equal(roomTypeLabel('listening_party'), 'Listening Party');
  assert.ok(roomTypeSubtitleLabel('jam').includes('add'));
  assert.ok(roomTypeSubtitleLabel('listening_party').includes('Host'));
  assert.equal(roomStatusLabel('active'), 'live');
  assert.equal(roomStatusLabel('paused'), 'paused');
  assert.equal(roomStatusLabel('closed'), 'band ho gaya');
  assert.equal(roomStatusLabel('expired'), 'khatam ho gaya');
  assert.equal(roomRoleLabel('owner'), '👑 owner');
  assert.equal(roomRoleLabel('co_host'), 'co-host');
  assert.equal(roomRoleLabel('moderator'), 'moderator');
  assert.equal(roomRoleLabel('participant'), 'member');
  assert.equal(roomRoleLabel('listener'), 'listener');
});

/* ------------------------------ parity guard ------------------------------ */

test('permissions copy — drift guard (mobile ↔ edge function identical)', () => {
  const normalize = path => {
    const txt = readFileSync(path, 'utf8');
    // strip block comments, phir per-line cleanup
    const noBlock = txt.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'))
      .join('\n');
  };

  const mobile = normalize('./mobile/core/room/permissions.ts');
  const edge = normalize('./supabase/functions/_shared/room-permissions.ts');
  const diffIndex = (() => {
    const mLines = mobile.split('\n');
    const eLines = edge.split('\n');
    for (let i = 0; i < Math.max(mLines.length, eLines.length); i++) {
      if (mLines[i] !== eLines[i]) return { i, m: mLines[i], e: eLines[i] };
    }
    return null;
  })();
  assert.ok(diffIndex === null, `permissions drift at line ${diffIndex?.i}: ${JSON.stringify(diffIndex)}`);
});
