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
import { isLikedSong, removeLikedSong, toggleLikedSong } from './mobile/utils/likedSongs.ts';
import { parsePlaylistImportText, playlistToImportJson } from './mobile/utils/playlistImport.ts';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_NAMES,
  getFeatureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
  resolveFlagsFromEnv,
  setFeatureFlag,
} from './mobile/core/featureflags/featureFlags.ts';
import {
  configureErrorReporting,
  reportError,
} from './mobile/core/errors/errorReporting.ts';
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
  SYNC_EVENT_QUEUE_ADD,
  SYNC_EVENT_CHAT_MESSAGE,
  buildQueueAddPayload,
  parseQueueAdd,
  buildChatMessagePayload,
  parseChatMessage,
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

/* ================= featureFlags.ts ================= */
resetFeatureFlags();
check('feature flags default disabled', Object.values(DEFAULT_FEATURE_FLAGS).every(value => value === false), true);
check('chat flag default false', isFeatureEnabled('chat_enabled'), false);
setFeatureFlag('chat_enabled', true);
check('internal flag override works', isFeatureEnabled('chat_enabled'), true);
check('flag snapshot is copied', getFeatureFlags().chat_enabled, true);
resetFeatureFlags();
check('feature flags reset to disabled', isFeatureEnabled('chat_enabled'), false);

/* ---- Phase 0: env mapping (plan ke saare flags env se aane chahiye;
        premium/payments flag jaan-bujh ke registry vich nahi — app free-forever) ---- */
const FLAG_ENV_KEYS = {
  EXPO_PUBLIC_AUTH_ENABLED: 'auth_enabled',
  EXPO_PUBLIC_CATALOG_ENABLED: 'catalog_enabled',
  EXPO_PUBLIC_SOCIAL_SHARE_ENABLED: 'social_share_enabled',
  EXPO_PUBLIC_CHAT_ENABLED: 'chat_enabled',
  EXPO_PUBLIC_BLEND_ENABLED: 'blend_enabled',
  EXPO_PUBLIC_JAM_ENABLED: 'jam_enabled',
  EXPO_PUBLIC_PODCASTS_ENABLED: 'podcasts_enabled',
  EXPO_PUBLIC_LYRICS_ENABLED: 'lyrics_enabled',
  EXPO_PUBLIC_DOWNLOADS_ENABLED: 'downloads_enabled',
  EXPO_PUBLIC_AI_PLAYLIST_ENABLED: 'ai_playlist_enabled',
  EXPO_PUBLIC_AI_ASSISTANT_ENABLED: 'ai_assistant_enabled',
  EXPO_PUBLIC_EVENTS_ENABLED: 'events_enabled',
};
const savedFlagEnv = {};
for (const key of Object.keys(FLAG_ENV_KEYS)) {
  savedFlagEnv[key] = process.env[key];
  delete process.env[key];
}
const flagsAllOff = resolveFlagsFromEnv();
check('env mapping: blank env -> sab flags off', Object.values(flagsAllOff).every(value => value === false), true);
check('env mapping covers every registry flag', Object.keys(flagsAllOff).sort(), [...FEATURE_FLAG_NAMES].sort());
for (const [key, flag] of Object.entries(FLAG_ENV_KEYS)) {
  process.env[key] = 'true';
  const flags = resolveFlagsFromEnv();
  check(`env mapping: ${key} -> ${flag}`, flags[flag], true);
  delete process.env[key];
}
for (const [key, value] of Object.entries(savedFlagEnv)) {
  if (value !== undefined) process.env[key] = value;
}

/* ================= errorReporting.ts (Phase 0 pipeline) ================= */
configureErrorReporting(null);
reportError(new Error('x'));
check('null reporter no-op (koi crash nahi)', true, true);
const reported = [];
configureErrorReporting((error, context) => reported.push({ message: error.message, context }));
reportError(new Error('boom'), { surface: 'test' });
check('reporter ko error + context milta hai', reported, [{ message: 'boom', context: { surface: 'test' } }]);
configureErrorReporting(() => { throw new Error('reporter khud fail'); });
reportError(new Error('boom-2'));
check('throwing reporter app ko nahi todta', true, true);
configureErrorReporting(null);

/* ================= syncPayload.ts ================= */
const songA = { id: 's1', title: 'Lover', artist: 'Diljit', cover: '', preview: 'https://x/a.mp3', duration: 225000 };
const songB = { id: 's2', title: 'Proper Patola', artist: 'Badshah', cover: '', preview: 'https://x/b.mp3', duration: 252000 };
const ctx = { senderId: 'devA', position: 5000, sentAt: 100000 };

