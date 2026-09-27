/**
 * probe-moods.mjs (v4) — mood queries candidate tester (iTunes IN store).
 * Run: node probe-moods.mjs
 *
 * Har candidate query ke top 3 results print karta hai, taaki constants/moods.ts
 * me sirf probe-verified queries hi rahein (v3 me "purani punjabi"/"punjabi sufi"
 * weak nikle the — artist-based queries better dete hain).
 */
const CANDIDATES = [
  { key: 'OLD', q: 'Gurdas Maan' },
  { key: 'OLD-2', q: 'Amrinder Gill' },
  { key: 'OLD-3', q: 'Babbu Maan' },
  { key: 'OLD-4', q: 'Hans Raj Hans' },
  { key: 'SUFI', q: 'Nusrat Fateh Ali Khan' },
  { key: 'SUFI-2', q: 'Satinder Sartaaj' },
  { key: 'SUFI-3', q: 'sufi punjabi kalam' },
  { key: 'ROMANTIC-2', q: 'Shubh' },
  { key: 'PARTY-2', q: 'Karan Aujla' },
  { key: 'BHANGRA-2', q: 'bhangra hits' },
  { key: 'FOLK-2', q: 'punjabi folk songs' },
  { key: 'SAD-2', q: 'sad punjabi songs' },
];

const LIMIT = 3;

for (const c of CANDIDATES) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(c.q)}&media=music&entity=song&limit=${LIMIT}&country=IN`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const json = await res.json();
    const rows = (json.results ?? []).map(r => `${r.trackName} | ${r.artistName}`);
    const withPreview = (json.results ?? []).filter(r => r.previewUrl).length;
    console.log(`\n[${c.key}] "${c.q}" -> ${json.resultCount} results (preview: ${withPreview}/${rows.length})`);
    for (const r of rows) console.log(`   ${r}`);
  } catch (err) {
    console.log(`\n[${c.key}] "${c.q}" -> FAILED: ${err.message}`);
  }
}

console.log('\n--- mood candidate probe complete ---');
