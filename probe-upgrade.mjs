/**
 * probe-upgrade.mjs — iTunes 30s results ko FULL song me upgrade kar sakte hain?
 * Run: node probe-upgrade.mjs
 *
 * 3 failing queries pe 3 strategies test:
 *   S1: Audius search = iTunes top ARTIST name
 *   S2: Audius search = "${trackName} ${artistName}"  (per-song upgrade)
 *   S3: Audius search = trackName only
 * Match: normalized title prefix/equality (full song tab mana jab title mel jaaye).
 *
 * Saath me official JioSaavn web endpoint bhi check (mirrors dead hain, isliye).
 */
const AUDIUS = 'https://api.audius.co/v1';
const APP = 'punjabi-beats';
const ITUNES = 'https://itunes.apple.com/search';
const TIMEOUT = 12000;

const QUERIES = ['Diljit party', 'Gurdas Maan', 'punjabi hits'];

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

const norm = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9਀-੿]+/g, '')
    .trim();

/** kya Audius track ka title iTunes title se match karta hai (full version) */
function titleMatches(iTunesTitle, audiusTitle) {
  const a = norm(iTunesTitle);
  const b = norm(audiusTitle);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a) || (a.length > 6 && b.includes(a)) || (b.length > 6 && a.includes(b));
}

async function audiusSearch(q, limit = 30) {
  const r = await jget(`${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=${limit}&app_name=${APP}`);
  if (!r.ok) return [];
  return (r.data?.data ?? []).filter(t => (Number(t.duration) || 0) >= 60);
}

console.log('\n=== Upgrade probe: iTunes 30s -> Audius full song ===\n');

for (const q of QUERIES) {
  const it = await jget(`${ITUNES}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=15&country=IN`);
  const results = it.ok ? (it.data?.results ?? []).filter(r => r.previewUrl && r.trackName) : [];
  console.log(`\n### "${q}" — itunes n=${results.length}`);

  // S1: top artist se search
  const topArtist = results[0]?.artistName;
  if (topArtist) {
    const hits = await audiusSearch(topArtist);
    console.log(`  S1 artist "${topArtist}" => ${hits.length} full`);
    if (hits.length) console.log(`      e.g. ${hits.slice(0, 3).map(h => `${h.title} (${h.duration}s)`).join(' | ')}`);
  }

  // S2/S3: top 6 songs ka per-song upgrade
  let upgraded = 0;
  for (const r of results.slice(0, 6)) {
    const byBoth = await audiusSearch(`${r.trackName} ${r.artistName}`);
    const hit =
      byBoth.find(t => titleMatches(r.trackName, t.title)) ??
      (await audiusSearch(r.trackName)).find(t => titleMatches(r.trackName, t.title));
    if (hit) {
      upgraded++;
      console.log(`  S2 "${r.trackName}" => ${hit.title} (${hit.duration}s) FULL`);
    } else {
      console.log(`  S2 "${r.trackName}" => miss`);
    }
  }
  console.log(`  => upgraded ${upgraded}/${Math.min(6, results.length)}`);
}

// Official JioSaavn web API (mirrors dead, isliye source check)
console.log('\n=== Official jiosaavn.com web endpoint (bonus check) ===');
const SA = await jget('https://www.jiosaavn.com/api/search/songs?query=diljit&_format=json&_marker=0');
console.log(`search => status=${SA.status ?? 'ERR'} ok=${SA.ok}`);
if (SA.ok) {
  const list = SA.data?.data ?? SA.data?.results ?? [];
  console.log(`  n=${Array.isArray(list) ? list.length : 'n/a'} keys=${Object.keys(SA.data ?? {}).join(',')}`);
}
console.log('\ndone\n');
process.exitCode = 0;