/* ================= likedSongs.ts ================= */
const likedOn = toggleLikedSong([songA], songB);
check('liked toggle adds song to front', likedOn.songs.map(song => song.id), ['s2', 's1']);
check('liked toggle reports added state', likedOn.liked, true);
check('liked lookup finds song', isLikedSong(likedOn.songs, 's2'), true);
const likedOff = toggleLikedSong(likedOn.songs, songB);
check('liked toggle removes existing song', likedOff.songs.map(song => song.id), ['s1']);
check('liked toggle reports removed state', likedOff.liked, false);
check('liked remove is idempotent', removeLikedSong([songA], 'missing').map(song => song.id), ['s1']);

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
const ytSong = { ...songA, preview: '', source: 'youtube_music', videoId: 'yt-1', previewOnly: false };
const ytWire = JSON.stringify({
  ...JSON.parse(wire),
  song: ytSong,
  queue: [ytSong],
});
check('parse YT Music song without preview', parseSyncPayload(ytWire)?.song.videoId, 'yt-1');
check('parse preserves YT Music source', parseSyncPayload(ytWire)?.song.source, 'youtube_music');
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

// Room queue-add ('queue-add' — koi bhi member, host bhi, add kar sake)
check('queue-add event name', SYNC_EVENT_QUEUE_ADD, 'queue-add');
const qap = buildQueueAddPayload(songB, '  Priya  ', ctx);
check('build queue-add song+sender', [qap.song.id, qap.senderId, qap.sentAt], ['s2', 'devA', ctx.sentAt]);
check('build queue-add trims addedBy', qap.addedBy, 'Priya');
check('build queue-add blank name -> Guest', buildQueueAddPayload(songA, '   ', ctx).addedBy, 'Guest');
check('parse queue-add from string', parseQueueAdd(JSON.stringify(qap))?.song.id, 's2');
check('parse queue-add object keeps addedBy', parseQueueAdd(qap)?.addedBy, 'Priya');
check('parse queue-add garbage -> null', parseQueueAdd('nope{'), null);
check('parse queue-add missing song -> null', parseQueueAdd({ addedBy: 'x', senderId: 's', sentAt: 1 }), null);
check('parse queue-add missing senderId -> null', parseQueueAdd({ song: songA, addedBy: 'x' }), null);
check('parse queue-add preview-less song -> null', parseQueueAdd({ song: { ...songA, preview: '' }, addedBy: 'x', senderId: 's' }), null);
check('parse queue-add YT Music song', parseQueueAdd({ song: ytSong, addedBy: 'x', senderId: 's' })?.song.videoId, 'yt-1');

// Room chat ('chat-message' — FR-5.12, queue-add jaisa pattern)
check('chat-message event name', SYNC_EVENT_CHAT_MESSAGE, 'chat-message');
const cmp = buildChatMessagePayload('  Bhai gaana mast hai 🔥  ', '  Rahul  ', ctx);
check('build chat keeps text+sender', [cmp?.text, cmp?.sender], ['Bhai gaana mast hai 🔥', 'Rahul']);
check('build chat blank text -> null', buildChatMessagePayload('   ', 'Rahul', ctx), null);
check('build chat blank sender -> Guest', buildChatMessagePayload('hi', '   ', ctx)?.sender, 'Guest');
check('build chat trims 500 chars', buildChatMessagePayload('x'.repeat(600), 'A', ctx)?.text.length, 500);
check('build chat id has sender+sentAt', cmp?.id.startsWith(`devA-${ctx.sentAt}-`), true);
check('parse chat from string', parseChatMessage(JSON.stringify(cmp))?.text, 'Bhai gaana mast hai 🔥');
check('parse chat object keeps sender', parseChatMessage(cmp)?.sender, 'Rahul');
check('parse chat garbage -> null', parseChatMessage('nope{'), null);
check('parse chat missing id -> null', parseChatMessage({ text: 'hi', sender: 'A', senderId: 's' }), null);
check('parse chat missing senderId -> null', parseChatMessage({ id: 'x-1', text: 'hi', sender: 'A' }), null);
check('parse chat empty text -> null', parseChatMessage({ id: 'x-1', text: '  ', sender: 'A', senderId: 's' }), null);

