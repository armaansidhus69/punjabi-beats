/**
 * test-youtube-match.mjs — Smart YouTube matching (Spotify→YouTube hybrid).
 *
 * Do cheezein verify karta hai:
 *   1. SCORING rules (`songMatch.ts`) — spec ka har +/- term + jo 3 fixes kiye.
 *   2. ORCHESTRATION (`youtubeAudio.ts`) — query build, limit slice, error path.
 *
 * Live YouTube search yahan NAHI hota (wo probe-ytaudio.mjs karta hai) — yahan
 * YouTube ke results ko MOCK karke matcher ka decision verify hota hai, taaki
 * test network pe depend na kare aur deterministic rahe.
 *
 * Run: node test-youtube-match.mjs   (Node 24 — .ts seedha import hota hai)
 */
// youtubeAudio.ts me `__DEV__` guard hai (RN me global hota hai) — Node me define karo
globalThis.__DEV__ = false;

// youtubeAudio.ts ke andar `import ... from './songMatch'` extensionless hai (RN/Metro
// style). Node ESM ko extension chahiye — isliye ek chhota resolve-hook: extensionless
// relative specifier ko `.ts` pe map karta hai. Source conventions chhedne ki zarurat
// nahi. Static imports link-phase me resolve hote hain (hook se pehle), isliye
// youtubeAudio.ts ko dynamic `import()` se laate hain.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('.') &&
      !/\.(ts|tsx|js|mjs|cjs|json)$/i.test(specifier) &&
      context.parentURL
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

import {
  normalizeForMatch,
  titleMatchRatio,
  artistMatches,
  findRejectWord,
  findPenaltyWord,
  hasGoodWord,
  scoreCandidate,
  pickBestMatch,
  SCORE_EXACT,
  SCORE_PARTIAL,
} from './mobile/services/songMatch.ts';

