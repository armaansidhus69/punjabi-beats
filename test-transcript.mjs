/**
 * Phase 7b transcript tests — pure parser/search/position core, no network.
 * Node >= 23.6 TypeScript type stripping required.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRANSCRIPT_POSITION_CAP,
  TRANSCRIPT_SEGMENT_CAP,
  chooseTranscriptRef,
  normalizeTranscriptPositions,
  parseHtmlTranscript,
  parseJsonTranscript,
  parsePlainTranscript,
  parseSrt,
  parseTranscriptByMime,
  parseTranscriptTimestampMs,
  parseWebVtt,
  positionForTranscript,
  putTranscriptPosition,
  searchTranscript,
  segmentAt,
  transcriptPositionsToEnvelope,
} from './mobile/core/podcast/transcript.ts';

const REFS = [
  { url: 'https://x/plain.txt', type: 'text/plain', language: null, rel: null },
  { url: 'https://x/data.json', type: 'application/json', language: 'en', rel: 'captions' },
  { url: 'https://x/sub.srt', type: 'application/x-subrip', language: null, rel: null },
  { url: 'https://x/main.vtt', type: 'text/vtt', language: 'pa', rel: null },
];

test('format choice: VTT > SRT > JSON > HTML > plain, feed order tie', () => {
  assert.equal(chooseTranscriptRef(REFS)?.url, 'https://x/main.vtt');
  assert.equal(chooseTranscriptRef(REFS.slice(0, 3))?.url, 'https://x/sub.srt');
  assert.equal(chooseTranscriptRef(REFS.slice(0, 2))?.url, 'https://x/data.json');
  const tied = [
    { url: 'https://x/first.vtt', type: 'text/vtt', language: 'en', rel: null },
    { url: 'https://x/second.vtt', type: 'text/vtt', language: 'pa', rel: null },
  ];
  assert.equal(chooseTranscriptRef(tied)?.url, 'https://x/first.vtt');
  assert.equal(chooseTranscriptRef([]), null);
});

test('timestamp parser: VTT/SRT variants and guards', () => {
  assert.equal(parseTranscriptTimestampMs('00:02.500'), 2500);
  assert.equal(parseTranscriptTimestampMs('01:02:03.250'), 3_723_250);
  assert.equal(parseTranscriptTimestampMs('00:02,760'), 2760);
  assert.equal(parseTranscriptTimestampMs('61:00.000'), 3_660_000);
  assert.equal(parseTranscriptTimestampMs('01:60:00.000'), null);
  assert.equal(parseTranscriptTimestampMs('00:'), null);
  assert.equal(parseTranscriptTimestampMs('a:02.000'), null);
  assert.equal(parseTranscriptTimestampMs('bogus'), null);
});

test('WebVTT: cue id/settings, speaker, tags, multiline + malformed skip', () => {
  const vtt = `WEBVTT

intro-id
00:00:01.000 --> 00:00:03.500 align:start position:10%
<v John>Hello <i>world</i>
second line

00:00:04.000 --> 00:00:06.000
No speaker

bad cue
not timing
ignored`;
  assert.deepEqual(parseWebVtt(vtt), [
    {
      id: '0:1000',
      startMs: 1000,
      endMs: 3500,
      speaker: 'John',
      text: 'Hello world second line',
    },
    {
      id: '1:4000',
      startMs: 4000,
      endMs: 6000,
      speaker: null,
      text: 'No speaker',
    },
  ]);
});

test('SRT: comma times, optional cue id, speaker prefix + malformed blocks', () => {
  const srt = `1
00:00:00,000 --> 00:00:02,760
Sarah: In today's episode,
you will learn this.

00:00:02.760 --> 00:00:06.090
Second cue

3
bad --> time
drop me`;
  const segments = parseSrt(srt);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], {
    id: '0:0',
    startMs: 0,
    endMs: 2760,
    speaker: 'Sarah',
    text: "In today's episode, you will learn this.",
  });
  assert.equal(segments[1].startMs, 2760);
  assert.equal(segments[1].speaker, null);
});

test('Podcast JSON: seconds→ms and word rows coalesce on speaker/sentence', () => {
  const json = JSON.stringify({
    version: '1.0.0',
    segments: [
      { speaker: 'Darth Vader', startTime: 0.5, endTime: 0.75, body: 'I' },
      { speaker: 'Darth Vader', startTime: 1, endTime: 1.25, body: 'am' },
      { speaker: 'Darth Vader', startTime: 1.5, endTime: 2, body: 'your' },
      { speaker: 'Darth Vader', startTime: 2.25, endTime: 2.5, body: 'father.' },
      { speaker: 'Luke', startTime: 2.75, endTime: 3, body: 'Nooooo!' },
      { speaker: 'Luke', startTime: 'bad', body: 'drop' },
    ],
  });
  assert.deepEqual(parseJsonTranscript(json), [
    {
      id: '0:500',
      startMs: 500,
      endMs: 2500,
      speaker: 'Darth Vader',
      text: 'I am your father.',
    },
    {
      id: '1:2750',
      startMs: 2750,
      endMs: 3000,
      speaker: 'Luke',
      text: 'Nooooo!',
    },
  ]);
});

test('Podcast JSON: punctuation and long gaps start new display chunks', () => {
  const segments = parseJsonTranscript(JSON.stringify({
    segments: [
      { speaker: 'Host', startTime: 0, endTime: 0.5, body: 'First sentence.' },
      { speaker: 'Host', startTime: 0.7, endTime: 1, body: 'Second' },
      { speaker: 'Host', startTime: 3, endTime: 3.5, body: 'after gap' },
    ],
  }));
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map(segment => segment.text), [
    'First sentence.',
    'Second',
    'after gap',
  ]);
});

test('HTML: cite/time/paragraph order, entities, script strip, untimed fallback', () => {
  const html = `<script><p>steal me</p></script>
  <cite>Kevin:</cite><time>0:09</time><p>Hello &amp; welcome.</p>
  <cite>Alban:</cite><p><b>Untimed</b> answer.</p>`;
  assert.deepEqual(parseHtmlTranscript(html), [
    {
      id: '0:9000',
      startMs: 9000,
      endMs: null,
      speaker: 'Kevin',
      text: 'Hello & welcome.',
    },
    {
      id: '1:u',
      startMs: null,
      endMs: null,
      speaker: 'Alban',
      text: 'Untimed answer.',
    },
  ]);
  assert.equal(parseHtmlTranscript('<div>Plain <b>fallback</b></div>')[0].text, 'Plain fallback');
});

test('plain + dispatcher: paragraph/line fallback, empty and hard segment cap', () => {
  assert.deepEqual(parsePlainTranscript('First paragraph\n\nSecond paragraph'), [
    { id: '0:u', startMs: null, endMs: null, speaker: null, text: 'First paragraph' },
    { id: '1:u', startMs: null, endMs: null, speaker: null, text: 'Second paragraph' },
  ]);
  assert.equal(parseTranscriptByMime('text/plain', 'one\ntwo').length, 2);
  assert.deepEqual(parsePlainTranscript('  '), []);
  const tooMany = Array.from({ length: TRANSCRIPT_SEGMENT_CAP + 5 }, (_, index) => `p${index}`).join('\n\n');
  assert.equal(parsePlainTranscript(tooMany).length, TRANSCRIPT_SEGMENT_CAP);
});

test('malformed parser inputs fail closed, never throw', () => {
  assert.doesNotThrow(() => parseWebVtt('WEBVTT\n\nno cues'));
  assert.doesNotThrow(() => parseSrt('1\nbad'));
  assert.doesNotThrow(() => parseJsonTranscript('{broken'));
  assert.doesNotThrow(() => parseHtmlTranscript('<script>oops'));
  assert.deepEqual(parseJsonTranscript('[]'), []);
});

test('segmentAt: before/exact/between/after and mixed untimed rows', () => {
  const segments = [
    { id: 'u', startMs: null, endMs: null, speaker: null, text: 'intro' },
    { id: 'a', startMs: 1000, endMs: 2000, speaker: null, text: 'one' },
    { id: 'b', startMs: 3000, endMs: null, speaker: null, text: 'two' },
  ];
  assert.equal(segmentAt(segments, 999), -1);
  assert.equal(segmentAt(segments, 1000), 1);
  assert.equal(segmentAt(segments, 2500), 1);
  assert.equal(segmentAt(segments, 9999), 2);
  assert.equal(segmentAt(segments, Number.NaN), -1);
});

test('search: text/speaker case-insensitive, min query + cap', () => {
  const segments = [
    { id: '0', startMs: 0, endMs: 1, speaker: 'ALICE', text: 'Sat sri akaal' },
    { id: '1', startMs: 2, endMs: 3, speaker: 'Bob', text: 'Punjab story' },
    { id: '2', startMs: 4, endMs: 5, speaker: null, text: 'Punjab music' },
  ];
  assert.deepEqual(searchTranscript(segments, 'alice'), [0]);
  assert.deepEqual(searchTranscript(segments, 'PUNJAB'), [1, 2]);
  assert.deepEqual(searchTranscript(segments, 'p'), []);
  assert.deepEqual(searchTranscript(segments, 'punjab', 1), [1]);
});

test('positions: envelope/source guard, clamp, refresh and cap 50', () => {
  const entry = {
    sourceUrl: 'https://x/main.vtt',
    segmentIndex: 7,
    updatedAt: '2026-10-30T00:00:00.000Z',
  };
  const restored = normalizeTranscriptPositions({ version: 1, positions: { ep: entry } });
  assert.deepEqual(restored.ep, entry);
  assert.deepEqual(transcriptPositionsToEnvelope(restored), { version: 1, positions: { ep: entry } });
  assert.equal(positionForTranscript(restored, 'ep', entry.sourceUrl, 20), 7);
  assert.equal(positionForTranscript(restored, 'ep', entry.sourceUrl, 3), 2);
  assert.equal(positionForTranscript(restored, 'ep', 'https://x/new.vtt', 20), null);
  assert.deepEqual(normalizeTranscriptPositions({ version: 2, positions: { ep: entry } }), {});
  assert.deepEqual(normalizeTranscriptPositions({ version: 1, positions: { ep: { ...entry, segmentIndex: -1 } } }), {});

  let map = {};
  for (let index = 0; index <= TRANSCRIPT_POSITION_CAP; index += 1) {
    map = putTranscriptPosition(map, `ep-${index}`, {
      sourceUrl: `https://x/${index}.vtt`,
      segmentIndex: index,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
  }
  assert.equal(Object.keys(map).length, TRANSCRIPT_POSITION_CAP);
  assert.equal(map['ep-0'], undefined);
  assert.equal(map[`ep-${TRANSCRIPT_POSITION_CAP}`].segmentIndex, TRANSCRIPT_POSITION_CAP);
});
