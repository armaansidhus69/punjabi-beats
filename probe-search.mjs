/**
 * probe-search.mjs — LIVE end-to-end test of the real `searchSongs()` chain.
 * Node 23.6+ type-stripping se musicApi.ts seedha import hota hai (jaise
 * test-logic.mjs pure utils karta hai) — yahan asli axios + asli APIs.
 *
 * Run: node probe-search.mjs
 *
 * Check karta hai:
 *   - kaunsa source chala (console me [musicApi] line)
 *   - full song (>180s) mili ya sirf 30s preview
 *   - previewOnly flag UI badge se match karta hai
 */
import { searchSongs } from './mobile/services/musicApi.ts';

const CASES = [
  { q: 'Diljit', expect: 'full' },
  { q: 'Karan Aujla', expect: 'full' },
  { q: 'Sidhu Moose Wala', expect: 'full' },
  { q: 'Satinder Sartaaj', expect: 'full' },
  { q: 'punjabi hits', expect: 'mixed-or-preview' },
  { q: 'Diljit party', expect: 'preview' },
  { q: 'Gurdas Maan', expect: 'preview' },
  // iTunes fuzzy matching hai — "xyzabc" pe bhi 3 real tracks milte hain
  // (El Vato Base / Sublee). Guarantee ye hai ki garbage query pe koi FULL song
  // nahi aata: Audius ke 20s clips 60s filter se kat jaate hain.
  { q: 'xyzabc', expect: 'preview' },
  { q: '', expect: 'empty' },
];

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const songs = await searchSongs(c.q, 30);
  const full = songs.filter(s => !s.previewOnly && s.duration >= 180000).length;
  const preview = songs.filter(s => s.previewOnly).length;
  const longest = songs.reduce((m, s) => Math.max(m, s.duration), 0);
  const sources = [...new Set(songs.map(s => s.previewOnly ? 'itunes' : 'audius/js'))].join('+') || 'none';

  let ok = false;
  if (c.expect === 'empty') ok = songs.length === 0;
  else if (c.expect === 'full') ok = full >= 5;
  else if (c.expect === 'preview') ok = songs.length > 0 && full === 0;
  else if (c.expect === 'mixed-or-preview') ok = songs.length > 0;

  // Har result pe playback URL + previewOnly consistency
  const consistent = songs.every(s => s.preview.startsWith('http') && (s.previewOnly === true || s.duration >= 60000));

  const verdict = ok && consistent ? 'PASS' : 'FAIL';
  if (verdict === 'PASS') pass++;
  else fail++;

  console.log(
    `  ${verdict} | "${c.q}" | n=${songs.length} full=${full} preview=${preview} ` +
    `longest=${Math.round(longest / 1000)}s src=${sources}${consistent ? '' : ' | INCONSISTENT'}`
  );
  if (songs.length > 0) {
    const first = songs[0];
    console.log(`         first: ${first.title.slice(0, 50)} — ${first.artist} — ${Math.round(first.duration / 1000)}s previewOnly=${first.previewOnly}`);
  }
}

console.log(`\nprobe-search: ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exitCode = fail === 0 ? 0 : 1;
