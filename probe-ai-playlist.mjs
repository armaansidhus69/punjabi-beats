// probe-ai-playlist.mjs — api/ai-playlist.js ka self-test (root probe-*.mjs convention)
//
// Deploy SE PEHLE (local):  node probe-ai-playlist.mjs
//   → handler ko mock req/res pe call karta hai. GEMINI_API_KEY dummy force
//     hoti hai (no Gemini call fails fast — fetch errors branch cover hota);
//     no_key / 405 / 400 / rate-limit branches yahin pure check hote.
//
// Deploy KE BAAD (guards):  node probe-ai-playlist.mjs --live https://punjabi-beats-api.vercel.app
// Full Gemini generation:   upar wale command ke end me `--generate` lagao.

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy_local_key_for_probe';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { default: handler } = await import('./api/ai-playlist.js');

const args = process.argv.slice(2);
const liveIdx = args.indexOf('--live');
const liveBase = liveIdx >= 0 ? args[liveIdx + 1] : null;
const generateLive = args.includes('--generate');

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} — ${detail}`); }
}

function mockRes() {
  const res = { statusCode: 0, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

async function callLocal(method, body) {
  const res = mockRes();
  await handler({ method, body }, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

async function localTests() {
  console.log('--- Local handler tests (dummy GEMINI key) ---');

  // 1) GET → 405
  let r = await callLocal('GET', {});
  check('GET → 405', r.status === 405, `got ${r.status}`);

  // 2) missing key → 400 no_key (fail-closed)
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  r = await callLocal('POST', { prompt: 'club banger', deviceId: 'dev-probe' });
  check('no GEMINI_API_KEY → 400 no_key', r.status === 400 && r.body?.error === 'no_key', `got ${r.status} ${JSON.stringify(r.body)}`);
  process.env.GEMINI_API_KEY = savedKey;

  // 3) bad inputs → 400 bad_request
  r = await callLocal('POST', { prompt: '', deviceId: 'dev-probe' });
  check('empty prompt → 400', r.status === 400 && r.body?.error === 'bad_request', `got ${r.status} ${JSON.stringify(r.body)}`);
  r = await callLocal('POST', { prompt: 'x'.repeat(300), deviceId: 'dev-probe' });
  check('too-long prompt → 400', r.status === 400, `got ${r.status}`);
  r = await callLocal('POST', { prompt: 'club', deviceId: '' });
  check('missing deviceId → 400', r.status === 400, `got ${r.status}`);

  // 4) rate limiting — 4 ok (dummy key pe upstream 502 bhi chalega), 5th blocked
  for (let index = 0; index < 4; index++) {
    r = await callLocal('POST', { prompt: `probe pressure ${index}`, deviceId: 'dev-rate' });
    check(`rate window hit ${index + 1} allowed`, r.status !== 429, `429 aa gaya hit ${index + 1} pe`);
  }
  r = await callLocal('POST', { prompt: 'probe pressure overflow', deviceId: 'dev-rate' });
  check('5th hourly hit → 429', r.status === 429 && r.body?.error === 'rate_limited', `got ${r.status} ${JSON.stringify(r.body)}`);
  check('Retry-After header set', typeof r.headers['Retry-After'] === 'string' && Number(r.headers['Retry-After']) > 0, `${JSON.stringify(r.headers)}`);

  console.log('NOTE: dummy GEMINI key ke saath 200-path nahi ho sakta — upstream 502 dikh sakta hai (fetch fail fast), wo hi live probe me verify hota hai.');
}

async function liveTests(base) {
  console.log(`--- Live probe: ${base}/api/ai-playlist ---`);
  const url = `${base.replace(/\/+$/, '')}/api/ai-playlist`;

  // 1) GET → 405
  let res = await fetchWithTimeout(url, { method: 'GET' });
  check('GET → 405', res.status === 405, `got ${res.status}`);

  // 2) empty prompt → 400 bad_request (key pehle check hoti hai)
  res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '', deviceId: 'probe-live' }),
  });
  check('empty prompt → 400', res.status === 400, `got ${res.status}`);
  const body = await res.json().catch(() => ({}));
  // no_key bhi yahin aata hai — deployment ke GEMINI env pe depend karta hai
  console.log(`  INFO  POST status ${res.status}, body ${JSON.stringify(body)}`);
  if (body?.error === 'no_key') {
    console.log('  WARN  GEMINI_API_KEY Vercel env me NAHI hai — user ke liye screen upsell dikhta rahega.');
  }

  if (!generateLive) {
    console.log('NOTE: real Gemini 200-path ke liye `--generate` add karo.');
    return;
  }

  res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'five upbeat Punjabi workout songs',
      deviceId: `probe-generate-${Date.now().toString(36)}`,
    }),
  });
  const generated = await res.json().catch(() => ({}));
  check('real generation → 200', res.status === 200, `got ${res.status} ${JSON.stringify(generated)}`);
  check(
    'real generation has tracks + disclosure',
    Array.isArray(generated?.tracks) && generated.tracks.length > 0 && generated.disclosure === true,
    JSON.stringify(generated),
  );
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

if (liveBase) {
  await liveTests(liveBase);
} else {
  await localTests();
}
console.log(failures === 0 ? '\nAll checks PASSED' : `\n${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
