/**
 * test-logic.mjs — headless tests for pure app logic (REPRODUCIBLE).
 *
 * Node >= 23.6 chahiye (built-in TS type-stripping) — .ts files seedha import
 * ho jaati hain, koi tsx/ts-node nahi. Koi native/external dep nahi: sirf pure
 * utils (format, playlistValidation, syncPayload) test hote hain.
 *
 * Ye CHECKLIST ke in boxes ko back karta hai:
 *   - Phase 6  "duration UI (3:45, 4:12)"                  → formatDuration
 *   - Phase 9  "Duplicate check" / "Create → add → persists" → playlistValidation
 *   - Phase 11 "Robust JSON parsing" + echo/latency guards   → syncPayload
 *
 * Run: node test-logic.mjs   (ya root pe: npm test)
 */
import { formatDuration, progressRatio } from './mobile/utils/format.ts';
import { validatePlaylistName, PLAYLIST_NAME_MAX } from './mobile/utils/playlistValidation.ts';
import {
  buildSyncPayload,
  parseSyncPayload,
  syncEventForAction,
  isOwnEcho,
  latencyCompensation,
  compensatedPosition,
  shouldIgnoreRemote,
  shouldThrottleSeek,
  SYNC_EVENT_SONG,
  SYNC_EVENT_CONTROL,
  SEEK_THROTTLE_MS,
  DUPLICATE_POSITION_MS,
  SEEK_JITTER_MS,
  MAX_LATENCY_COMPENSATION_MS,
} from './mobile/utils/syncPayload.ts';

