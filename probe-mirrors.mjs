/**
 * probe-mirrors.mjs (v5) — JioSaavn mirror probe: DONO paths + shape + AUDIO check.
 * Run: node probe-mirrors.mjs
 *
 * v4 tak har mirror sirf ek path tha — 2026-09-28 pata chala alag mirrors alag
 * path aur alag response shape use karte hain. Aur sabse zaroori: kuch mirror
 * PERFECT metadata (320kbps downloadUrl tak) dete hain lekin CDN par file 404
 * hoti hai — sirf HTTP status dekh kar "WORKS" bolna galat hota.
 *
 * Isliye har candidate ke liye 3 cheezein report hoti hain:
 *   1. HTTP status (dono paths)
 *   2. response shape + kitne results me downloadUrl hai
 *   3. pehle download URL ka HEAD → audio zinda hai ya nahi (200/404)
 */
const TIMEOUT_MS = 8000;

const MIRRORS = [
  'https://jiosaavn-api-v3.vercel.app',
  'https://jiosaavn-api-sumitkolhe-v2.vercel.app',
  'https://saavn-api.vercel.app',
  'https://jiosaavn-api-2.vercel.app',
  'https://jiosaavn-api.vercel.app',
];
const PATHS = ['/api/search/songs', '/search/songs'];

/** alag mirrors alag wrapper shape dete hain */
function extractResults(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const nested = payload.data?.results ?? payload.results;
  return Array.isArray(nested) ? nested : [];
}

const cdnUrl = item => item?.url ?? item?.link ?? '';

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

async function probe(base, path) {
  const started = Date.now();
  const url = `${base}${path}?query=diljit&limit=5`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  } catch (err) {
    return { base, path, status: 'ERR', ms: Date.now() - started, n: 0, withDl: 0, audio: '-', note: err.name + ': ' + err.message };
  }

  let n = 0;
  let withDl = 0;
  let audio = '-';
  let note = '';
  try {
    const json = await res.json();
    const list = extractResults(json);
    n = list.length;
    withDl = list.filter(r => Array.isArray(r.downloadUrl) && r.downloadUrl.length > 0).length;
    if (withDl > 0) {
      const first = list.find(r => Array.isArray(r.downloadUrl) && r.downloadUrl.length);
      const dl = first.downloadUrl;
      const best = dl.find(d => d.quality === '320kbps') ?? dl[dl.length - 1];
      const u = cdnUrl(best);
      if (u) {
        const ok = await headOk(u);
        audio = ok ? 'AUDIO-OK' : 'AUDIO-404';
        note = ok ? 'playable' : 'metadata sahi par CDN 404 (stale links)';
      } else {
        audio = 'NO-URL';
        note = 'downloadUrl me url/link field hi nahi';
      }
    } else if (n > 0) {
      note = 'results hain par downloadUrl nahi (unusable)';
    } else {
      note = '0 results';
    }
  } catch {
    note = 'non-JSON body';
  }

  return { base, path, status: res.status, ms: Date.now() - started, n, withDl, audio, note };
}

console.log('\n=== JioSaavn mirror probe v5 — paths + shape + audio HEAD (live) ===\n');
const rows = [];
for (const base of MIRRORS) {
  for (const path of PATHS) rows.push(await probe(base, path));
}

for (const r of rows) {
  const usable = r.audio === 'AUDIO-OK';
  console.log(
    `${usable ? 'USABLE' : 'DEAD '} | ${String(r.status).padEnd(4)} | ${String(r.ms).padStart(5)}ms | ` +
    `${r.base}${r.path}`
  );
  console.log(`      -> results=${r.n} withDownloadUrl=${r.withDl} ${r.audio} ${r.note}`);
}

const usable = rows.filter(r => r.audio === 'AUDIO-OK');
console.log(`\nUsable mirrors: ${usable.length}/${rows.length}`);
console.log('(2026-09-28 truth: 3 mirrors 404, saavn-api me downloadUrl nahi, jiosaavn-api-2 metadata sahi par audio 404)');
console.log('app iske badle `probe-search.mjs` chalata hai — wahan audio guard ke baad ka final source dikhta hai.\n');
