// probe-publish.mjs — api/publish.js ka self-test (root probe-*.mjs convention)
//
// Deploy SE PEHLE (local):  node probe-publish.mjs
//   → handler ko mock req/res pe call karta hai. Dummy creds force hoti hain,
//     toh koi REAL publish kabhi nahi hota (auth fail → 500 branch verify hota hai).
//
// Deploy KE BAAD (live):    node probe-publish.mjs --live https://YOUR-APP.vercel.app
//   → deployed /api/publish pe asli POST (405/400/200 checks + Apinator trigger).

// Local tests me real creds na jaayein isliye dummy FORCE (??= nahi)
process.env.APINATOR_APP_ID = 'app_dummy_local';
process.env.APINATOR_KEY = 'apk_dummy_local';
process.env.APINATOR_SECRET = 'secret_dummy_local';

// Import import-time env capture karta hai (Vercel cold start jaisa) — pehle env set, phir import
const { default: handler } = await import('./api/publish.js');

const args = process.argv.slice(2);
const liveIdx = args.indexOf('--live');
const liveBase = liveIdx >= 0 ? args[liveIdx + 1] : null;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} — ${detail}`); }
}

function mockRes() {
  const res = { statusCode: 0, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function callLocal(method, body) {
  const res = mockRes();
  await handler({ method, body }, res);
  return { status: res.statusCode, body: res.body };
}

async function localTests() {
  console.log('--- Local handler tests (dummy creds; real publish nahi hota) ---');

  // 1) GET → 405
  let r = await callLocal('GET', {});
  check('GET → 405', r.status === 405, `got ${r.status}`);

  // 2) POST with no fields → 400
  r = await callLocal('POST', {});
  check('POST {} → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.body)}`);

  // 3) data null → 400 (missing-field check)
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: null });
  check('data:null → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.body)}`);

  // 4) env vars missing → 500 + clear env message (Vercel misconfig ka asli roop)
  const saved = {};
  for (const k of ['APINATOR_APP_ID', 'APINATOR_KEY', 'APINATOR_SECRET']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' });
  check('env missing → 500 (env message)', r.status === 500 && /env vars/.test(r.body?.error ?? ''), `got ${r.status} ${JSON.stringify(r.body)}`);
  process.env.APINATOR_APP_ID = 'app_dummy_local';
  process.env.APINATOR_KEY = 'apk_dummy_local';
  process.env.APINATOR_SECRET = 'secret_dummy_local';

  // 5) valid body + dummy creds → Apinator auth fail → 500 'Publish failed'
  r = await callLocal('POST', { channel: 'room-123456', event: 'song-change', data: JSON.stringify({ position: 0 }) });
  check('valid POST (dummy creds) → 500 "Publish failed" (trigger tak pahuncha, auth fail expected)',
    r.status === 500 && r.body?.error === 'Publish failed', `got ${r.status} ${JSON.stringify(r.body)}`);

  // 6) object data → normalize hokar trigger tak jaata hai (400 nahi)
  r = await callLocal('POST', { channel: 'room-123456', event: 'playback-control', data: { playing: true } });
  check('object data → 500 "Publish failed" (normalize OK, 400 nahi)',
    r.status === 500 && r.body?.error === 'Publish failed', `got ${r.status} ${JSON.stringify(r.body)}`);
}

async function liveTests(base) {
  const url = `${base.replace(/\/$/, '')}/api/publish`;
  console.log(`--- Live tests: ${url} ---`);

  let res = await fetch(url, { method: 'GET' });
  check('GET → 405', res.status === 405, `got ${res.status}`);

  res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('POST {} → 400', res.status === 400, `got ${res.status}`);

  res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'room-000000', event: 'song-change', data: JSON.stringify({ probe: true }) }),
  });
  const j = await res.json().catch(() => null);
  check('POST valid → 200 {success:true} (Apinator trigger ho gaya)',
    res.status === 200 && j?.success === true,
    `got ${res.status} ${JSON.stringify(j)} — env vars set hain na? (Vercel logs dekho)`);
}

if (liveBase) {
  await liveTests(liveBase);
} else {
  await localTests();
}

if (failures) {
  console.log(`\n${failures} test FAILED`);
  process.exit(1);
}
console.log('\nAll tests PASSED');