/* ================= playlistImport.ts ================= */
const importSong = {
  id: 'import-song',
  title: 'Imported Song',
  artist: 'Imported Artist',
  cover: '',
  preview: 'https://example.com/imported.mp3',
  duration: 185000,
};
const importedOne = parsePlaylistImportText(JSON.stringify({ name: 'Road Trip', songs: [importSong] }));
check('playlist import reads name', importedOne[0]?.name, 'Road Trip');
check('playlist import reads songs', importedOne[0]?.songs.map(song => song.id), ['import-song']);
check('playlist import skips incomplete songs', parsePlaylistImportText(JSON.stringify({ name: 'Mix', songs: [importSong, { title: 'Missing audio' }] }))[0].skippedSongs, 1);
check('playlist import supports playlist arrays', parsePlaylistImportText(JSON.stringify({ playlists: [{ name: 'A', songs: [importSong] }, { name: 'B', tracks: [importSong] }] })).map(item => item.name), ['A', 'B']);
check('playlist import converts seconds to milliseconds', parsePlaylistImportText(JSON.stringify({ name: 'Seconds', songs: [{ ...importSong, duration: 185 }] }))[0].songs[0].duration, 185000);
check('playlist export is valid JSON', JSON.parse(playlistToImportJson({ id: 'p', name: 'Export', songs: [importSong], createdAt: 1 })).name, 'Export');

console.warn = realWarn;

/* ================= core/queue/ops.ts (Phase 5 completion) ================= */
import {
  clearUpcoming,
  insertNext,
  moveQueueItem,
  removeQueueItem,
  upcomingSongs,
} from './mobile/core/queue/ops.ts';
const qSong = (id, title = `T-${id}`) => ({ id, title, artist: 'A', cover: '', preview: `https://x/${id}.mp3`, duration: 1000 });
const q = [qSong('cur'), qSong('a'), qSong('b'), qSong('c')];
check('upcoming: current ke baad wale', upcomingSongs(q, 0).map(s => s.id), ['a', 'b', 'c']);
check('upcoming: current 1 pe', upcomingSongs(q, 1).map(s => s.id), ['b', 'c']);
check('move down: a → after b', moveQueueItem(q, 'a', 'down').map(s => s.id), ['cur', 'b', 'a', 'c']);
check('move up: b → a di jagah', moveQueueItem(q, 'b', 'up').map(s => s.id), ['cur', 'b', 'a', 'c']);
check('move up: first upcoming boundary no-op', moveQueueItem(q, 'a', 'up').map(s => s.id), ['cur', 'a', 'b', 'c']);
check('move: missing id no-op', moveQueueItem(q, 'zz', 'up').map(s => s.id), ['cur', 'a', 'b', 'c']);
check('move: current (index 0) protected', moveQueueItem(q, 'cur', 'down').map(s => s.id), ['cur', 'a', 'b', 'c']);
check('remove: upcoming item', removeQueueItem(q, 'a').map(s => s.id), ['cur', 'b', 'c']);
check('remove: current protected', removeQueueItem(q, 'cur').map(s => s.id), ['cur', 'a', 'b', 'c']);
check('insertNext: naya song current ke baad', insertNext(q, 'cur', qSong('n')).map(s => s.id), ['cur', 'n', 'a', 'b', 'c']);
check('insertNext: pehle se ho to move (no duplicate)', insertNext(q, 'cur', qSong('c')).map(s => s.id), ['cur', 'c', 'a', 'b']);
check('insertNext: current null → append', insertNext(q, null, qSong('n')).map(s => s.id), ['cur', 'a', 'b', 'c', 'n']);
check('clearUpcoming: current tak rakho', clearUpcoming(q, 1).map(s => s.id), ['cur', 'a']);
check('clearUpcoming: khali queue safe', clearUpcoming([], 0), []);
check('clearUpcoming: index -1 → pehla bacha', clearUpcoming(q, -1).map(s => s.id), ['cur']);

