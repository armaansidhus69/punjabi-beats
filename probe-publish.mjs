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
// Auth token bhi dummy — real token kabhi local test me nahi jaata.
process.env.PUBLISH_CLIENT_TOKEN = process.env.PUBLISH_CLIENT_TOKEN || 'local_dummy_publish_token';

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

async function callLocal(method, body, headers = {}) {
  const res = mockRes();
  await handler({ method, body, headers }, res);
  return { status: res.statusCode, body: res.body };
}

/** Dummy token ke saath valid auth header */
function authHeaders(token = process.env.PUBLISH_CLIENT_TOKEN) {
  return { 'x-publish-token': token };
}

async function localTests() {
  console.log('--- Local handler tests (dummy creds; real publish nahi hota) ---');

  // 1) GET → 405
  let r = await callLocal('GET', {});
  check('GET → 405', r.status === 405, `got ${r.status}`);

  // 2) POST with no fields → 400 (valid token ke saath)
  r = await callLocal('POST', {}, authHeaders());
  check('POST {} → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.body)}`);

  // 2b) 🔒 AUTH: bina token header → 401 (ye naya protection hai)
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' });
  check('POST valid body, NO token → 401 Unauthorized',
    r.status === 401 && r.body?.error === 'Unauthorized',
    `got ${r.status} ${JSON.stringify(r.body)}`);

  // 2c) 🔒 AUTH: galat token → 401
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' },
    authHeaders('wrong_token_definitely_not_valid'));
  check('POST valid body, WRONG token → 401', r.status === 401, `got ${r.status}`);

  // 2d) 🔒 AUTH: empty token → 401
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' }, authHeaders(''));
  check('POST valid body, EMPTY token → 401', r.status === 401, `got ${r.status}`);

  // 2e) auth precedence: valid token + invalid body → 400 (401 nahi)
  r = await callLocal('POST', {}, authHeaders());
  check('auth precedence: valid token + bad body → 400 (not 401)', r.status === 400, `got ${r.status}`);

  // 3) data null → 400 (missing-field check, valid token ke saath)
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: null }, authHeaders());
  check('data:null → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.body)}`);

  // 4) env vars missing → 500 + clear env message (Vercel misconfig ka asli roop)
  const saved = {};
  for (const k of ['APINATOR_APP_ID', 'APINATOR_KEY', 'APINATOR_SECRET']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' }, authHeaders());
  check('env missing → 500 (env message)', r.status === 500 && /env vars/.test(r.body?.error ?? ''), `got ${r.status} ${JSON.stringify(r.body)}`);
  process.env.APINATOR_APP_ID = 'app_dummy_local';
  process.env.APINATOR_KEY = 'apk_dummy_local';
  process.env.APINATOR_SECRET = 'secret_dummy_local';

  // 4b) PUBLISH_CLIENT_TOKEN missing → 500 (fail-closed, endpoint khula nahi rehna chahiye)
  const savedToken = process.env.PUBLISH_CLIENT_TOKEN;
  delete process.env.PUBLISH_CLIENT_TOKEN;
  r = await callLocal('POST', { channel: 'room-1', event: 'song-change', data: '{}' });
  check('PUBLISH_CLIENT_TOKEN missing → 500 (fail-closed, not open)',
    r.status === 500 && /PUBLISH_CLIENT_TOKEN/.test(r.body?.error ?? ''),
    `got ${r.status} ${JSON.stringify(r.body)}`);
  process.env.PUBLISH_CLIENT_TOKEN = savedToken;

  // 5) valid body + dummy creds → Apinator auth fail → 500 'Publish failed'
  r = await callLocal('POST', { channel: 'room-123456', event: 'song-change', data: JSON.stringify({ position: 0 }) }, authHeaders());
  check('valid POST (dummy creds) → 500 "Publish failed" (trigger tak pahuncha, auth fail expected)',
    r.status === 500 && r.body?.error === 'Publish failed', `got ${r.status} ${JSON.stringify(r.body)}`);

  // 6) object data → normalize hokar trigger tak jaata hai (400 nahi)
  r = await callLocal('POST', { channel: 'room-123456', event: 'playback-control', data: { playing: true } }, authHeaders());
  check('object data → 500 "Publish failed" (normalize OK, 400 nahi)',
    r.status === 500 && r.body?.error === 'Publish failed', `got ${r.status} ${JSON.stringify(r.body)}`);
}

async function liveTests(base) {
  const url = `${base.replace(/\/$/, '')}/api/publish`;
  console.log(`--- Live tests: ${url} ---`);

  // Token env se ya CLI se: PUBLISH_CLIENT_TOKEN=... node probe-publish.mjs --live <base>
  const liveToken = process.env.PUBLISH_CLIENT_TOKEN;
  const auth = token => ({ 'Content-Type': 'application/json', ...(token ? { 'x-publish-token': token } : {}) });

  let res = await fetch(url, { method: 'GET' });
  check('GET → 405', res.status === 405, `got ${res.status}`);

  // 🔒 401 check: valid body, NO token (ye tabhi 401 dega jab deployed version
  // auth rakhta ho; 500 matlab PUBLISH_CLIENT_TOKEN Vercel pe set nahi hai)
  res = await fetch(url, {
    method: 'POST',
    headers: auth(undefined),
    body: JSON.stringify({ channel: 'room-000000', event: 'song-change', data: JSON.stringify({ probe: true }) }),
  });
  check('POST valid body, NO token → 401 (auth deployed hai)',
    res.status === 401,
    `got ${res.status} — agar 500 hai to Vercel me PUBLISH_CLIENT_TOKEN set nahi hai`);

  res = await fetch(url, {
    method: 'POST',
    headers: auth('definitely_wrong_token'),
    body: JSON.stringify({ channel: 'room-000000', event: 'song-change', data: JSON.stringify({ probe: true }) }),
  });
  check('POST valid body, WRONG token → 401', res.status === 401, `got ${res.status}`);

  // 200 check: sahi token chahiye
  if (!liveToken) {
    console.log('  SKIP  valid-token → 200 (PUBLISH_CLIENT_TOKEN env me set nahi tha)');
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: auth(liveToken),
      body: JSON.stringify({ channel: 'room-000000', event: 'song-change', data: JSON.stringify({ probe: true }) }),
    });
    const j = await res.json().catch(() => null);
    check('POST valid token → 200 {success:true} (Apinator trigger ho gaya)',
      res.status === 200 && j?.success === true,
      `got ${res.status} ${JSON.stringify(j)} — token match karta hai? env vars set hain?`);
  }
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
