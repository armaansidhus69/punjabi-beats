// probe-transcript.mjs — Phase 7b pure fixtures + optional live VTT URL.
//
// Local deterministic: node probe-transcript.mjs
// Live publisher file: node probe-transcript.mjs --live https://host/file.vtt

import {
  parseJsonTranscript,
  parseSrt,
  parseWebVtt,
  searchTranscript,
  segmentAt,
} from './mobile/core/podcast/transcript.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const args = process.argv.slice(2);
const liveIndex = args.indexOf('--live');
const liveUrl = liveIndex >= 0 ? args[liveIndex + 1] : null;

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

function localProbe() {
  console.log('--- Transcript pure-core probe ---');
  const vtt = parseWebVtt(`WEBVTT

00:00:01.000 --> 00:00:03.000
<v Host>Hello Punjab

00:00:03.000 --> 00:00:05.000
Second line`);
  check('VTT parses timed cues', vtt.length === 2 && vtt[0].startMs === 1000, JSON.stringify(vtt));
  check('VTT speaker captured', vtt[0]?.speaker === 'Host', JSON.stringify(vtt[0]));
  check('segmentAt follows playback', segmentAt(vtt, 3500) === 1, `got ${segmentAt(vtt, 3500)}`);
  check('search finds local text', searchTranscript(vtt, 'punjab')[0] === 0, JSON.stringify(searchTranscript(vtt, 'punjab')));

  const srt = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nSpeaker: Sat sri akaal');
  check('SRT parses speaker cue', srt.length === 1 && srt[0].speaker === 'Speaker', JSON.stringify(srt));

  const json = parseJsonTranscript(JSON.stringify({
    segments: [{ speaker: 'Host', startTime: 0, endTime: 1, body: 'JSON line.' }],
  }));
  check('Podcast JSON parses', json.length === 1 && json[0].text === 'JSON line.', JSON.stringify(json));
}

async function fetchTextWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/vtt' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      throw new Error(`body too large (${contentLength})`);
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw new Error('body too large');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function liveProbe(url) {
  console.log(`--- Transcript live VTT probe: ${url} ---`);
  try {
    const body = await fetchTextWithTimeout(url);
    const segments = parseWebVtt(body);
    check('live VTT returns segments', segments.length > 0, 'parser returned zero segments');
    check('live VTT has timed cue', segments.some(segment => segment.startMs !== null), 'no timed cue');
  } catch (err) {
    check('live VTT request completed', false, err instanceof Error ? err.message : String(err));
  }
}

localProbe();
if (liveUrl) await liveProbe(liveUrl);
else if (liveIndex >= 0) check('--live URL provided', false, 'URL missing');

console.log(failures === 0 ? '\nAll checks PASSED' : `\n${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
