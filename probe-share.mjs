// probe-share.mjs — Phase 8a handler self-test + optional deployed guard smoke.
//
// Local: node probe-share.mjs
// Live guards: node probe-share.mjs --live https://your-vercel-app.vercel.app
// Live create: PUBLISH_CLIENT_TOKEN=... same command (value kabhi log nahi hoti).

const liveClientToken = process.env.PUBLISH_CLIENT_TOKEN ?? '';
process.env.SHARE_SIGNING_SECRET = 'probe-secret-'.padEnd(40, 'x');
process.env.SHARE_PUBLIC_BASE_URL = 'https://share-probe.example';
process.env.PUBLISH_CLIENT_TOKEN = 'probe-client-token';

const { default: handler } = await import('./api/share.js');
const { SHARE_TTL_SEC, signSharePayload } = await import('./api/_shareCore.js');

const args = process.argv.slice(2);
const liveIndex = args.indexOf('--live');
const liveBase = liveIndex >= 0 ? args[liveIndex + 1] : null;

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

function mockRes() {
  const res = { statusCode: 0, body: undefined, headers: {}, ended: false };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.send = body => { res.body = body; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}

async function call(method, { body = {}, query = {}, headers = {}, ip = '127.0.0.1' } = {}) {
  const res = mockRes();
  await handler({ method, body, query, headers, socket: { remoteAddress: ip } }, res);
  return res;
}

function validBody(deviceId = 'probe-device', title = 'Softly') {
  return {
    kind: 'track',
    data: { title, artist: 'Karan Aujla', cover: 'https://img.example/cover.jpg' },
    deviceId,
  };
}

async function localProbe() {
  console.log('--- Share handler local probe ---');

  let res = await call('OPTIONS');
  check('OPTIONS → 204 CORS', res.statusCode === 204 && res.headers['Access-Control-Allow-Origin'] === '*', `${res.statusCode}`);

  res = await call('PUT');
  check('PUT → 405', res.statusCode === 405, `${res.statusCode}`);

  const secret = process.env.SHARE_SIGNING_SECRET;
  process.env.SHARE_SIGNING_SECRET = '';
  res = await call('GET', { query: { token: 'bad', format: 'json' } });
  check('missing env → 500 no_key', res.statusCode === 500 && res.body?.error === 'no_key', `${res.statusCode} ${JSON.stringify(res.body)}`);
  process.env.SHARE_SIGNING_SECRET = secret;

  res = await call('POST', { body: validBody(), headers: {} });
  check('unauthorized POST → 401', res.statusCode === 401 && res.body?.error === 'unauthorized', `${res.statusCode}`);

  res = await call('POST', {
    body: { kind: 'room', data: { code: 'bad' }, deviceId: 'bad-device' },
    headers: { 'x-publish-token': process.env.PUBLISH_CLIENT_TOKEN },
  });
  check('bad schema → 400', res.statusCode === 400 && res.body?.error === 'bad_request', `${res.statusCode}`);

  res = await call('POST', {
    body: validBody('create-device', '<b>Softly</b>'),
    headers: { 'x-publish-token': process.env.PUBLISH_CLIENT_TOKEN },
  });
  check('valid POST creates token', res.statusCode === 200 && /^v1\./.test(res.body?.token ?? ''), `${res.statusCode} ${JSON.stringify(res.body)}`);
  check('create URL pinned to public base', res.body?.url?.startsWith('https://share-probe.example/api/share?token='), res.body?.url);
  const token = res.body?.token;

  res = await call('GET', { query: { token, format: 'json' } });
  check('GET JSON resolves payload', res.statusCode === 200 && res.body?.payload?.kind === 'track', `${res.statusCode} ${JSON.stringify(res.body)}`);
  check('GET JSON no-store', res.headers['Cache-Control'] === 'private, no-store', JSON.stringify(res.headers));

  res = await call('GET', { query: { token } });
  check('GET HTML preview', res.statusCode === 200 && typeof res.body === 'string' && res.body.includes('og:title'), `${res.statusCode}`);
  check('HTML escapes title', !res.body.includes('<b>Softly</b>') && res.body.includes('&lt;b&gt;Softly&lt;/b&gt;'), 'unsafe/raw title');
  check('HTML security headers', typeof res.headers['Content-Security-Policy'] === 'string' && res.headers['X-Content-Type-Options'] === 'nosniff', JSON.stringify(res.headers));

  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  res = await call('GET', { query: { token: tampered, format: 'json' } });
  check('tampered token → 400', res.statusCode === 400 && res.body?.error === 'invalid', `${res.statusCode}`);

  const now = Math.floor(Date.now() / 1000);
  const expiredPayload = {
    v: 1,
    kind: 'track',
    data: { title: 'Old', artist: 'Artist' },
    iat: now - SHARE_TTL_SEC,
    exp: now - 1,
  };
  const expired = signSharePayload(expiredPayload, process.env.SHARE_SIGNING_SECRET);
  res = await call('GET', { query: { token: expired, format: 'json' } });
  check('expired token → 410', res.statusCode === 410 && res.body?.error === 'expired', `${res.statusCode} ${JSON.stringify(res.body)}`);

  res = await call('POST', {
    body: {
      kind: 'lyrics',
      data: {
        title: 'Softly',
        artist: 'Karan Aujla',
        lines: ['<Dil & beat>', 'Second line'],
        startMs: 0,
      },
      deviceId: 'lyrics-device',
    },
    headers: { 'x-publish-token': process.env.PUBLISH_CLIENT_TOKEN },
  });
  check('lyrics POST creates token', res.statusCode === 200 && /^v1\./.test(res.body?.token ?? ''), `${res.statusCode}`);
  const lyricsToken = res.body?.token;
  res = await call('GET', { query: { token: lyricsToken, format: 'json' } });
  check('lyrics JSON keeps timestamp zero', res.statusCode === 200 && res.body?.payload?.kind === 'lyrics' && res.body?.payload?.data?.startMs === 0, JSON.stringify(res.body));
  res = await call('GET', { query: { token: lyricsToken } });
  check('lyrics HTML escaped', res.statusCode === 200 && !res.body.includes('<Dil & beat>') && res.body.includes('&lt;Dil &amp; beat&gt;'), `${res.statusCode}`);

  for (let index = 0; index < 30; index += 1) {
    res = await call('POST', {
      body: validBody('rate-device'),
      headers: { 'x-publish-token': process.env.PUBLISH_CLIENT_TOKEN },
      ip: '10.0.0.8',
    });
    check(`rate hit ${index + 1} allowed`, res.statusCode === 200, `got ${res.statusCode}`);
  }
  res = await call('POST', {
    body: validBody('rate-device'),
    headers: { 'x-publish-token': process.env.PUBLISH_CLIENT_TOKEN },
    ip: '10.0.0.8',
  });
  check('31st hourly POST → 429', res.statusCode === 429 && res.body?.error === 'rate_limited', `${res.statusCode}`);
  check('Retry-After set', Number(res.headers['Retry-After']) > 0, JSON.stringify(res.headers));
}

async function liveProbe(base) {
  const url = `${base.replace(/\/+$/, '')}/api/share`;
  console.log(`--- Share deployed guard probe: ${url} ---`);
  let response = await fetchWithTimeout(url, { method: 'OPTIONS' });
  check('live OPTIONS → 204', response.status === 204, `got ${response.status}`);
  response = await fetchWithTimeout(`${url}?token=invalid&format=json`);
  check('live invalid token rejected', response.status === 400 || response.status === 500, `got ${response.status}`);
  const body = await response.json().catch(() => ({}));
  if (body?.error === 'no_key') console.log('  WARN  SHARE_SIGNING_SECRET/SHARE_PUBLIC_BASE_URL/PUBLISH_CLIENT_TOKEN missing');
  if (!liveClientToken) {
    console.log('  INFO  PUBLISH_CLIENT_TOKEN missing locally; authorized create/resolve skipped');
    return;
  }

  response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-publish-token': liveClientToken,
    },
    body: JSON.stringify(validBody(`probe-live-${Date.now().toString(36)}`)),
  });
  const created = await response.json().catch(() => ({}));
  check('live authorized POST creates token', response.status === 200 && /^v1\./.test(created?.token ?? ''), `got ${response.status}`);
  if (response.status !== 200 || typeof created?.token !== 'string') return;

  response = await fetchWithTimeout(`${url}?token=${encodeURIComponent(created.token)}&format=json`);
  const resolved = await response.json().catch(() => ({}));
  check(
    'live token resolves strict track payload',
    response.status === 200 && resolved?.payload?.kind === 'track' && resolved?.payload?.data?.title === 'Softly',
    `got ${response.status}`,
  );
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

if (liveBase) await liveProbe(liveBase);
else await localProbe();

console.log(failures === 0 ? '\nAll checks PASSED' : `\n${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
