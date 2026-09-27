/**
 * probe-apis.mjs (v3) — iTunes IN-store mood + artist query tester
 * Run: node probe-apis.mjs
 * v2 result: US store = generic garbage results, IN store = perfect Punjabi.
 * v3: saare moods IN store pe + artist-based trending queries test.
 */
const LIMIT = 5;

const QUERIES = [
  { label: 'TRENDING-A (query)', term: 'punjabi hits', country: 'IN' },
  { label: 'TRENDING-B (artist)', term: 'Diljit Dosanjh', country: 'IN' },
  { label: 'TRENDING-C (artist)', term: 'AP Dhillon', country: 'IN' },
  { label: 'ROMANTIC', term: 'punjabi romantic', country: 'IN' },
  { label: 'SAD', term: 'sad punjabi', country: 'IN' },
  { label: 'BHANGRA', term: 'bhangra punjabi', country: 'IN' },
  { label: 'PARTY', term: 'punjabi party', country: 'IN' },
  { label: 'FOLK', term: 'punjabi folk', country: 'IN' },
  { label: 'SUFI', term: 'punjabi sufi', country: 'IN' },
  { label: 'OLD', term: 'purani punjabi', country: 'IN' },
  { label: 'OLD-alt (artist)', term: 'Gurdas Maan', country: 'IN' },
];

for (const q of QUERIES) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q.term)}&media=music&entity=song&limit=5&country=${q.country}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const json = await res.json();
    const results = json.results ?? [];
    console.log(`\n=== ${q.label} — "${q.term}" [${q.country}] → ${json.resultCount} results ===`);
    for (const r of results) {
      console.log(
        `  ${r.trackName} | ${r.artistName} | genre=${r.primaryGenreName} | preview=${r.previewUrl ? 'YES' : 'no'}`
      );
    }
  } catch (err) {
    console.log(`\n=== ${q.label} → FAILED: ${err.message} ===`);
  }
}

console.log('\n--- v3 probe complete ---');

// (v1 mirror-probe code removed — saare JioSaavn mirrors dead confirm ho gaye, 2026-09-24)