/**
 * Podcasts Phase 12a tests — pure core (core/podcast/*), no network.
 * RSS/ATOM parse, malformed-skip, duration/date formats, adapters,
 * progress policy boundaries. Node >= 23.6 (type stripping needs it —
 * mobile/core modules ko keval `.ts` suffix se import hota hai).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePodcastFeed,
  parseItunesDuration,
  parseDateToIso,
  stripHtml,
  normalizeTranscriptMime,
  transcriptNamespacePrefixes,
} from './mobile/core/podcast/rss.ts';
import {
  stableEpisodeId,
  rssEpisodeToPodcastEpisode,
  itunesEpisodeRowToPodcastEpisode,
  episodeToSong,
} from './mobile/core/podcast/episode.ts';
import { isEpisodePlayed, mergeProgress } from './mobile/core/podcast/progress.ts';

const RSS_FIXTURE = `<rss version="2.0"
xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
xmlns:podcast="https://podcastindex.org/namespace/1.0"
xmlns:pod2="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md">
<channel>
  <title>Punjabi Katha &amp; Co</title>
  <itunes:author>Bhai Veer Singh</itunes:author>
  <itunes:image href="https://cdn.example/itunes-art.png" />
  <image><url>https://cdn.example/rss-art.png</url></image>
  <item>
    <title>Ep 1 — Start</title>
    <enclosure url="https://cdn.example/ep1.mp3" length="42000000" type="audio/mpeg" />
    <itunes:duration>1:02:03</itunes:duration>
    <description><![CDATA[<p>Ye episode <b>bold</b> hai</p>]]></description>
    <pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate>
    <podcast:transcript url="https://cdn.example/ep1.vtt" type="text/vtt; charset=utf-8" language="en" rel="captions" />
    <podcast:transcript url="https://cdn.example/ep1.vtt" type="text/vtt" language="en" />
    <pod2:transcript url="https://cdn.example/ep1.srt" type="application/srt" />
    <podcast:transcript url="http://cdn.example/insecure.vtt" type="text/vtt" />
    <podcast:transcript url="https://cdn.example/unsupported.xml" type="application/xml" />
  </item>
  <item>
    <title>Broken item — no audio</title>
    <description>no enclosure here</description>
  </item>
  <item>
    <title>Ep 2 — DNb</title>
    <enclosure url="https://cdn.example/ep2.mp3" type="audio/mpeg" />
    <itunes:duration>300</itunes:duration>
    <itunes:image href="https://cdn.example/ep2-art.png" />
  </item>
</channel>
</rss>`;

const ATOM_FIXTURE = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Show</title>
  <entry>
    <title>Atom Ep</title>
    <link rel="enclosure" href="https://cdn.example/atom-ep.mp3" type="audio/mpeg" />
    <summary>Atom summary text</summary>
    <published>2026-10-20T08:00:00Z</published>
  </entry>
</feed>`;

const SHOW_META = { id: '42', title: 'Punjabi Katha & Co', artworkUrl: 'https://cdn.example/itunes-art.png' };

test('rss: full fixture parse', () => {
  const feed = parsePodcastFeed(RSS_FIXTURE);
  assert.equal(feed.title, 'Punjabi Katha & Co');
  assert.equal(feed.artist, 'Bhai Veer Singh');
  assert.equal(feed.artworkUrl, 'https://cdn.example/itunes-art.png'); // itunes:image preferred
  assert.equal(feed.episodes.length, 2); // broken item (no audio) skip
  const [ep0, ep1] = feed.episodes;
  assert.equal(ep0.title, 'Ep 1 — Start');
  assert.equal(ep0.audioUrl, 'https://cdn.example/ep1.mp3');
  assert.equal(ep0.rawDurationSec, '1:02:03');
  assert.equal(ep0.publishedAt, '2026-10-28T10:00:00.000Z');
  assert.equal(ep0.description, 'Ye episode bold hai'); // html strip
  assert.deepEqual(ep0.transcripts, [
    {
      url: 'https://cdn.example/ep1.vtt',
      type: 'text/vtt',
      language: 'en',
      rel: 'captions',
    },
    {
      url: 'https://cdn.example/ep1.srt',
      type: 'application/x-subrip',
      language: null,
      rel: null,
    },
  ]);
  assert.equal(ep1.audioUrl, 'https://cdn.example/ep2.mp3');
  assert.equal(ep1.artworkUrl, 'https://cdn.example/ep2-art.png');
  assert.deepEqual(ep1.transcripts, []);
});

test('rss: malformed + garbage input throw nahi kare', () => {
  assert.doesNotThrow(() => parsePodcastFeed('<rss><channel><title>No close'));
  assert.doesNotThrow(() => parsePodcastFeed('absolutely not xml'));
  assert.doesNotThrow(() => parsePodcastFeed(''));
  assert.equal(parsePodcastFeed('absolutely not xml!').episodes.length, 0);
  // opener without quotes me attribute reader ko crash nahi karna
  assert.doesNotThrow(() => parsePodcastFeed('<rss><channel><title a=broken<x></channel></rss>'));
});

test('atom: enclosure link parse', () => {
  const feed = parsePodcastFeed(ATOM_FIXTURE);
  assert.equal(feed.title, 'Atom Show');
  assert.equal(feed.episodes.length, 1);
  assert.equal(feed.episodes[0].audioUrl, 'https://cdn.example/atom-ep.mp3');
  assert.equal(feed.episodes[0].publishedAt, '2026-10-20T08:00:00.000Z');
});

test('duration + date + stripHtml scalar helpers', () => {
  assert.equal(parseItunesDuration('300'), 300);
  assert.equal(parseItunesDuration('1:02:03'), 3723);
  assert.equal(parseItunesDuration('37:21'), 2241);
  assert.equal(parseItunesDuration('1:02:03:04'), null); // 4 segment invalid
  assert.equal(parseItunesDuration('bogus'), null);
  assert.equal(parseItunesDuration(null), null);
  assert.equal(parseDateToIso('Wed, 28 Oct 2026 10:00:00 GMT'), '2026-10-28T10:00:00.000Z');
  assert.equal(parseDateToIso('not a date'), '');
  assert.equal(parseDateToIso(null), '');
  assert.equal(stripHtml('<p>Ye <b>bold</b></p>'), 'Ye bold');
});

test('rss transcript helpers: MIME aliases + namespace prefixes', () => {
  assert.equal(normalizeTranscriptMime('Text/VTT; charset=UTF-8'), 'text/vtt');
  assert.equal(normalizeTranscriptMime('application/srt'), 'application/x-subrip');
  assert.equal(normalizeTranscriptMime('application/xml'), null);
  const prefixes = transcriptNamespacePrefixes(RSS_FIXTURE);
  assert.equal(prefixes.has('podcast'), true);
  assert.equal(prefixes.has('pod2'), true);
});

test('rss adapter: stableEpisodeId deterministic + url-sensitive', () => {
  assert.equal(stableEpisodeId('https://cdn.example/ep1.mp3'), stableEpisodeId('https://cdn.example/ep1.mp3'));
  assert.notEqual(stableEpisodeId('https://cdn.example/ep1.mp3'), stableEpisodeId('https://cdn.example/ep2.mp3'));
  // trim + case normalize — same audio url, same id
  assert.equal(
    stableEpisodeId('HTTPS://cdn.example/ep1.mp3 '),
    stableEpisodeId('https://cdn.example/ep1.mp3'),
  );
  assert.match(stableEpisodeId('https://x.mp3'), /^[0-9a-f]{16}$/);
});

test('rss adapter: episode load → PodcastEpisode', () => {
  const feed = parsePodcastFeed(RSS_FIXTURE);
  const episode = rssEpisodeToPodcastEpisode(feed.episodes[0], SHOW_META);
  assert.ok(episode);
  assert.equal(episode.showId, '42');
  assert.equal(episode.showTitle, 'Punjabi Katha & Co');
  assert.equal(episode.durationMs, 3723000); // 1:02:03 → ms
  assert.equal(episode.audioUrl, 'https://cdn.example/ep1.mp3');
  assert.equal(episode.id, stableEpisodeId('https://cdn.example/ep1.mp3'));
  assert.equal(episode.transcripts.length, 2);
});

test('rss adapter: no-audio item → null', () => {
  const feed = parsePodcastFeed(RSS_FIXTURE);
  const broken = parsePodcastFeed('<rss><channel><title>T</title><item><title>No audio</title></item></channel></rss>');
  assert.equal(broken.episodes.length, 0);
  // yahan adapter ka null-path direct test — synthetic raw shape
  const nullEpisode = rssEpisodeToPodcastEpisode(
    {
      title: 'x',
      audioUrl: '',
      rawDurationSec: null,
      description: null,
      publishedAt: '',
      artworkUrl: null,
      transcripts: [],
    },
    SHOW_META,
  );
  assert.equal(nullEpisode, null);
  void feed;
});

test('episodeToSong invariants — existing player pipeline', () => {
  const feed = parsePodcastFeed(RSS_FIXTURE);
  const episode = rssEpisodeToPodcastEpisode(feed.episodes[0], SHOW_META);
  assert.ok(episode);
  const song = episodeToSong(episode);
  assert.equal(song.id, episode.id);
  assert.equal(song.title, episode.title);
  assert.equal(song.artist, episode.showTitle);
  assert.equal(song.cover, episode.artworkUrl);
  assert.equal(song.preview, episode.audioUrl); // FULL stream, not 30s preview
  assert.equal(song.duration, 3723000);
  assert.equal(song.source, 'itunes');
  assert.equal(song.previewOnly, false); // podcast full-play spec
});

test('itunes row adapter: episodeUrl + duration, missing url → null', () => {
  const row = {
    trackName: 'Lookup Ep',
    episodeUrl: 'https://cdn.example/lookup-ep.mp3',
    trackTimeMillis: 900000,
    description: 'lookup desc',
    releaseDate: '2026-10-25T00:00:00Z',
    artworkUrl160: 'https://cdn.example/l160.png',
    collectionId: 77,
    collectionName: 'Lookup Show',
  };
  const episode = itunesEpisodeRowToPodcastEpisode(row, SHOW_META);
  assert.ok(episode);
  assert.equal(episode.durationMs, 900000);
  assert.equal(episode.showId, '77');
  assert.equal(episode.publishedAt, '2026-10-25T00:00:00.000Z');
  assert.equal(episode.artworkUrl, 'https://cdn.example/l160.png');
  assert.deepEqual(episode.transcripts, []);
  assert.equal(itunesEpisodeRowToPodcastEpisode({ episodeUrl: null }, SHOW_META), null);
  // invalid releaseDate → '' (empty, not NaN crash)
  const badDate = itunesEpisodeRowToPodcastEpisode(
    { episodeUrl: 'https://x.mp3', releaseDate: 'garbage' },
    SHOW_META,
  );
  assert.equal(badDate?.publishedAt, '');
});

test('progress: played boundary 95% + duration 0', () => {
  assert.equal(isEpisodePlayed({ positionMs: 9490, durationMs: 10000, played: false }), false);
  assert.equal(isEpisodePlayed({ positionMs: 9500, durationMs: 10000, played: false }), true);
  assert.equal(isEpisodePlayed({ positionMs: 9500, durationMs: 0, played: false }), false); // unknown duration
  assert.equal(isEpisodePlayed({ positionMs: 0, durationMs: 10000, played: true }), true); // sticky
});

test('progress: mergeProgress — clamp + sticky + metadata rehydrate', () => {
  const prev = {
    positionMs: 5000,
    durationMs: 10000,
    played: false,
    updatedAt: '2026-10-29T00:00:00.000Z',
    title: 'Ep 1',
    showTitle: 'Show',
    artworkUrl: 'art.png',
    audioUrl: 'https://cdn.example/ep1.mp3',
  };
  // normal tick
  const tick = mergeProgress(
    prev,
    { positionMs: 9620, durationMs: 10000, title: '', showTitle: '', artworkUrl: '', audioUrl: '' },
    '2026-10-29T01:00:00.000Z',
  );
  assert.equal(tick.played, true); // 96.2% cross
  assert.equal(tick.positionMs, 9620);
  assert.equal(tick.title, 'Ep 1'); // previous metadata rehydrate
  assert.equal(tick.audioUrl, 'https://cdn.example/ep1.mp3');
  // position clamp to duration
  const over = mergeProgress(
    null,
    { positionMs: 98_000, durationMs: 10_000, title: 'X', showTitle: 'S', artworkUrl: 'a', audioUrl: 'u' },
    'now',
  );
  assert.equal(over.positionMs, 10000);
  assert.equal(over.durationMs, 10000);
  // negative clamp
  const neg = mergeProgress(
    null,
    { positionMs: -5, durationMs: 10_000, title: 'X', showTitle: 'S', artworkUrl: 'a', audioUrl: 'u' },
    'now',
  );
  assert.equal(neg.positionMs, 0);
});