/* ================= core/catalogue/radio.ts (Phase 5 autoplay) ================= */
import { artistTokens, pickRadioCandidates, sharesArtist } from './mobile/core/catalogue/radio.ts';
check('artistTokens: comma split + lowercase', artistTokens('Diljit Dosanjh, Intense'), ['diljit dosanjh', 'intense']);
const radioSeed = { ...qSong('seed'), artist: 'Diljit Dosanjh' };
const radioCands = [
  { ...qSong('r1'), artist: 'Diljit Dosanjh' },
  { ...qSong('r2'), artist: 'diljit dosanjh feat. someone' },
  { ...qSong('r3'), artist: 'AP Dhillon' },
  { ...qSong('r4'), artist: 'Other' },
];
const seededRng = () => 0; // deterministic shuffle
const radioPicks = pickRadioCandidates(radioCands, radioSeed, { limit: 10, rng: seededRng });
check('radio: seed exclude + same-artist only', radioPicks.map(s => s.id).sort(), ['r1', 'r2']);
check('radio: limit respect', pickRadioCandidates(radioCands, radioSeed, { limit: 1, rng: seededRng }).length, 1);
check('radio: koi match nahi → khali (service seed-only bhejti)', pickRadioCandidates([radioCands[2]], radioSeed, { rng: seededRng }), []);
check('sharesArtist: comma lists cross-match', sharesArtist(radioSeed, { ...qSong('x'), artist: 'Intense & Diljit Dosanjh' }), true);

/* ================= core/recommendations/rank.ts (Phase 13 v1) ================= */
import { rankArtists, rankSongs, scoreSongStats } from './mobile/core/recommendations/rank.ts';
check('score: plays+completions+likes positive', Math.round(scoreSongStats({ plays: 2, completions: 1, skips: 0, likes: 1, playlistAdds: 0, lastTs: '' })), 2 * 1 + 1 * 2 + 1 * 3);
check('score: skips penalty', Math.round(scoreSongStats({ plays: 1, completions: 0, skips: 2, likes: 0, playlistAdds: 0, lastTs: '' })), 1 - 3);
const tasteStats = {
  songs: {
    s1: { plays: 3, completions: 2, skips: 0, likes: 1, playlistAdds: 0, lastTs: '' },
    s2: { plays: 1, completions: 0, skips: 1, likes: 0, playlistAdds: 0, lastTs: '' },
    s3: { plays: 5, completions: 4, skips: 0, likes: 2, playlistAdds: 1, lastTs: '' },
  },
  queries: {},
};
const artistLookup = { s1: ['diljit dosanjh'], s2: ['ap dhillon'], s3: ['diljit dosanjh'] };
const ranked = rankSongs(tasteStats, artistLookup);
check('rank: sabse zyada score pehle', ranked[0].songId, 's3');
check('rank: artists carry', ranked[0].artists, ['diljit dosanjh']);
const topArtists = rankArtists(ranked, 2);
check('rankArtists: diljit top (2 songs)', topArtists[0].artist, 'diljit dosanjh');
check('rankArtists: songs count', topArtists[0].songs, 2);
check('rankArtists: limit', rankArtists(ranked, 1).length, 1);

/* ================= core/playback/sleepTimer.ts (Phase 5 completion) ================= */
import {
  computeSleepEnd,
  formatSleepRemaining,
  shouldPauseEndOfTrack,
  sleepDurationMs,
  SLEEP_OPTIONS,
} from './mobile/core/playback/sleepTimer.ts';
check('sleep: 30 min duration', sleepDurationMs('30'), 30 * 60_000);
check('sleep: end_of_track → null', sleepDurationMs('end_of_track'), null);
check('sleep: off → null', sleepDurationMs('off'), null);
check('computeSleepEnd: now + duration', computeSleepEnd('15', 1000), 1000 + 15 * 60_000);
check('computeSleepEnd: off → null', computeSleepEnd('off', 1000), null);
check('formatRemaining: 4:59', formatSleepRemaining(299000), '4:59');
check('formatRemaining: 1:00:12', formatSleepRemaining(3612000), '1:00:12');
check('formatRemaining: negative → 0:00', formatSleepRemaining(-5), '0:00');
check('endOfTrack: duration-700 pe pause', shouldPauseEndOfTrack(180_000 - 500, 180_000), true);
check('endOfTrack: door pe nahi', shouldPauseEndOfTrack(60_000, 180_000), false);
check('endOfTrack: duration unknown → false', shouldPauseEndOfTrack(1000, 0), false);
check('sleep options: 6 modes listed', SLEEP_OPTIONS.length, 6);

