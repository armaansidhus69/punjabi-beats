// probe-lyrics.mjs — Phase 7a pure parser self-test + optional LRCLIB live probe.
//
// Local (deterministic, no network): node probe-lyrics.mjs
// Live keyless API:                 node probe-lyrics.mjs --live https://lrclib.net

import { lineAt, parseLrc } from './mobile/core/lyrics/lyrics.ts';

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

function localProbe() {
  console.log('--- Lyrics pure-core probe ---');
  const lines = parseLrc([
    '[ar:Probe Artist]',
    '[00:02.00][00:04.00] chorus',
    '[00:03.50] verse',
    'junk',
  ].join('\n'));
  check('LRC expands multi-timestamp lines', lines.length === 3, `got ${lines.length}`);
  check('LRC output is time-sorted', lines.map(line => line.timeMs).join(',') === '2000,3500,4000', JSON.stringify(lines));
  check('lineAt resolves latest boundary', lineAt(lines, 3750) === 1, `got ${lineAt(lines, 3750)}`);
}

async function liveProbe(base) {
  console.log(`--- LRCLIB live probe: ${base} ---`);
  const url = new URL('/api/get', base.replace(/\/+$/, ''));
  url.searchParams.set('artist_name', 'Borislav Slavov');
  url.searchParams.set('track_name', 'I Want to Live');
  url.searchParams.set('duration', '233');

  try {
    const response = await fetchWithRetry(url);
    const retryAfter = response.headers.get('Retry-After');
    check('GET /api/get → 200', response.status === 200, `got ${response.status}${retryAfter ? `; retry-after=${retryAfter}` : ''}`);
    if (!response.ok) return;
    const payload = await response.json();
    check('response has track metadata', typeof payload?.trackName === 'string' && typeof payload?.artistName === 'string', JSON.stringify(payload));
    check('response has lyrics', typeof payload?.syncedLyrics === 'string' || typeof payload?.plainLyrics === 'string', 'both lyrics fields missing');
    if (typeof payload?.syncedLyrics === 'string') {
      check('live synced LRC parses', parseLrc(payload.syncedLyrics).length > 0, 'parser returned zero lines');
    }
  } catch (err) {
    check('live request completed', false, err instanceof Error ? err.message : String(err));
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'Lrclib-Client': 'PunjabiBeats probe v1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1000, Math.ceil(seconds * 1000));
  const dateMs = Date.parse(value ?? '');
  return Number.isFinite(dateMs) ? Math.max(1000, dateMs - Date.now()) : 1000;
}

async function fetchWithRetry(url) {
  let response = await fetchWithTimeout(url);
  if (response.status !== 429 && response.status !== 503) return response;

  const baseDelay = retryAfterMs(response.headers.get('Retry-After'));
  // Probe ko bahut der block nahi karna; long window ho to status report hi karo.
  if (baseDelay > 10_000) return response;
  await response.body?.cancel();
  const jitter = Math.round(baseDelay * Math.random() * 0.3);
  console.log(`  INFO  ${response.status}; Retry-After honor (${baseDelay + jitter}ms)`);
  await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
  response = await fetchWithTimeout(url);
  return response;
}

localProbe();
if (liveBase) await liveProbe(liveBase);

console.log(failures === 0 ? '\nAll checks PASSED' : `\n${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
