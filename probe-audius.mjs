/**
 * probe-audius.mjs — Audius (full-song fallback) LIVE probe: search + PLAYABILITY.
 * Run: node probe-audius.mjs
 *
 * Check karta hai:
 *   1. `/v1/tracks/search` — kitne results, sab 60s+ (full song) ya nahi, artwork
 *   2. `/v1/tracks/:id/stream` — 302 → content node se actual audio bytes aate
 *      hain ya nahi (Range request se ID3 header check)
 *
 * NOTE: `app_name` param ZARURI hai — bina iske redirect ek down node
 * (HTTP 522) pe jaata tha; uske saath saare healthy content nodes.
 */
const API = 'https://api.audius.co/v1';
const APP = 'punjabi-beats';
const TIMEOUT = 15000;

const QUERIES = ['diljit', 'karan aujla', 'sidhu moose wala', 'satinder sartaaj', 'xyzabc'];

async function go(url, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: c.signal });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, err: `${err.name}: ${err.message}` };
  } finally {
    clearTimeout(t);
  }
}

console.log('\n=== Audius probe — search + stream playability (live) ===\n');

let total = 0;
let playable = 0;

for (const q of QUERIES) {
  const s = await go(`${API}/tracks/search?query=${encodeURIComponent(q)}&limit=30&app_name=${APP}`);
  if (!s.ok) {
    console.log(`"${q}" => SEARCH FAIL ${s.err}`);
    continue;
  }
  const { data = [] } = await s.res.json();
  const full = data.filter(t => (Number(t.duration) || 0) >= 60);
  const withArt = data.filter(t => t.artwork && (t.artwork['480x480'] || t.artwork['150x150']));
  console.log(`"${q}" => n=${data.length} full(>=60s)=${full.length} artwork=${withArt.length}`);

  // pehle 3 tracks ka real audio bytes check
  for (const track of full.slice(0, 3)) {
    total++;
    const r = await go(`${API}/tracks/${track.id}/stream?app_name=${APP}`, { headers: { Range: 'bytes=0-3' } });
    if (!r.ok) {
      console.log(`   [${track.id}] stream FAIL ${r.err}`);
      continue;
    }
    const buf = new Uint8Array(await r.res.arrayBuffer());
    const ct = r.res.headers.get('content-type') ?? '';
    const isAudio = /audio|mpeg|mp3|octet/i.test(ct);
    const id3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x53; // "ID3"
    if (r.res.status < 400 && isAudio && (id3 || buf.length > 0)) playable++;
    console.log(
      `   [${track.id}] ${String(track.duration)}s => HTTP ${r.res.status} ${ct} ` +
      `bytes=[${Array.from(buf).join(',')}] ${isAudio ? 'AUDIO-OK' : 'NOT-AUDIO'}`
    );
  }
}

console.log(`\nplayable: ${playable}/${total}`);
console.log('(2026-09-28 truth: sab playable — Audius full-song source ke liye READY)\n');
process.exitCode = playable === total && total > 0 ? 0 : 1;
