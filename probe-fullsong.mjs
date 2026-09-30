/**
 * probe-fullsong.mjs — KYUN 30s aa raha hai? (live diagnosis)
 * Run: node probe-fullsong.mjs
 *
 * Har app query (mood cards + home trending) pe compare karta hai:
 *   - Audius search  → full songs kitne (>=60s)  = chahiye zyada
 *   - iTunes search  → hamesha 30s preview       = fallback only
 * Saath me Audius `/tracks/trending` endpoint bhi test — home feed ke liye
 * query-independent full-song source.
 */
const AUDIUS = 'https://api.audius.co/v1';
const APP = 'punjabi-beats';
const ITUNES = 'https://itunes.apple.com/search';
const TIMEOUT = 12000;

/** constants/moods.ts + getTrendingSongs ke exact queries */
const QUERIES = [
  'punjabi hits',        // trending (home) + mood 'trending'
  'punjabi romantic',    // romantic
  'sad punjabi',         // sad
  'Jazzy B',             // bhangra
  'Diljit party',        // party
  'punjabi folk',        // folk
  'Satinder Sartaaj',    // sufi
  'Gurdas Maan',         // old
];

async function jget(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return { ok: false, status: r.status, data: null };
    return { ok: true, status: r.status, data: await r.json() };
  } catch (e) {
    return { ok: false, status: 0, err: `${e.name}` };
  } finally {
    clearTimeout(t);
  }
}

console.log('\n=== Full-song diagnosis (audius vs itunes, live) ===\n');
console.log('query'.padEnd(20), 'audius n/full'.padEnd(16), 'itunes n'.padEnd(10), 'verdict');

let audiusWins = 0;
for (const q of QUERIES) {
  const [a, i] = await Promise.all([
    jget(`${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=30&app_name=${APP}`),
    jget(`${ITUNES}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=30&country=IN`),
  ]);
  const aTracks = a.ok ? (a.data?.data ?? []) : [];
  const full = aTracks.filter(t => (Number(t.duration) || 0) >= 60).length;
  const iN = i.ok ? (i.data?.results ?? []).length : 0;
  const verdict = full >= 5 ? 'AUDIUS(full)' : full > 0 ? `itunes (audius=${full})` : 'ITUNES 30s!';
  if (full >= 5) audiusWins++;
  console.log(q.padEnd(20), `${aTracks.length}/${full}`.padEnd(16), String(iN).padEnd(10), verdict);
}

// Audius trending — query-independent full-song feed (home ke liye)
console.log('\n--- Audius /tracks/trending (home feed candidate) ---');
for (const time of ['week', 'month']) {
  const t = await jget(`${AUDIUS}/tracks/trending?time=${time}&limit=30&app_name=${APP}`);
  if (!t.ok) {
    console.log(`time=${time} => FAIL status=${t.status} ${t.err ?? ''}`);
    continue;
  }
  const list = t.data?.data ?? [];
  const full = list.filter(x => (Number(x.duration) || 0) >= 60);
  console.log(
    `time=${time} => n=${list.length} full(>=60s)=${full.length} artwork=${list.filter(x => x.artwork?.['480x480']).length}`,
  );
  if (full.length > 0) {
    console.log('   sample:', full.slice(0, 3).map(x => `${x.title} (${x.duration}s)`).join(' | '));
  }
}

console.log(`\naudius-qualified queries: ${audiusWins}/${QUERIES.length} (>=5 full songs)`);
console.log('Matlab: jitni queries 5 se kam full deti hain, app abhi 30s iTunes pe girti hai.\n');
process.exitCode = 0;