// Robust-parse tests jaan-bujh kar fail honge → console.warn ko chup karao
const realWarn = console.warn;
let warnCount = 0;
console.warn = () => {
  warnCount++;
};

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`  X ${name} | got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
  }
}

/* ================= format.ts ================= */
// User requirement: "Duration UI sahi dikhe (3:45, 4:12, etc.)"
check('duration 3:05', formatDuration(185000), '3:05');
check('duration 3:45', formatDuration(225000), '3:45');
check('duration 4:12', formatDuration(252000), '4:12');
check('duration 0:30 (preview)', formatDuration(30000), '0:30');
check('duration 1:01', formatDuration(61000), '1:01');
check('duration 0 -> 0:00', formatDuration(0), '0:00');
check('duration negative -> 0:00', formatDuration(-100), '0:00');
check('duration NaN -> 0:00', formatDuration(NaN), '0:00');
check('duration Infinity -> 0:00', formatDuration(Infinity), '0:00');

check('ratio 50/100', progressRatio(50, 100), 0.5);
check('ratio 0/0 safe', progressRatio(0, 0), 0);
check('ratio negative -> 0', progressRatio(-10, 100), 0);
check('ratio overflow -> 1', progressRatio(200, 100), 1);
check('ratio NaN pos -> 0', progressRatio(NaN, 100), 0);
check('ratio NaN dur -> 0', progressRatio(50, NaN), 0);

/* ================= playlistValidation.ts ================= */
check('empty name rejected', validatePlaylistName('', []), 'Naam khaali nahi ho sakta');
check('whitespace name rejected', validatePlaylistName('   ', []), 'Naam khaali nahi ho sakta');
check('valid name -> null', validatePlaylistName('  Chill Mix  ', []), null);
check('over-length rejected', validatePlaylistName('x'.repeat(PLAYLIST_NAME_MAX + 1), []), `Naam ${PLAYLIST_NAME_MAX} characters se chhota rakho`);
check('exact-length accepted', validatePlaylistName('x'.repeat(PLAYLIST_NAME_MAX), []), null);
check('duplicate case-insensitive', validatePlaylistName('Party', ['party']), 'Is naam ki playlist pehle se hai');
check('duplicate trim+case', validatePlaylistName('Party', ['  PARTY  ']), 'Is naam ki playlist pehle se hai');
check('no duplicate -> null', validatePlaylistName('Party', ['Chill', 'Bhangra']), null);
check('duplicate among many', validatePlaylistName('bhangra', ['Chill', 'Party', 'Bhangra']), 'Is naam ki playlist pehle se hai');
check('PLAYLIST_NAME_MAX', PLAYLIST_NAME_MAX, 40);

/* ================= syncPayload.ts ================= */
const songA = { id: 's1', title: 'Lover', artist: 'Diljit', cover: '', preview: 'https://x/a.mp3', duration: 225000 };
const songB = { id: 's2', title: 'Proper Patola', artist: 'Badshah', cover: '', preview: 'https://x/b.mp3', duration: 252000 };
const ctx = { senderId: 'devA', position: 5000, sentAt: 100000 };

// Event routing (Phase 11: song → song-change, baaki → playback-control)
check('song -> song-change', syncEventForAction({ type: 'song', song: songA, queue: [songA], position: 0, isPlaying: true, remote: false }), SYNC_EVENT_SONG);
check('play -> playback-control', syncEventForAction({ type: 'play', remote: false }), SYNC_EVENT_CONTROL);
check('pause -> playback-control', syncEventForAction({ type: 'pause', remote: false }), SYNC_EVENT_CONTROL);
check('seek -> playback-control', syncEventForAction({ type: 'seek', position: 0, remote: false }), SYNC_EVENT_CONTROL);

// Build
const builtSong = buildSyncPayload(
  { type: 'song', song: songB, queue: [songA, songB], position: 500, isPlaying: true, remote: false },
  ctx,
);
check('build song index', builtSong.index, 1);
check('build song type', builtSong.type, 'song');
check('build song senderId', builtSong.senderId, 'devA');
check('build song sentAt', builtSong.sentAt, ctx.sentAt);
check('build seek clamp(-500) -> 0', buildSyncPayload({ type: 'seek', position: -500, remote: false }, ctx).position, 0);
check('build empty queue -> [song]', buildSyncPayload({ type: 'song', song: songA, queue: [], position: 0, isPlaying: false, remote: false }, ctx).queue, [songA]);
check('build play uses ctx.position', buildSyncPayload({ type: 'play', remote: false }, { ...ctx, position: 9000 }).position, 9000);
check('build pause type', buildSyncPayload({ type: 'pause', remote: false }, ctx).type, 'pause');
check('build song index fallback when missing', buildSyncPayload({ type: 'song', song: songB, queue: [songA], position: 0, isPlaying: true, remote: false }, ctx).index, 0);

// Parse (robust) — Phase 11 "Robust JSON parsing" box
const wire = JSON.stringify(buildSyncPayload({ type: 'song', song: songA, queue: [songA, songB], position: 1000, isPlaying: true, remote: false }, ctx));
const parsedFromString = parseSyncPayload(wire);
check('parse JSON string -> song', parsedFromString && parsedFromString.type, 'song');
check('parse keeps senderId', parsedFromString && parsedFromString.senderId, 'devA');
check('parse object (no stringify)', parseSyncPayload(JSON.parse(wire)).type, 'song');
check('parse garbage string -> null', parseSyncPayload('not-json{'), null);
check('parse number -> null', parseSyncPayload(42), null);
check('parse missing senderId -> null', parseSyncPayload({ type: 'play', position: 100 }), null);
check('parse drops preview-less song', parseSyncPayload(JSON.stringify({ ...JSON.parse(wire), song: { ...songA, preview: '' } })), null);
check('robust parse fired warnings', warnCount > 0, true);

// Echo / latency guards (NFR-3.3 + glitch-storm protection)
check('isOwnEcho true', isOwnEcho(parsedFromString, 'devA'), true);
check('isOwnEcho false', isOwnEcho(parsedFromString, 'devB'), false);
check('latency 500ms', latencyCompensation(1000, 1500), 500);
check('latency future-clock -> 0', latencyCompensation(2000, 1000), 0);
check('latency invalid sentAt -> 0', latencyCompensation(0, 1000), 0);
check('latency clamped to max', latencyCompensation(1000, 1000 + 10 ** 9), MAX_LATENCY_COMPENSATION_MS);
check('compensated adds latency', compensatedPosition(1000, 1000, 1500), 1500);
check('compensated never negative', compensatedPosition(-500, 1000, 1000), 0);

// shouldIgnoreRemote — auto-next glitch-storm guard
const snapSame = { currentSongId: 's1', index: 0, isPlaying: true, position: 1500 };
const songMsg = buildSyncPayload({ type: 'song', song: songA, queue: [songA, songB], position: 1000, isPlaying: true, remote: false }, ctx);
check('ignore same song+spot', shouldIgnoreRemote(songMsg, snapSame, 1000), true);
check('ignore different song -> false', shouldIgnoreRemote(songMsg, { ...snapSame, currentSongId: 's2' }, 1000), false);
check('ignore play while playing+same', shouldIgnoreRemote(buildSyncPayload({ type: 'play', remote: false }, ctx), { ...snapSame, isPlaying: true }, 1600), true);
check('play while paused -> false', shouldIgnoreRemote(buildSyncPayload({ type: 'play', remote: false }, ctx), { ...snapSame, isPlaying: false }, 1600), false);
check('seek within jitter -> true', shouldIgnoreRemote(buildSyncPayload({ type: 'seek', position: 1000, remote: false }, ctx), { ...snapSame, position: 1200 }, 1000), true);
check('seek beyond jitter -> false', shouldIgnoreRemote(buildSyncPayload({ type: 'seek', position: 1000, remote: false }, ctx), { ...snapSame, position: 9000 }, 1000), false);

// Seek throttle (250ms leading edge)
check('throttle within window', shouldThrottleSeek(1000, 1100), true);
check('allow after window', shouldThrottleSeek(1000, 1100 + SEEK_THROTTLE_MS), false);
check('never throttled w/o lastSent', shouldThrottleSeek(0, 1100), false);
check('custom window respected', shouldThrottleSeek(1000, 1100, 50), false);
check('jitter < duplicate const', SEEK_JITTER_MS < DUPLICATE_POSITION_MS, true);

console.warn = realWarn;

/* ================= summary ================= */
if (fail > 0) {
  console.log('FAILURES:\n' + failures.join('\n'));
}
console.log(`test-logic: ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);



