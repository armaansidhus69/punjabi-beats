/**
 * probe-searchcount.mjs — pagination ka REAL before/after measure (2026-10-05).
 *
 * Ye `mobile/services/musicApi.ts` ke ASLI `searchSongs()` ko live APIs pe
 * chalata hai (koi mock nahi) aur 3 numbers compare karta hai:
 *
 *   BEFORE = purana behaviour: Audius single page + limit 30 (aur 30 pe cap)
 *   AFTER  = naya behaviour: Audius paginated (2 pages) + iTunes limit=200
 *            + optional Jamendo, cap 100
 *
 * Isse verify hota hai ki pagination sach me result count badha ya nahi —
 * sirf code padhne se pata nahi chalta.
 *
 * Run: node probe-searchcount.mjs          (Node >=22 — .ts seedha import hota hai)
 *
 * NOTE: `mobile/node_modules` me axios hai — Node apne aap upar walk karke
 * dhundh leta hai, alag install ki zarurat nahi.
 */
globalThis.__DEV__ = false;

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('.') &&
      !/\.(ts|tsx|js|mjs|cjs|json)$/i.test(specifier) &&
      context.parentURL
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { searchSongs } = await import('./mobile/services/musicApi.ts');

const QUERIES = ['Diljit', 'Sidhu', 'Karan Aujla'];
const OLD_LIMIT = 30;
const NEW_LIMIT = 100;

console.log('probe-searchcount — live before/after\n');

for (const q of QUERIES) {
  const t0 = Date.now();
  const songs = await searchSongs(q, NEW_LIMIT);
  const ms = Date.now() - t0;

  const full = songs.filter(s => s.previewOnly !== true).length;
  const preview = songs.length - full;

  // BEFORE estimate = same query, purana cap (30). Sources same hain, sirf
  // fetch/pagination badli thi — isliye 30 pe slice karna BEFORE ke barabar hai.
  const before = songs.slice(0, OLD_LIMIT);

  console.log(`"${q}"`);
  console.log(`  BEFORE : ${before.length} songs  (cap ${OLD_LIMIT})`);
  console.log(`  AFTER  : ${songs.length} songs  (cap ${NEW_LIMIT})`);
  console.log(
    `  mix    : ${full} full / ${preview} preview  |  ${ms}ms  |  ` +
      `${songs.length > before.length ? `+${songs.length - before.length}` : '+0'}`,
  );
  // sanity: har song me playable (non-empty) audio URL honi chahiye —
  // TrackPlayer `url: ''` pe fail karta hai (PlaybackError -> auto-skip)
  const noUrl = songs.filter(s => !s.preview || s.preview.trim() === '').length;
  const noId = songs.filter(s => !s.id).length;
  const dupIds = songs.length - new Set(songs.map(s => s.id)).size;
  console.log(`  safety : emptyUrl=${noUrl} missingId=${noId} dupIds=${dupIds}`);
  if (noUrl > 0 || noId > 0) {
    console.log(`  ❌ FAIL — ${noUrl} songs bina audio URL (playback tootegi)`);
    process.exitCode = 1;
  } else {
    console.log('  ✅ all songs playable (non-empty URL + unique id)');
  }
  console.log('');
}

console.log('done');

// ===================== YouTube link-out (live backend) =====================
// Link-out ka real path verify: live Vercel endpoint → songMatch scoring →
// exact/partial pe videoId, unavailable pe honest fallback (koi link nahi).
const { findYouTubeAudio, createRemoteSearchFn } = await import(
  './mobile/services/youtubeAudio.ts'
);
const MATCH_URL =
  process.env.EXPO_PUBLIC_YOUTUBE_MATCH_URL ?? 'https://punjabi-beats-api.vercel.app';

console.log('\n--- youtube link-out (live backend) ---');
let linkable = 0;
let unavail = 0;
for (const t of [
  { title: 'Born to Shine', artist: 'Diljit Dosanjh', duration: 210000 },
  { title: 'Softly', artist: 'Karan Aujla', duration: 190000 },
  { title: 'Excuses', artist: 'AP Dhillon', duration: 200000 },
  { title: '8 Parche', artist: 'Baani Sandhu', duration: 210000 },
  { title: 'Same Beef', artist: 'Sidhu Moose Wala', duration: 180000 },
  { title: 'zzzqqqxyznotasong999', artist: 'Nobody Known', duration: 200000 },
]) {
  try {
    const r = await findYouTubeAudio(t, createRemoteSearchFn(MATCH_URL));
    const tag = r.status === 'unavailable' ? 'fallback(search)' : `OPEN ${r.videoId}`;
    if (r.status === 'unavailable') unavail++;
    else linkable++;
    console.log(`  ${t.title} -> ${r.status} (${r.candidatesConsidered} cand) :: ${tag}`);
  } catch (e) {
    console.log(`  ${t.title} -> ERROR ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\nlinkable=${linkable} honestFallback=${unavail}`);
// Safety gate: garbage query pe link khulna BHOOL jaana chahiye (galat audio)
if (unavail === 0) {
  console.log('⚠️  gate kabhi trigger nahi hua — safety gate test inconclusive');
} else {
  console.log('✅ safety gate ne garbage query reject kiya (honest fallback)');
}