const { findYouTubeAudio, buildSearchQuery, toMatchSource, normalizeCandidates, SEARCH_LIMIT } =
  await import('./mobile/services/youtubeAudio.ts');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    failures.push(`  X ${name} | got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
  }
}

function checkTrue(name, cond, detail = '') {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`  X ${name} | expected true ${detail}`);
  }
}

/* ================= normalize + title ratio ================= */

check('norm lowercases+strips', normalizeForMatch('Mela (Official Audio)'), 'mela official audio');
check('norm collapses G.O.A.T.', normalizeForMatch('G.O.A.T.'), 'goat');
check('norm keeps Gurmukhi', normalizeForMatch('ਮੇਲਾ'), 'ਮੇਲਾ');
check('norm & -> and', normalizeForMatch('Jatt & Juliet'), 'jatt and juliet');

check('ratio exact', titleMatchRatio('Mela', 'Mela'), 1);
check('ratio contains (extra words ok)', titleMatchRatio('Mela (Official Audio)', 'Mela'), 1);
check('ratio initialism match', titleMatchRatio('G.O.A.T.', 'GOAT'), 1);
check('ratio 295', titleMatchRatio('295', '295'), 1);
check('ratio wrong song -> 0', titleMatchRatio('Mel Gel', 'Mela'), 0);
check('ratio all words present (non-contiguous)', titleMatchRatio('Tum Something Hi Ho', 'Tum Hi Ho'), 0.85);
check('ratio contiguous extra words', titleMatchRatio('Tum Hi Ho Lyrical Video', 'Tum Hi Ho'), 1);
check('ratio partial low', titleMatchRatio('Softly Some Other', 'Softly On Top'), 0);

/* ================= artist ================= */

check('artist case-insensitive', artistMatches('DILJIT DOSANJH', '', 'Diljit Dosanjh'), true);
check('artist wrong', artistMatches('Numan Zaka', '295', 'Sidhu Moose Wala'), false);
check('artist in title', artistMatches('T-Series', '295 Sidhu Moose Wala', 'Sidhu Moose Wala'), true);
check('artist single-word', artistMatches('', 'Softly Karan Aujla', 'Karan Aujla'), true);
check('artist single-word mismatch', artistMatches('Random', 'Something', 'Shubh'), false);

/* ================= reject / good words ================= */

check('reject slowed', findRejectWord('Mela (Slowed + Reverb)'), 'slowed');
check('reject remix', findRejectWord('295 Remix'), 'remix');
check('reject lyrics', findRejectWord('295 (Lyrics)'), 'lyrics');
check('reject live', findRejectWord('Softly - Live in Concert'), 'live');
check('reject none on clean title', findRejectWord('295 (Official Audio)'), null);
check('reject boundary olive != live', findRejectWord('Olive Tree'), null);
check('penalty reaction', findPenaltyWord('295 Reaction'), 'reaction');
check('good word official', hasGoodWord('Mela (Official Audio)'), true);
check('good word topic', hasGoodWord('Mela - Topic'), true);
check('good word none', hasGoodWord('Mel Gel'), false);

/* ================= scoreCandidate (spec ke terms) ================= */

const src295 = { title: '295', artist: 'Sidhu Moose Wala', durationMs: 270000 };

const cGood = scoreCandidate(
  { videoId: 'gD4EtH2Plik', title: '295 (Official Audio)', channel: 'Sidhu Moose Wala', durationSec: 270 },
  src295,
);
check('score exact song = 50+30+20+15', cGood.score, 115);
checkTrue('score exact >= EXACT', cGood.score >= SCORE_EXACT, `(${cGood.score})`);

const cVerified = scoreCandidate(
  { videoId: 'v', title: '295', channel: 'Sidhu Moose Wala', durationSec: 262, verified: true },
  src295,
);
check('verified adds +10 (spec me -100 sign bug tha)', cVerified.score, 50 + 30 + 20 + 10);

const cWrongSong = scoreCandidate(
  { videoId: 'w', title: 'G.O.A.T.', channel: 'Diljit Dosanjh', durationSec: 270 },
  src295,
);
checkTrue('wrong song -> rejected (gate)', !Number.isFinite(cWrongSong.score));

const cRejectWord = scoreCandidate(
  { videoId: 'r', title: '295 (Slowed)', channel: 'Sidhu Moose Wala', durationSec: 270 },
  src295,
);
checkTrue('reject word -> rejected', !Number.isFinite(cRejectWord.score));

const cDurOff = scoreCandidate(
  { videoId: 'd', title: '295', channel: 'Sidhu Moose Wala', durationSec: 340 },
  src295,
);
// title 50 + artist 30 - duration(70s>30s) 30 = 50
check('duration >30s off -> -30', cDurOff.score, 50);

const cDurUnknown = scoreCandidate(
  { videoId: 'u', title: '295', channel: 'Sidhu Moose Wala', durationSec: 0 },
  src295,
);
check('unknown duration -> no penalty', cDurUnknown.score, 80);


/* ================= pickBestMatch ================= */

const dec = pickBestMatch(
  [
    { videoId: 'a', title: '295 Remix', channel: 'Sidhu Moose Wala', durationSec: 270 },
    { videoId: 'b', title: '295 (Official Audio)', channel: 'Sidhu Moose Wala', durationSec: 270 },
    { videoId: 'c', title: '295', channel: 'Numan Zaka', durationSec: 295 },
  ],
  src295,
);
check('best match picks official (not remix)', dec.best?.videoId, 'b');
check('best match status', dec.status, 'exact');
checkTrue('ranked is sorted desc', dec.ranked[0].score >= dec.ranked[1].score);

const decNone = pickBestMatch(
  [{ videoId: 'x', title: 'Totally Different Song', channel: 'Random', durationSec: 100 }],
  src295,
);
check('no candidate gate-pass -> unavailable', decNone.status, 'unavailable');
check('no candidate -> best null', decNone.best, null);

/* ================= query + adapters ================= */

check('query with artist', buildSearchQuery({ artist: 'Diljit Dosanjh', title: 'Mela' }), 'Diljit Dosanjh - Mela official audio');
check('query without artist', buildSearchQuery({ artist: '   ', title: 'Mela' }), 'Mela official audio');
check('toMatchSource maps ms duration', toMatchSource({ title: 'x', artist: 'y', duration: 225000 }).durationMs, 225000);

const norm = normalizeCandidates([
  { videoId: 'v1', title: '295', artist: 'Sidhu Moose Wala', duration: 270 },
  { videoId: '', title: 'bad', artist: 'x', duration: 1 },
  { title: 'no id', artist: 'x', duration: 1 },
  null,
]);
check('normalize keeps valid only', norm.length, 1);
check('normalize maps artist->channel', norm[0].channel, 'Sidhu Moose Wala');
check('normalize maps duration->durationSec', norm[0].durationSec, 270);
check('normalize non-array -> []', normalizeCandidates('nope'), []);

/* ================= findYouTubeAudio (injected search) ================= */

// 1. Happy path — mock search 295 de deta hai
const okRes = await findYouTubeAudio(
  { title: '295', artist: 'Sidhu Moose Wala', duration: 270000 },
  async () => [
    { videoId: 'gD4EtH2Plik', title: '295 (Official Audio)', channel: 'Sidhu Moose Wala', durationSec: 270 },
    { videoId: 'zzz', title: '295 Tribute', channel: 'Deepak Dildar', durationSec: 188 },
  ],
);
check('findYouTubeAudio exact videoId', okRes.videoId, 'gD4EtH2Plik');
check('findYouTubeAudio exact status', okRes.status, 'exact');
check('findYouTubeAudio no warning on exact', okRes.warning, undefined);
check('findYouTubeAudio counts candidates', okRes.candidatesConsidered, 2);

// 2. Search fail -> unavailable (crash nahi)
const failRes = await findYouTubeAudio(
  { title: '295', artist: 'Sidhu Moose Wala', duration: 270000 },
  async () => {
    throw new Error('network down');
  },
);
check('search fail -> unavailable', failRes.status, 'unavailable');
check('search fail warning', failRes.warning, 'This song is not available in full length');

// 3. Empty results -> unavailable
const emptyRes = await findYouTubeAudio(
  { title: 'Rare Song', artist: 'Nobody', duration: 100000 },
  async () => [],
);
check('empty results -> unavailable', emptyRes.status, 'unavailable');

// 4. Limit slice — best candidate 3rd pe hai, limit 2 me sirf junk aata hai
const limitRes = await findYouTubeAudio(
  { title: '295', artist: 'Sidhu Moose Wala', duration: 270000 },
  async () => [
    { videoId: 'junk1', title: 'Random One', channel: 'X', durationSec: 100 },
    { videoId: 'junk2', title: 'Random Two', channel: 'Y', durationSec: 100 },
    { videoId: 'good', title: '295', channel: 'Sidhu Moose Wala', durationSec: 270 },
  ],
  2,
);
check('limit slice ignores 3rd result', limitRes.status, 'unavailable');
check('SEARCH_LIMIT is 5 (spec)', SEARCH_LIMIT, 5);

// 5. Partial -> status + warning (title exact par artist channel + duration off)
const partRes = await findYouTubeAudio(
  { title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: 261000 },
  async () => [{ videoId: 'p', title: 'Tum Hi Ho', channel: 'Random Guy', durationSec: 280 }],
);
check('partial status', partRes.status, 'partial');
check('partial warning', partRes.warning, 'May not be exact version');

/* ================= 10-song accuracy suite (mock YouTube results) ================= */

// Har entry: source track + YouTube pe jo realistically milta hai (mock).
// expected = matcher ka hona chahiye wala decision.
const SUITE = [
  {
    name: '295 — Sidhu Moose Wala',
    track: { title: '295', artist: 'Sidhu Moose Wala', duration: 270000 },
    yt: [
      { videoId: 's1', title: '295', channel: 'Sidhu Moose Wala', durationSec: 270, verified: true },
      { videoId: 's2', title: '295', channel: 'Numan Zaka', durationSec: 295 },
      { videoId: 's3', title: '295 Tribute To Sidhu Moose Wala', channel: 'Deepak Dildar', durationSec: 188 },
      { videoId: 's4', title: 'Forget About It', channel: 'Sidhu Moose Wala', durationSec: 223 },
    ],
    expected: 'exact',
  },
  {
    name: 'Softly — Karan Aujla',
    track: { title: 'Softly', artist: 'Karan Aujla', duration: 156000 },
    yt: [
      { videoId: 'k1', title: 'Softly', channel: 'Karan Aujla', durationSec: 156 },
      { videoId: 'k2', title: 'IDK HOW', channel: 'Karan Aujla', durationSec: 176 },
      { videoId: 'k3', title: 'HIM.', channel: 'Karan Aujla', durationSec: 192 },
    ],
    expected: 'exact',
  },
  {
    name: 'Born to Shine — Diljit',
    track: { title: 'Born to Shine', artist: 'Diljit Dosanjh', duration: 214000 },
    yt: [
      { videoId: 'b1', title: 'Born to Shine', channel: 'DILJIT DOSANJH', durationSec: 214 },
      { videoId: 'b2', title: 'G.O.A.T.', channel: 'DILJIT DOSANJH', durationSec: 224 },
    ],
    expected: 'exact',
  },
  {
    name: 'Excuses — AP Dhillon',
    track: { title: 'Excuses', artist: 'AP Dhillon', duration: 165000 },
    yt: [
      { videoId: 'e1', title: 'Excuses (Official Music Video)', channel: 'AP Dhillon', durationSec: 165 },
      { videoId: 'e2', title: 'Excuses', channel: 'Random Uploads', durationSec: 165 },
    ],
    expected: 'exact',
  },
  {
    name: 'Brown Munde — AP Dhillon',
    track: { title: 'Brown Munde', artist: 'AP Dhillon', duration: 245000 },
    yt: [
      { videoId: 'm1', title: 'Brown Munde (Official Audio)', channel: 'AP DHILLON', durationSec: 245 },
      { videoId: 'm2', title: 'Brown Munde (Remix)', channel: 'DJ Some', durationSec: 245 },
    ],
    expected: 'exact',
  },
  {
    name: 'Same Beef — Sidhu Moose Wala',
    track: { title: 'Same Beef', artist: 'Sidhu Moose Wala', duration: 210000 },
    yt: [
      { videoId: 'sb1', title: 'Same Beef', channel: 'Sidhu Moose Wala', durationSec: 210 },
      { videoId: 'sb2', title: 'Same Beef (Slowed + Reverb)', channel: 'Lofi Guy', durationSec: 260 },
    ],
    expected: 'exact',
  },
  {
    name: 'G.O.A.T. — Diljit (initialism)',
    track: { title: 'GOAT', artist: 'Diljit Dosanjh', duration: 224000 },
    yt: [
      { videoId: 'g1', title: 'G.O.A.T.', channel: 'DILJIT DOSANJH', durationSec: 224 },
      { videoId: 'g2', title: 'Charmer', channel: 'Diljit Dosanjh', durationSec: 176 },
    ],
    expected: 'exact',
  },
  {
    name: '8 Parche — Baani Sandhu',
    track: { title: '8 Parche', artist: 'Baani Sandhu', duration: 205000 },
    yt: [
      { videoId: 'p1', title: '8 Parche', channel: 'Baani Sandhu', durationSec: 205 },
      { videoId: 'p2', title: '8 Parche (Karaoke)', channel: 'Karaoke India', durationSec: 205 },
    ],
    expected: 'exact',
  },
  {
    name: 'Softly — Karan Aujla (re-upload only)',
    track: { title: 'Softly', artist: 'Karan Aujla', duration: 156000 },
    yt: [{ videoId: 'r1', title: 'Softly', channel: 'Lyrical India', durationSec: 175 }],
    expected: 'partial',
  },
  {
    name: 'Mela — Diljit (YouTube pe nahi hai)',
    track: { title: 'Mela', artist: 'Diljit Dosanjh', album: 'Jatt & Juliet', duration: 225000 },
    yt: [
      { videoId: 'x1', title: 'Mel Gel', channel: 'DILJIT DOSANJH', durationSec: 192 },
      { videoId: 'x2', title: 'G.O.A.T.', channel: 'DILJIT DOSANJH', durationSec: 224 },
      { videoId: 'x3', title: 'Vanilla', channel: 'DILJIT DOSANJH', durationSec: 172 },
    ],
    expected: 'unavailable',
  },
];

let exact = 0;
let partial = 0;
let unavailable = 0;
const suiteLines = [];

for (const t of SUITE) {
  const res = await findYouTubeAudio(t.track, async () => t.yt);
  checkTrue(`suite "${t.name}" -> ${t.expected}`, res.status === t.expected, `(got ${res.status})`);
  if (res.status === 'exact') exact++;
  else if (res.status === 'partial') partial++;
  else unavailable++;
  const top = res.videoId ? `"${res.title}" [${res.channel}] score=${res.score}` : '(none)';
  suiteLines.push(`  ${res.status.padEnd(11)} | ${t.name.padEnd(36)} | ${top}`);
}

/* ================= summary ================= */

if (fail > 0) console.log('\nFAILURES:\n' + failures.join('\n'));

console.log('\n--- 10-song suite ---');
console.log(suiteLines.join('\n'));
console.log(`\nRESULT: ${exact} exact, ${partial} partial, ${unavailable} unavailable (of ${SUITE.length})`);
console.log(`test-youtube-match: ${pass} passed, ${fail} failed, ${pass + fail} total`);

process.exitCode = fail === 0 ? 0 : 1;

