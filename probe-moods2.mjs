/**
 * probe-moods2.mjs — Bhangra/Party/Sufi alternates tester (iTunes IN store).
 * Run: node probe-moods2.mjs
 * v1 finding: "punjabi sufi" weak tha (AP Dhillon/Diljit mix) — artist queries better.
 */
const CANDIDATES = [
  { key: 'BHANGRA-JazzyB', q: 'Jazzy B' },
  { key: 'BHANGRA-Malkit', q: 'Malkit Singh' },
  { key: 'BHANGRA-plain', q: 'Bhangra' },
  { key: 'PARTY-songs', q: 'punjabi party songs' },
  { key: 'PARTY-Garry', q: 'Garry Sandhu' },
  { key: 'PARTY-Diljit', q: 'Diljit party' },
  { key: 'SAD-Sidhu', q: 'Sidhu Moose Wala' },
  { key: 'SUFI-Sartaaj', q: 'Satinder Sartaaj' },
];

const LIMIT = 3;

for (const c of CANDIDATES) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(c.q)}&media=music&entity=song&limit=${LIMIT}&country=IN`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const json = await res.json();
    console.log(`\n[${c.key}] "${c.q}" -> ${json.resultCount} results`);
    for (const r of json.results ?? []) {
      console.log(`   ${r.trackName} | ${r.artistName} | preview=${r.previewUrl ? 'YES' : 'no'}`);
    }
  } catch (err) {
    console.log(`\n[${c.key}] "${c.q}" -> FAILED: ${err.message}`);
  }
}

console.log('\n--- mood alternate probe complete ---');
