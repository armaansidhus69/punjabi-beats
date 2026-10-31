// probe-ai-assistant.mjs — api/ai-assistant.js ka self-test (root probe convention)
//
// Deploy SE PEHLE (local):  node probe-ai-assistant.mjs
//   → handler mock req/res pe: 405 / no_key / bad_request / rate-limit 429
//     + Retry-After (dummy GEMINI key force — partial upstream fail bhi
//     honest branch hota hai).
//
// Deploy KE BAAD (guards):  node probe-ai-assistant.mjs --live https://punjabi-beats-api.vercel.app
// Full Gemini generation:   upar wale command ke end me `--generate` lagao.

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy_local_key_for_probe';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { default: handler } = await import('./api/ai-assistant.js');

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

  let r = await callLocal('GET', {});
  check('GET → 405', r.status === 405, `got ${r.status}`);

  // missing key fail-closed
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  r = await callLocal('POST', { message: 'pause karo', deviceId: 'dev-probe' });
  check('no GEMINI_API_KEY → 400 no_key', r.status === 400 && r.body?.error === 'no_key', `got ${r.status} ${JSON.stringify(r.body)}`);
  process.env.GEMINI_API_KEY = savedKey;

  // guards
  r = await callLocal('POST', { message: '', deviceId: 'dev-probe' });
  check('empty message → 400', r.status === 400 && r.body?.error === 'bad_request', `got ${r.status} ${JSON.stringify(r.body)}`);
  r = await callLocal('POST', { message: 'x'.repeat(300), deviceId: 'dev-probe' });
  check('too-long message → 400', r.status === 400, `got ${r.status}`);
  r = await callLocal('POST', { message: 'hi', deviceId: '' });
  check('missing deviceId → 400', r.status === 400, `got ${r.status}`);

  // rate limit — 5th hourly blocked, Retry-After header
  for (let index = 0; index < 5; index++) {
    r = await callLocal('POST', { message: `probe chat ${index}`, deviceId: 'dev-rate' });
    check(`rate window hit ${index + 1} allowed`, r.status !== 429, `429 aa gaya hit ${index + 1} pe`);
  }
  r = await callLocal('POST', { message: 'probe chat overflow', deviceId: 'dev-rate' });
  check('6th hourly hit → 429', r.status === 429 && r.body?.error === 'rate_limited', `got ${r.status} ${JSON.stringify(r.body)}`);
  check('Retry-After header set', typeof r.headers['Retry-After'] === 'string' && Number(r.headers['Retry-After']) > 0, `${JSON.stringify(r.headers)}`);

  console.log('NOTE: dummy key pe 200-path nahi — upstream 502 hota hai (fetch fail fast); asli generation live probe/screen pe verify karo.');
}

async function liveTests(base) {
  console.log(`--- Live probe: ${base}/api/ai-assistant ---`);
  const url = `${base.replace(/\/+$/, '')}/api/ai-assistant`;

  let res = await fetchWithTimeout(url, { method: 'GET' });
  check('GET → 405', res.status === 405, `got ${res.status}`);

  res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '', deviceId: 'probe-live' }),
  });
  check('empty message → 400', res.status === 400, `got ${res.status}`);
  const body = await res.json().catch(() => ({}));
  console.log(`  INFO  POST status ${res.status}, body ${JSON.stringify(body)}`);
  if (body?.error === 'no_key') {
    console.log('  WARN  GEMINI_API_KEY Vercel env me NAHI hai — assistant 400 no_key dega.');
  }

  if (!generateLive) {
    console.log('NOTE: real Gemini 200-path ke liye `--generate` add karo.');
    return;
  }

  res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'Recommend one upbeat Punjabi song',
      deviceId: `probe-generate-${Date.now().toString(36)}`,
    }),
  });
  const generated = await res.json().catch(() => ({}));
  check('real generation → 200', res.status === 200, `got ${res.status} ${JSON.stringify(generated)}`);
  check(
    'real generation has action + reply + disclosure',
    typeof generated?.action === 'string' &&
      typeof generated?.reply === 'string' &&
      generated.disclosure === true,
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
