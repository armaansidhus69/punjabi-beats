/** Punjabi/Hindi catalog integration against production code, with deterministic HTTP fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInThisContext } from 'node:vm';

const requireMobile = createRequire(new URL('./mobile/package.json', import.meta.url));
const ts = requireMobile('typescript');
const source = readFileSync(new URL('./mobile/services/musicApi.ts', import.meta.url), 'utf8');
const spotifySource = readFileSync(new URL('./mobile/services/spotifyApi.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const spotifyCompiled = ts.transpileModule(spotifySource, {
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

function harness({ env = {}, saavn = () => [], audius = [], upgradeAudius = [], itunes = [], audioOk = true, youtubeCandidates = [], pipedStreams = [], pipedSongs = [], trending = [], spotifySearch = [], spotifyNewReleases = [], spotifyAlbumTracks = [] } = {}) {
  const calls = [];
  const audioChecks = [];
  const deadWrites = [];
  const tokenCalls = [];
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
        if (params && params.filter === 'music_songs') {
          return { data: { items: pipedSongs } };
        }
        if (url === 'https://api.audius.co/v1/tracks/trending') {
          return { data: { data: trending } };
        }
        if (url === 'https://api.audius.co/v1/tracks/search') {
          const rows = params.limit === 10 && upgradeAudius.length > 0 ? upgradeAudius : audius;
          return { data: { data: params.offset ? [] : rows } };
        }
        if (url === 'https://api.spotify.com/v1/search') {
          return { data: { tracks: { items: spotifySearch } } };
        }
        if (url === 'https://api.spotify.com/v1/browse/new-releases') {
          return { data: { albums: { items: spotifyNewReleases } } };
        }
        if (url.startsWith('https://api.spotify.com/v1/albums/')) {
          return { data: { items: spotifyAlbumTracks } };
        }
        if (url === 'https://itunes.apple.com/search') return { data: { results: itunes } };
        throw new Error(`Unexpected HTTP request: ${url}`);
      },
      post: async (url, body) => {
        if (url === 'https://accounts.spotify.com/api/token') {
          tokenCalls.push({ url, body });
          return { data: { access_token: 'spotify-test-token', expires_in: 3600 } };
        }
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
  const processEnv = { env };
  const sharedConsole = { ...console, warn: () => {} };
  const headFetch = async (url, options) => {
    assert.equal(options.method, 'HEAD');
    audioChecks.push(url);
    return { ok: audioOk };
  };
  const requireMock = name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  // Spotify module pehle load — musicApi isi ko './spotifyApi' se require karta hai
  const spotifyModule = { exports: {} };
  runInThisContext(
    `(function(require, module, exports, process, console, fetch, Math, __DEV__) { ${spotifyCompiled}\n})`,
    { filename: 'mobile/services/spotifyApi.ts' },
  )(requireMock, spotifyModule, spotifyModule.exports, processEnv, sharedConsole, headFetch, math, false);
  dependencies['./spotifyApi'] = spotifyModule.exports;
  const execute = runInThisContext(
    `(function(require, module, exports, process, console, fetch, Math, __DEV__) { ${compiled}\n})`,
    { filename: 'mobile/services/musicApi.ts' },
  );
  execute(requireMock, module, module.exports, processEnv, sharedConsole, headFetch, math, false);
  return { ...module.exports, calls, audioChecks, deadWrites, tokenCalls };
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

test('concurrent full-song upgrades share one provider lookup', async () => {
  let saavnLookups = 0;
  const h = harness({
    saavn: () => {
      saavnLookups++;
      return [rawSong('shared', { name: 'Shared Song' })];
    },
  });
  const candidate = {
    id: 'itunes_shared',
    title: 'Shared Song',
    artist: 'Test Artist',
    cover: '',
    preview: '',
    duration: 240_000,
    source: 'itunes',
    previewOnly: true,
  };

  const [first, second] = await Promise.all([
    h.resolveFullAudioStream(candidate),
    h.resolveFullAudioStream(candidate),
  ]);

  assert.equal(saavnLookups, 1, 'same song ke concurrent upgrades dedupe hone chahiye');
  assert.equal(first.url, second.url);
  assert.equal(first.previewOnly, false);
});

test('concurrent YouTube resolutions share the Verome/Piped race', async () => {
  const h = harness({
    env: { EXPO_PUBLIC_PIPED_API: 'https://piped.invalid' },
    pipedStreams: [{ url: 'https://audio.invalid/shared-youtube.m4a', bitrate: 256 }],
  });
  const candidate = {
    id: 'ytm_shared',
    title: 'Shared YouTube Song',
    artist: 'Test Artist',
    cover: '',
    preview: '',
    duration: 240_000,
    source: 'youtube_music',
    videoId: 'shared-video',
    previewOnly: false,
  };

  const [first, second] = await Promise.all([
    h.resolveSongPlaybackUrl(candidate),
    h.resolveSongPlaybackUrl(candidate),
  ]);

  const streamRequests = h.calls.filter(call => call.url.includes('/streams/'));
  assert.equal(streamRequests.length, 6, 'one parallel provider race honi chahiye');
  assert.equal(first.url, second.url);
});

test('full-only policy: 30s previews drop from results when full songs exist', async () => {
  const h = harness({
    saavn: () => [rawSong('full-1'), rawSong('full-2')],
    itunes: [
      { trackId: 90, trackName: 'Preview Only', artistName: 'Test Artist', trackTimeMillis: 30_000, previewUrl: 'https://audio.invalid/prev-90.m4a' },
      { trackId: 91, trackName: 'Preview Too', artistName: 'Test Artist', trackTimeMillis: 30_000, previewUrl: 'https://audio.invalid/prev-91.m4a' },
    ],
  });
  const songs = await h.searchSongs('Diljit Dosanjh', 10);
  assert.deepEqual(songs.map(item => item.id), ['full-1', 'full-2']);
  assert.ok(songs.every(item => item.previewOnly === false), 'No 30s previews in a full-only result');
});

test('full-only policy: previews are removed when zero full songs exist', async () => {
  const h = harness({
    itunes: [
      { trackId: 90, trackName: 'Preview Only', artistName: 'Test Artist', trackTimeMillis: 30_000, previewUrl: 'https://audio.invalid/prev-90.m4a' },
    ],
  });
  const songs = await h.searchSongs('xyzabc nothing', 10);
  assert.deepEqual(songs, []);
});

test('getNewSongs merges latest releases full-first: JioSaavn → YouTube Music → Audius', async () => {
  const h = harness({
    saavn: () => [rawSong('new-1', { name: 'Ashke', year: 2026 }), rawSong('new-2', { name: 'Kaali Hoodie', year: 2026 })],
    pipedSongs: [
      { url: 'https://youtube.com/watch?v=newYt1', title: 'Fresh Drop', uploaderName: 'New Artist', duration: 200, thumbnailUrl: 'https://img.invalid/t.jpg' },
    ],
    trending: [
      { id: 'tr-1', title: 'Week Banger', duration: 210, user: { name: 'Fresh Find' } },
      { id: 'tr-short', title: 'Too Short Clip', duration: 20, user: { name: 'Skip Me' } },
    ],
  });
  const songs = await h.getNewSongs(10);
  assert.deepEqual(songs.map(item => item.id), ['new-1', 'new-2', 'ytm_newYt1', 'audius-tr-1']);
  assert.equal(songs[0].year, 2026);
  assert.ok(songs.every(item => item.previewOnly !== true || item.source === 'youtube_music'));
  assert.ok(h.calls.some(call => call.url === 'https://api.audius.co/v1/tracks/trending' && call.params.time === 'week'));
  assert.ok(h.calls.some(call => call.url.includes('/search/songs') && String(call.params.query).includes('latest punjabi')));
});

const SPOTIFY_CREDS = { EXPO_PUBLIC_SPOTIFY_CLIENT_ID: 'test-id', EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET: 'test-secret' };

function spotifyTrack(id, overrides = {}) {
  return {
    id,
    name: `Spotify Song ${id}`,
    duration_ms: 210_000,
    preview_url: null,
    artists: [{ name: 'Spotify Artist' }],
    album: { name: `Album ${id}`, images: [{ url: `https://img.invalid/${id}.jpg` }], release_date: '2026-10-24' },
    ...overrides,
  };
}

test('Spotify catalogue joins results and is exempt from the true-preview filter', async () => {
  const h = harness({
    env: SPOTIFY_CREDS,
    saavn: () => [rawSong('full-1')],
    itunes: [
      { trackId: 90, trackName: 'Preview Only', artistName: 'Test Artist', trackTimeMillis: 30_000, previewUrl: 'https://audio.invalid/prev-90.m4a' },
    ],
    spotifySearch: [spotifyTrack('sp-1', { name: 'Ashke', artists: [{ name: 'Karan Aujla' }] })],
  });
  const songs = await h.searchSongs('Karan Aujla', 10);
  // Full JioSaavn + Spotify metadata (30s iTunes preview full songs hote hi drop)
  assert.deepEqual(songs.map(item => item.id), ['full-1', 'spotify_sp-1']);
  const spotify = songs[1];
  assert.equal(spotify.source, 'spotify');
  assert.equal(spotify.previewOnly, true, 'Spotify metadata unresolved hota hai — 30s clip nahi');
  assert.equal(spotify.year, 2026);
  assert.equal(spotify.cover, 'https://img.invalid/sp-1.jpg');
  assert.ok(h.calls.some(call => call.url === 'https://api.spotify.com/v1/search' && call.params.market === 'IN'));
});

test('Spotify token is requested once and cached across searches', async () => {
  const h = harness({
    env: SPOTIFY_CREDS,
    spotifySearch: [spotifyTrack('sp-1')],
  });
  await h.searchSongs('Diljit Dosanjh', 5);
  await h.searchSongs('Sidhu Moose Wala', 5);
  assert.equal(h.tokenCalls.length, 1, 'Client-credentials token cache hona chahiye');
  assert.ok(h.calls.filter(call => call.url === 'https://api.spotify.com/v1/search').length === 2);
});

test('Spotify stays skipped when no credentials are configured', async () => {
  const h = harness({ saavn: () => [rawSong('full-1')] });
  const songs = await h.searchSongs('Diljit Dosanjh', 5);
  assert.equal(songs[0].id, 'full-1');
  assert.ok(h.calls.every(call => !call.url.includes('spotify.com')), 'Bina creds koi Spotify HTTP nahi');
});

test('getNewSongs includes Spotify launch-day releases ahead of YouTube Music', async () => {
  const h = harness({
    env: SPOTIFY_CREDS,
    spotifyNewReleases: [
      { id: 'alb-1', name: 'Brand New Album', images: [{ url: 'https://img.invalid/alb.jpg' }], release_date: '2026-10-30', artists: [{ name: 'New Artist' }] },
    ],
    spotifyAlbumTracks: [spotifyTrack('launch-1', { name: 'Launch Day Track', album: { name: 'Brand New Album', release_date: '2026-10-30' } })],
  });
  const songs = await h.getNewSongs(10);
  assert.equal(songs[0].id, 'spotify_launch-1');
  assert.equal(songs[0].cover, 'https://img.invalid/alb.jpg', 'Album cover track ko milta hai');
  assert.equal(songs[0].year, 2026);
  assert.ok(h.calls.some(call => call.url === 'https://api.spotify.com/v1/browse/new-releases' && call.params.country === 'IN'));
  assert.ok(h.calls.some(call => call.url.startsWith('https://api.spotify.com/v1/albums/alb-1/tracks')));
});
