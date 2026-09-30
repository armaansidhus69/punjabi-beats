/**
 * probe-search.mjs — LIVE end-to-end test of the real `searchSongs()` chain.
 * Node 23.6+ type-stripping se musicApi.ts seedha import hota hai (jaise
 * test-logic.mjs pure utils karta hai) — yahan asli axios + asli APIs.
 *
 * Run: node probe-search.mjs
 *
 * Check karta hai:
 *   - kaunsa source chala (console me [musicApi] line)
 *   - FULL song mila ya sirf 30s preview (upgrade passes ke baad artist/mood
 *     queries pe full chahiye — user complaint: "only play 30 sec")
 *   - previewOnly flag UI badge se match karta hai
 *   - `getTrendingSongs()` = 100% full songs (artist rotation)
 */
import { searchSongs, getTrendingSongs } from './mobile/services/musicApi.ts';

const CASES = [
  { q: 'Diljit', expect: 'full' },
  { q: 'Karan Aujla', expect: 'full' },
  { q: 'Sidhu Moose Wala', expect: 'full' },
  { q: 'Satinder Sartaaj', expect: 'full' },
  // 'punjabi hits' / 'Gurdas Maan' → upgrade passes se at least kuch full chahiye
  { q: 'punjabi hits', expect: 'some-full' },
  { q: 'Gurdas Maan', expect: 'some-full' },
  // 'Diljit party' → artist expansion (Diljit Dosanjh) se full list aani chahiye
  { q: 'Diljit party', expect: 'full' },
  // iTunes fuzzy matching hai — "xyzabc" pe bhi 3 real tracks milte hain
  // (El Vato Base / Sublee). Guarantee ye hai ki garbage query pe koi FULL song
  // nahi aata: Audius ke 20s clips 60s filter se kat jaate hain aur upgrade
  // passes bhi title/artist match pe hi kaam karte hain.
  { q: 'xyzabc', expect: 'preview' },
  { q: '', expect: 'empty' },
];

let pass = 0;
let fail = 0;

const record = (label, ok, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${label} | ${detail}`);
};

for (const c of CASES) {
  const songs = await searchSongs(c.q, 30);
  const full = songs.filter(s => !s.previewOnly && s.duration >= 180000).length;
  const preview = songs.filter(s => s.previewOnly).length;
  const longest = songs.reduce((m, s) => Math.max(m, s.duration), 0);
  const sources = [...new Set(songs.map(s => s.previewOnly ? 'itunes' : 'audius/js'))].join('+') || 'none';

  let ok = false;
  if (c.expect === 'empty') ok = songs.length === 0;
  else if (c.expect === 'full') ok = full >= 5;
  else if (c.expect === 'some-full') ok = songs.length > 0 && full >= 1;
  else if (c.expect === 'preview') ok = songs.length > 0 && full === 0;
  else if (c.expect === 'mixed-or-preview') ok = songs.length > 0;

  // Har result pe playback URL + previewOnly consistency
  const consistent = songs.every(s => s.preview.startsWith('http') && (s.previewOnly === true || s.duration >= 60000));

  record(
    `"${c.q}"`,
    ok && consistent,
    `n=${songs.length} full=${full} preview=${preview} longest=${Math.round(longest / 1000)}s src=${sources}${consistent ? '' : ' | INCONSISTENT'}`,
  );
  if (songs.length > 0) {
    const first = songs[0];
    console.log(`         first: ${first.title.slice(0, 50)} — ${first.artist} — ${Math.round(first.duration / 1000)}s previewOnly=${first.previewOnly}`);
  }
}

// Home feed guarantee: trending = FULL songs (artist rotation, 30s kabhi nahi)
const trending = await getTrendingSongs(20);
const trendFull = trending.filter(s => !s.previewOnly && s.duration >= 180000).length;
record(
  'getTrendingSongs()',
  trending.length >= 10 && trendFull >= 10 && trending.every(s => s.preview.startsWith('http')),
  `n=${trending.length} full=${trendFull} (chahiye: >=10 dono)`,
);

console.log(`\nprobe-search: ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exitCode = fail === 0 ? 0 : 1;