/* ================= core/chat/reactions.ts (Phase 9 slice) ================= */
import {
  buildReactionPayload,
  isReactionEmoji,
  mergeReaction,
  parseReactionPayload,
  REACTION_EMOJIS,
} from './mobile/core/chat/reactions.ts';
check('reactions: emoji guard', isReactionEmoji('👍'), true);
check('reactions: invalid emoji reject', isReactionEmoji('🤡'), false);
const react = buildReactionPayload('m1', '🔥', { senderId: 'u1', sentAt: 5 });
check('reaction payload build', react, { messageId: 'm1', emoji: '🔥', senderId: 'u1', sentAt: 5 });
check('reaction build: khali messageId → null', buildReactionPayload('  ', '👍', { senderId: 'u1', sentAt: 5 }), null);
const parsedReaction = parseReactionPayload(JSON.stringify(react));
check('reaction parse roundtrip', parsedReaction?.emoji, '🔥');
check('reaction parse: junk → null', parseReactionPayload('not-json{{'), null);
let rmap = mergeReaction({}, react);
check('merge: reaction add', rmap, { m1: { '🔥': ['u1'] } });
rmap = mergeReaction(rmap, react);
check('merge: toggle same sender → remove (idempotent)', rmap, {});
rmap = mergeReaction(rmap, react);
rmap = mergeReaction(rmap, { ...react, senderId: 'u2' });
check('merge: do senders count', rmap.m1['🔥'].length, 2);
check('merge: doosra emoji alag bucket', mergeReaction(rmap, { ...react, emoji: '👍' }).m1['👍'], ['u1']);
check('REACTION_EMOJIS: 5 options', REACTION_EMOJIS.length, 5);

/* ================= core/moderation/moderation.ts (Phase 9/2 slice) ================= */
import {
  createReport,
  filterVisibleMessages,
  isUserBlocked,
  toggleBlockedUser,
} from './mobile/core/moderation/moderation.ts';
check('report: valid banta hai', createReport({ kind: 'message', targetId: 'm1', reason: 'spam', reporterId: 'me' })?.reason, 'spam');
check('report: khali target → null', createReport({ kind: 'message', targetId: '  ', reason: 'spam', reporterId: 'me' }), null);
check('report: galat reason → null', createReport({ kind: 'user', targetId: 'u1', reason: 'nonsense', reporterId: 'me' }), null);
check('blocked check', isUserBlocked(['u1'], 'u1'), true);
check('block toggle: add', toggleBlockedUser([], 'u1'), ['u1']);
check('block toggle: remove', toggleBlockedUser(['u1', 'u2'], 'u1'), ['u2']);
const chatMsgs = [{ senderId: 'u1', text: 'a' }, { senderId: 'me', text: 'b' }];
check('filter: blocked ke messages gayab', filterVisibleMessages(chatMsgs, ['u1']), [{ senderId: 'me', text: 'b' }]);
check('filter: khali blocklist → sab', filterVisibleMessages(chatMsgs, []).length, 2);

/* ================= core/downloads/stateMachine.ts (Phase 6 v1) ================= */
import {
  isPlayableOffline,
  reduceDownload,
} from './mobile/core/downloads/stateMachine.ts';
const dlSong = qSong('d1');
const dlItem = { id: 'd1', song: dlSong, status: 'queued', progress: 0, updatedAt: 1 };
check('dl: queued → downloading', reduceDownload(dlItem, { type: 'start' }).status, 'downloading');
check('dl: progress clamp', reduceDownload({ ...dlItem, status: 'downloading' }, { type: 'progress', progress: 150 }).progress, 100);
const dlDone = reduceDownload({ ...dlItem, status: 'downloading' }, { type: 'complete', filePath: 'file:///x.mp3', sizeBytes: 5 });
check('dl: complete', dlDone.status, 'downloaded');
check('dl: complete stores file', dlDone.filePath, 'file:///x.mp3');
check('dl: illegal queued→complete no-op', reduceDownload(dlItem, { type: 'complete', filePath: 'x' }), dlItem);
check('dl: fail sets error', reduceDownload({ ...dlItem, status: 'downloading' }, { type: 'fail', error: 'HTTP 404' }).error, 'HTTP 404');
check('dl: failed → retry → queued', reduceDownload({ ...dlItem, status: 'failed' }, { type: 'retry' }).status, 'queued');
check('dl: offline playable check', isPlayableOffline(dlDone), true);
check('dl: queued not playable offline', isPlayableOffline(dlItem), false);

/* ================= summary ================= */
if (fail > 0) {
  console.log('FAILURES:\n' + failures.join('\n'));
}
console.log(`test-logic: ${pass} passed, ${fail} failed, ${pass + fail} total`);
// process.exit() Node/Windows pe stdio-teardown race (libuv assertion) karta hai
// — natural exit se exit code bhi milta hai, crash bhi nahi hota.
process.exitCode = fail === 0 ? 0 : 1;



