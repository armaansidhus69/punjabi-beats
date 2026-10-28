/** Punjabi/Hindi catalog integration against production code, with deterministic HTTP fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInThisContext } from 'node:vm';

const requireMobile = createRequire(new URL('./mobile/package.json', import.meta.url));
const ts = requireMobile('typescript');
const source = readFileSync(new URL('./mobile/services/musicApi.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const DEFAULT_BASE = 'https://saavn.sumit.co';

function rawSong(id, overrides = {}) {
  return {
    id, name: `Song ${id}`, duration: 240,
    artists: { primary: [{ name: 'Test Artist' }] },
    image: [{ quality: '500x500', url: 'https://art.invalid/cover.jpg' }],
    downloadUrl: [
      { quality: '96kbps', url: `https://audio.invalid/${id}-96.m4a` },
      { quality: '320kbps', url: `https://audio.invalid/${id}-320.m4a` },
    ],
    ...overrides,
  };
}

function harness({ env = {}, saavn = () => [], audius = [], upgradeAudius = [], itunes = [], audioOk = true, youtubeCandidates = [], pipedStreams = [] } = {}) {
  const calls = [];
  const audioChecks = [];
  const deadWrites = [];
  const module = { exports: {} };
  const math = Object.create(Math);
  math.random = () => 0.999999; // Preserve artist order so both language pools can be asserted.
  const dependencies = {
    axios: {
      get: async (url, { params }) => {
        calls.push({ url, params });
        if (url.includes('/streams/')) {
          return { data: { audioStreams: pipedStreams } };
        }
        if (url.includes('/search/songs')) {
          return { data: { data: { results: await saavn(url, params) } } };
        }
        if (url === 'https://api.audius.co/v1/tracks/search') {
          const rows = params.limit === 10 && upgradeAudius.length > 0 ? upgradeAudius : audius;
          return { data: { data: params.offset ? [] : rows } };
        }
        if (url === 'https://itunes.apple.com/search') return { data: { results: itunes } };
        throw new Error(`Unexpected HTTP request: ${url}`);
      },
      post: async (url, body) => {
        calls.push({ url, body });
        assert.equal(url, 'https://bridge.invalid/api/youtube-match');
        return { data: { candidates: youtubeCandidates } };
      },
    },
    './storage': {
      getDeadMirrors: async () => [],
      saveDeadMirrors: async entries => deadWrites.push(entries),
    },
  };
  const execute = runInThisContext(
    `(function(require, module, exports, process, console, fetch, Math, __DEV__) { ${compiled}\n})`,
    { filename: 'mobile/services/musicApi.ts' },
  );
  execute(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, { env }, { ...console, warn: () => {} }, async (url, options) => {
    assert.equal(options.method, 'HEAD');
    audioChecks.push(url);
    return { ok: audioOk };
  }, math, false);
  return { ...module.exports, calls, audioChecks, deadWrites };
}

test('working open-source provider is the default and avoids legacy mirrors on success', async () => {
  const h = harness({ saavn: () => [rawSong('a'), rawSong('b')] });
  const songs = await h.searchSongs('Diljit Dosanjh', 2);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].source, 'jiosaavn');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, `${DEFAULT_BASE}/api/search/songs`);
  assert.equal(h.calls[0].params.page, 1);
  assert.equal(h.audioChecks.length, 1);
});

test('larger searches use capped pages and return up to 100 unique songs', async () => {
  const h = harness({ saavn: (_url, { page, limit }) =>
    Array.from({ length: limit }, (_, i) => rawSong(`${page}-${i}`)),
  });
  const songs = await h.searchSongs('Arijit Singh', 100);
  assert.equal(songs.length, 100);
  assert.equal(new Set(songs.map(item => item.id)).size, 100);
  const pages = h.calls.filter(call => call.url === `${DEFAULT_BASE}/api/search/songs`);
  assert.ok(pages.length > 1 && pages.length <= 5);
  assert.ok(pages.every(call => call.params.limit <= 40 && call.params.page >= 1));
  assert.equal(new Set(pages.map(call => call.params.page)).size, pages.length);
  assert.equal(h.audioChecks.length, 1, 'Audio guard runs before paging, not once per page');
});

test('search-only JioSaavn mirrors keep the working route for later pages', async () => {
  const base = 'https://search-only.invalid';
  const h = harness({
    env: { EXPO_PUBLIC_JIOSAAVN_BASE: base },
    saavn: (url, { page, limit }) => {
      if (url === `${base}/api/search/songs`) throw new Error('API route unavailable');
      assert.equal(url, `${base}/search/songs`);
      return Array.from({ length: limit }, (_, index) => rawSong(`${page}-${index}`));
    },
  });
  const songs = await h.searchSongs('Arijit Singh', 100);
  assert.equal(songs.length, 100);
  assert.ok(h.calls.some(call => call.url === `${base}/search/songs` && call.params.page === 2));
});

test('partial page failures keep good songs and do not mark the healthy provider dead', async () => {
  const h = harness({ saavn: (url, { page, limit }) => {
    if (!url.startsWith(DEFAULT_BASE)) return [];
    if (page === 2) throw new Error('Temporary page failure');
    if (page !== 1) return [];
    return Array.from({ length: limit }, (_, i) => rawSong(String(i)));
  } });
  const songs = await h.searchSongs('Diljit Dosanjh', 100);
  assert.equal(songs.length, 40);
  assert.ok(h.calls.some(call => call.params.page === 2));
  assert.equal(h.deadWrites.length, 0);
});

test('sparse primary results are topped up instead of hiding other available songs', async () => {
  const h = harness({
    saavn: () => [rawSong('saavn-a'), rawSong('saavn-b')],
    audius: ['a', 'b', 'c'].map(id => ({ id, title: `Audius ${id}`, duration: 200, user: { name: 'Artist' } })),
  });
  const songs = await h.searchSongs('hindi', 5);
  assert.equal(songs.length, 5);
  assert.deepEqual(songs.slice(0, 2).map(item => item.id), ['saavn-a', 'saavn-b']);
  assert.ok(songs.some(item => item.id.startsWith('audius-')));
});

test('Hindi and Gurmukhi titles stay distinct while actual duplicates are removed', async () => {
  const h = harness({ saavn: () => [
    rawSong('h1', { name: 'तुम ही हो' }), rawSong('h2', { name: 'केसरिया' }),
    rawSong('p1', { name: 'ਲਵਰ' }), rawSong('p2', { name: 'ਜੱਟ' }),
    rawSong('h1-copy', { name: 'तुम ही हो' }),
  ] });
  const songs = await h.searchSongs('गाने', 5);
  assert.deepEqual(songs.map(item => item.title), ['तुम ही हो', 'केसरिया', 'ਲਵਰ', 'ਜੱਟ']);
});

test('provider metadata decodes text and preserves full-song duration and 320kbps URL', async () => {
  const h = harness({ saavn: () => [rawSong('hindi', {
    name: 'Gehra Hua (From &quot;Dhurandhar&quot;)',
    artists: { primary: [{ name: 'Arijit Singh &amp; Shashwat Sachdev' }] },
  })] });
  const [track] = await h.searchSongs('Gehra Hua', 1);
  assert.equal(track.title, 'Gehra Hua (From "Dhurandhar")');
  assert.equal(track.artist, 'Arijit Singh & Shashwat Sachdev');
  assert.equal(track.duration, 240_000);
  assert.equal(track.previewOnly, false);
  assert.equal(track.preview, 'https://audio.invalid/hindi-320.m4a');
});

test('Reverbio-style YouTube bridge adds extra catalogue songs when configured', async () => {
  const h = harness({
    env: { EXPO_PUBLIC_YOUTUBE_MATCH_URL: 'https://bridge.invalid' },
    youtubeCandidates: [
      { videoId: 'yt-1', title: 'Tum Hi Ho', channel: 'Arijit Singh', durationSec: 262 },
      { videoId: 'yt-2', title: 'Channa Mereya', channel: 'Arijit Singh', durationSec: 292 },
    ],
  });
  const songs = await h.searchSongs('Arijit Singh', 5);
  assert.deepEqual(songs.map(item => item.id), ['ytm_yt-1', 'ytm_yt-2']);
  assert.equal(songs[0].source, 'youtube_music');
  assert.equal(songs[0].videoId, 'yt-1');
  assert.equal(songs[0].preview, '');
  assert.equal(songs[0].previewOnly, true);
});

test('metadata-only YouTube results do not skip full-song upgrade passes', async () => {
  const h = harness({
    env: { EXPO_PUBLIC_YOUTUBE_MATCH_URL: 'https://bridge.invalid' },
    youtubeCandidates: [
      { videoId: 'yt-extra', title: 'YouTube Extra', channel: 'Test Artist', durationSec: 200 },
    ],
    itunes: [{
      trackId: 1,
      trackName: 'Full Match',
      artistName: 'Test Artist',
      trackTimeMillis: 30_000,
      previewUrl: 'https://audio.invalid/full-preview.m4a',
    }],
    upgradeAudius: [{
      id: 'full-match',
      title: 'Full Match',
      duration: 240,
      user: { name: 'Test Artist' },
    }],
  });
  const songs = await h.searchSongs('Test Artist', 5);
  assert.equal(songs[0].title, 'Full Match');
  assert.equal(songs[0].previewOnly, false);
  assert.ok(songs.some(song => song.id === 'ytm_yt-extra'));
});

test('configured Piped instance resolves the highest-bitrate YouTube audio stream', async () => {
  const h = harness({
    env: { EXPO_PUBLIC_PIPED_API: 'https://piped.invalid' },
    pipedStreams: [
      { url: 'https://audio.invalid/128.m4a', bitrate: 128 },
      { url: 'https://audio.invalid/256.m4a', bitrate: 256 },
    ],
  });
  const resolved = await h.resolveSongPlaybackUrl({
    id: 'ytm_yt-1',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    cover: '',
    preview: '',
    duration: 262_000,
    source: 'youtube_music',
    videoId: 'yt-1',
    previewOnly: false,
  });
  assert.equal(resolved.url, 'https://audio.invalid/256.m4a');
  assert.equal(resolved.previewOnly, false);
});
