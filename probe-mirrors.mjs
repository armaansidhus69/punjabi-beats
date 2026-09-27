/**
 * probe-mirrors.mjs (v4) — JioSaavn / saavn.dev ke SAARE known endpoints live probe.
 * Run: node probe-mirrors.mjs
 *
 * Report karta hai per endpoint: WORKS / DEAD + status + latency + reason.
 * v3 tak: saavn.dev (dono paths) aur saare vercel mirrors dead the — yeh script
 * current truth verify karta hai (2026-09-25).
 */
const TIMEOUT_MS = 8000;

/** Har entry: name + URL + response me song-ish data kaise dhoondein */
const TARGETS = [
  {
    name: 'saavn.dev  /api/search/songs',
    url: 'https://saavn.dev/api/search/songs?query=diljit&limit=3',
    results: b => b?.data?.results,
  },
  {
    name: 'saavn.dev  /api/search         ',
    url: 'https://saavn.dev/api/search?query=diljit',
    results: b => b?.data?.songs?.results,
  },
  {
    name: 'saavn.dev  /api/search?query   ',
    url: 'https://saavn.dev/api/search?query=diljit&type=songs',
    results: b => b?.data?.songs?.results ?? b?.data?.results,
  },
  {
    name: 'saavn.dev  /search/songs       ',
    url: 'https://saavn.dev/search/songs?query=diljit&limit=3',
    results: b => b?.data?.results,
  },
  {
    name: 'saavn.dev  /api/songs/:id      ',
    url: 'https://saavn.dev/api/songs/3IoDK8qI',
    results: b => b?.data,
  },
  {
    name: 'sumitkolhe /api/search/songs   ',
    url: 'https://jiosaavn-api-sumitkolhe.vercel.app/api/search/songs?query=diljit&limit=3',
    results: b => b?.data?.results,
  },
  {
    name: 'sumitkolhe /search/songs       ',
    url: 'https://jiosaavn-api-sumitkolhe.vercel.app/search/songs?query=diljit',
    results: b => b?.data?.results,
  },
  {
    name: 'saavn.me   /search/songs       ',
    url: 'https://saavn.me/search/songs?query=diljit&limit=3',
    results: b => b?.data?.results,
  },
  {
    name: 'jiosaavn-api-v3.vercel.app     ',
    url: 'https://jiosaavn-api-v3.vercel.app/search/songs?query=diljit',
    results: b => b?.data?.results,
  },
  {
    name: 'jiosaavn-api-ts.vercel.app     ',
    url: 'https://jiosaavn-api-ts.vercel.app/search/songs?query=diljit',
    results: b => b?.data?.results,
  },
  {
    name: 'saavn-api-2024.vercel.app      ',
    url: 'https://saavn-api-2024.vercel.app/search/songs?query=diljit',
    results: b => b?.data?.results,
  },
  {
    name: 'jiosavan-api.vercel.app        ',
    url: 'https://jiosavan-api.vercel.app/search/songs?query=diljit',
    results: b => b?.data?.results,
  },
  {
    name: 'iTunes     /search (baseline)   ',
    url: 'https://itunes.apple.com/search?term=diljit&media=music&entity=song&limit=3&country=IN',
    results: b => b?.results?.filter(r => r.previewUrl),
  },
];

async function probe(target) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'punjabi-beats-probe/4.0' },
    });
    const text = await res.text();
    let note = `body: ${text.slice(0, 70).replace(/\s+/g, ' ')}`;
    let count = 0;
    try {
      const json = JSON.parse(text);
      const results = target.results(json);
      count = Array.isArray(results) ? results.length : results ? 1 : 0;
      note = count > 0 ? `${count} playable results` : 'valid JSON, lekin 0 results';
    } catch {
      /* note already set to raw body */
    }
    return { name: target.name, status: res.status, ms: Date.now() - started, ok: res.ok && count > 0, note };
  } catch (err) {
    return {
      name: target.name,
      status: 'ERR',
      ms: Date.now() - started,
      ok: false,
      note: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const rows = await Promise.all(TARGETS.map(probe));

console.log('\n=== JioSaavn / saavn.dev endpoint probe (live, 2026-09-25) ===\n');
for (const r of rows) {
  console.log(`${r.ok ? 'WORKS' : 'DEAD '} | ${String(r.status).padEnd(4)} | ${String(r.ms).padStart(5)}ms | ${r.name}`);
  console.log(`      -> ${r.note}`);
}

const working = rows.filter(r => r.ok);
console.log(`\nWorking: ${working.length}/${rows.length}`);
for (const w of working) console.log(`  * ${w.name.trim()}  (${w.note})`);
console.log('');
