/**
 * Double-play fix ka logic test — playerStore loadAndPlaySong ka pattern
 * (generation token + serialized queue) yahan fake async create/unload se
 * simulate hota hai. Phone ke bina race-logic verify karne ke liye.
 *
 * Run: node test-loadqueue.mjs
 */
let loadGeneration = 0;
let loadQueue = Promise.resolve();
let active = null;
const created = [];
let doublePlays = 0;

async function load(id, createMs) {
  const token = ++loadGeneration;
  const run = loadQueue
    .catch(() => undefined)
    .then(async () => {
      if (token !== loadGeneration) return; // stale skip
      if (active) active.unloaded = true; // unloadCurrentSound
      active = null;
      await new Promise(r => setTimeout(r, createMs)); // Audio.Sound.createAsync
      const s = { id, unloaded: false };
      if (token !== loadGeneration) {
        void s; // stale — naya instance unload (yahan kuch nahi bachta)
        return;
      }
      active = s;
      created.push(s);
    });
  loadQueue = run;
  await run.catch(() => undefined);
}

function playingCount() {
  return created.filter(s => !s.unloaded).length + (active && !active.unloaded && !created.includes(active) ? 1 : 0);
}

(async () => {
  // Scenario 1: A ka load createAsync me hai (100ms), beech me B tap hua
  const p1 = load('A', 100);
  await new Promise(r => setTimeout(r, 5));
  const p2 = load('B', 10);
  await Promise.all([p1, p2]);
  const alive1 = created.filter(s => !s.unloaded);
  const s1 = active?.id === 'B' && alive1.length === 1 && alive1[0].id === 'B';
  console.log(`S1 rapid-tap: active=${active?.id} alive=${alive1.length} -> ${s1 ? 'PASS' : 'FAIL'}`);

  // Scenario 2: dono ek hi tick me queue hue (A ka run start hi na ho)
  active = null;
  created.length = 0;
  loadGeneration = 0;
  loadQueue = Promise.resolve();
  const q1 = load('C', 50);
  const q2 = load('D', 5);
  await Promise.all([q1, q2]);
  const alive2 = created.filter(s => !s.unloaded);
  const s2 = active?.id === 'D' && alive2.length === 1;
  console.log(`S2 queued-both: active=${active?.id} alive=${alive2.length} -> ${s2 ? 'PASS' : 'FAIL'}`);

  // Scenario 3: 5 rapid taps — sirf last hona chahiye
  active = null;
  created.length = 0;
  loadGeneration = 0;
  loadQueue = Promise.resolve();
  const taps = [];
  for (let i = 1; i <= 5; i++) taps.push(load('S' + i, 8));
  await Promise.all(taps);
  const alive3 = created.filter(s => !s.unloaded);
  const s3 = active?.id === 'S5' && alive3.length === 1;
  console.log(`S3 five-taps: active=${active?.id} alive=${alive3.length} -> ${s3 ? 'PASS' : 'FAIL'}`);

  doublePlays = [s1, s2, s3].filter(x => !x).length;
  console.log(doublePlays === 0 ? 'ALL SCENARIOS PASS — double-play nahi ho sakta' : 'FAILED');
  process.exit(doublePlays === 0 ? 0 : 1);
})();
