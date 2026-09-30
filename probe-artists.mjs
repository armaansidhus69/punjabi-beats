/**
 * probe-artists.mjs — Punjabi artist roster on Audius (live).
 * Run: node probe-artists.mjs
 *
 * Purpose: trending/mood feed ke liye wo artists chahiye jinke search se
 * Audius pe >=5 FULL songs (60s+) aate hain. Ye list getTrendingSongs ke
 * artist-rotation me use hoti hai.
 */
const AUDIUS = 'https://api.audius.co/v1';
const APP = 'punjabi-beats';
const TIMEOUT = 12000;

const ARTISTS = [
  'Diljit Dosanjh',
  'Sidhu Moose Wala',
  'Karan Aujla',
  'AP Dhillon',
  'Shubh',
  'Jazzy B',
  'Ammy Virk',
  'Guru Randhawa',
  'Kulbir Jhinjer',
  'Ninja',
  'Gurdas Maan',
  'Satinder Sartaaj',
  'Bohemia',
  'Yo Yo Honey Singh',
  'Badshah',
  'Karan Aujla songs',
  'Amrit Maan',
  'Jass Manak',
];

async function jget(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, err: `${e.name}` };
  } finally {
    clearTimeout(t);
  }
}

console.log('\n=== Audius artist roster (full songs >=60s) ===\n');
const qualified = [];
for (const a of ARTISTS) {
  const r = await jget(`${AUDIUS}/tracks/search?query=${encodeURIComponent(a)}&limit=30&app_name=${APP}`);
  const list = r.ok ? (r.data?.data ?? []) : [];
  const full = list.filter(t => (Number(t.duration) || 0) >= 60);
  const mark = full.length >= 5 ? 'QUALIFIED' : full.length > 0 ? 'weak     ' : 'none     ';
  if (full.length >= 5) qualified.push(a);
  console.log(`${mark} ${a.padEnd(20)} n=${String(list.length).padEnd(3)} full=${full.length}`);
}

console.log(`\nqualified (>=5 full): ${qualified.length}`);
console.log(JSON.stringify(qualified, null, 2));
console.log('');
process.exitCode = 0;
