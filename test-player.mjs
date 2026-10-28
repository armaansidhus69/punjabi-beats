/** Production player/resolver regressions; only native, storage and HTTP I/O are mocked. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInThisContext } from 'node:vm';

const mobileRequire = createRequire(new URL('./mobile/package.json', import.meta.url));
const ts = mobileRequire('typescript');
const compiled = new Map();

function loadModule(path, dependencies) {
  if (!compiled.has(path)) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    compiled.set(path, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
  }
  const module = { exports: {} };
  const requireMock = name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  const execute = runInThisContext(
    `(function(require, module, exports, process, console, __DEV__) { ${compiled.get(path)}\n})`,
    { filename: path },
  );
  execute(requireMock, module, module.exports, {
    env: { EXPO_PUBLIC_VEROME_API: 'https://verome.invalid' },
  }, { ...console, warn: () => {} }, false);
  return module.exports;
}

const Event = Object.fromEntries([
  'PlaybackState', 'PlaybackProgressUpdated', 'PlaybackActiveTrackChanged',
  'PlaybackQueueEnded', 'PlaybackError',
].map(name => [name, name]));

function song(id, overrides = {}) {
  return {
    id, title: id, artist: 'Test artist', cover: '', preview: `https://audio.invalid/${id}.mp3`,
    duration: 240_000, previewOnly: false, ...overrides,
  };
}

const missing = song('missing', { source: 'youtube_music', videoId: 'missing', preview: '' });
const preview = song('preview', { source: 'youtube_music', videoId: 'preview', preview: '' });

function playerHarness({ previews = [], fullStreams = [], persistedState = null } = {}) {
  const opened = [];
  const alerts = [];
  const events = [];
  const seeks = [];
  const listeners = new Map();
  let queue = [];
  let activeIndex;
  let playing = false;
  let nextCalls = 0;
  const emit = (event, payload) => listeners.get(event)?.(payload);
  const activate = index => {
    if (!queue[index]) throw new Error('No track at index');
    const changed = activeIndex !== index;
    activeIndex = index;
    if (changed) emit(Event.PlaybackActiveTrackChanged, { track: queue[index] });
  };
  const native = {
    setupPlayer: async () => {},
    updateOptions: async () => {},
    setRepeatMode: async () => {},
    setVolume: async () => {},
    addEventListener: (event, listener) => listeners.set(event, listener),
    reset: async () => {
      queue = [];
      activeIndex = undefined;
      playing = false;
      emit(Event.PlaybackState, { state: 'Stopped' });
    },
    add: async tracks => {
      queue.push(...(Array.isArray(tracks) ? tracks : [tracks]));
      if (activeIndex === undefined && queue.length) activate(0);
    },
    skip: async index => activate(index),
    skipToNext: async () => {
      nextCalls++;
      if (activeIndex === undefined) throw new Error('Empty native queue');
      activate(activeIndex + 1);
    },
    getActiveTrack: async () => queue[activeIndex],
    getActiveTrackIndex: async () => activeIndex,
    getQueue: async () => queue,
    play: async () => {
      assert.ok(queue[activeIndex], 'Cannot play an empty queue');
      playing = true;
      emit(Event.PlaybackState, { state: 'Playing' });
    },
    seekTo: async position => seeks.push(position),
  };
  const api = loadModule('./mobile/services/musicApi.ts', {
    axios: {
      get: async (url, { params }) => {
        if (url === 'https://verome.invalid/api/stream') {
          if (!fullStreams.includes(params.id)) throw new Error('Stream unavailable');
          return { data: { success: true, streamingUrls: [{ url: `https://audio.invalid/${params.id}.mp3` }] } };
        }
        assert.equal(url, 'https://itunes.apple.com/search');
        const id = previews.find(item => params.term === `${item} Test artist`);
        return { data: { results: id ? [{
          trackId: id, trackName: id, artistName: 'Test artist', trackTimeMillis: 240_000,
          previewUrl: `https://audio.invalid/${id}-preview.m4a`,
        }] : [] } };
      },
    },
    '@react-native-async-storage/async-storage': {
      getItem: async key => key === '@pb_player_state' && persistedState
        ? JSON.stringify(persistedState)
        : null,
      setItem: async () => {},
    },
  });
  const store = loadModule('./mobile/stores/playerStore.ts', {
    'react-native': {
      Alert: { alert: (...args) => alerts.push(args) },
      Linking: { openURL: async url => opened.push(url) },
    },
    zustand: mobileRequire('zustand'),
    'react-native-track-player': {
      __esModule: true, default: native, Event,
      State: { Playing: 'Playing' }, RepeatMode: { Off: 0, Track: 1, Queue: 2 },
      Capability: {}, AppKilledPlaybackBehavior: {},
    },
    '../services/musicApi': api,
    '../services/storage': {
      addRecentlyPlayed: async () => {},
      getPersistedPlayerState: async () => persistedState,
      savePersistedPlayerState: async () => {},
    },
  });
  store.setPlayerActionListener(event => events.push(event));
  return {
    ...store, api, opened, alerts, events, seeks, native,
    queue: () => queue, playing: () => playing, nextCalls: () => nextCalls,
  };
}

test('queue-add never opens YouTube or alerts when a track is unavailable', async () => {
  const h = playerHarness();
  await h.usePlayer.getState().addToQueue(missing).catch(() => {});
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.alerts, []);
});

test('unavailable queue-add rejects without changing the logical or native queue', async () => {
  const h = playerHarness();
  const current = song('current');
  await h.usePlayer.getState().playSong(current);
  await assert.rejects(h.usePlayer.getState().addToQueue(missing), /unavailable/i);
  assert.deepEqual(h.usePlayer.getState().queue.map(item => item.id), ['current']);
  assert.deepEqual(h.queue().map(item => item.id), ['current']);
  assert.equal(h.playing(), true);
});

test('playable queue additions still succeed and duplicates are rejected', async () => {
  const h = playerHarness();
  await h.usePlayer.getState().playSong(song('current'), [], { startPaused: true });
  h.events.length = 0;
  const next = song('next');
  assert.equal(await h.usePlayer.getState().addToQueue(next), true);
  assert.equal(await h.usePlayer.getState().addToQueue(next), false);
  assert.equal(h.usePlayer.getState().queue.length, 2);
  assert.equal(h.queue().length, 2);
  assert.equal(h.playing(), false);
  assert.deepEqual(h.events, []);
});

test('concurrent queue additions are deduplicated after async resolution', async () => {
  const h = playerHarness();
  const candidate = song('concurrent', { source: 'youtube_music', videoId: 'concurrent', preview: '' });
  let release;
  let startedCount = 0;
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.api.resolveSongPlaybackUrl = async () => {
    startedCount++;
    if (startedCount === 2) resolveStarted();
    await gate;
    return { url: 'https://audio.invalid/concurrent.m4a', previewOnly: false, duration: 240_000 };
  };

  const first = h.usePlayer.getState().addToQueue(candidate);
  const second = h.usePlayer.getState().addToQueue(candidate);
  await started;
  release();

  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.deepEqual(h.usePlayer.getState().queue.map(item => item.id), ['concurrent']);
  assert.deepEqual(h.queue().map(item => item.id), ['concurrent']);
});

test('failed selection starts the next playable song, skipping other unavailable tracks', async () => {
  const h = playerHarness();
  const next = song('next');
  const missingToo = { ...missing, id: 'missing-too', videoId: 'missing-too' };
  await h.usePlayer.getState().playSong(missing, [song('previous'), missing, missingToo, next]);
  assert.deepEqual(h.queue().map(item => item.id), ['previous', 'next']);
  assert.equal((await h.native.getActiveTrack()).id, 'next');
  assert.equal(h.usePlayer.getState().currentSong.id, 'next');
  assert.equal(h.usePlayer.getState().index, 3);
  assert.equal(h.playing(), true);
  assert.equal(h.nextCalls(), 0);
  assert.equal(h.opened.length, 1, 'Only the explicitly selected track may link out');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].song.id, 'next');
});

test('fallback selection preserves paused/remote flags but resets the failed track position', async () => {
  const h = playerHarness();
  await h.usePlayer.getState().playSong(missing, [missing, song('next')], {
    initialPosition: 45_000, startPaused: true, remote: true,
  });
  assert.equal(h.usePlayer.getState().currentSong.id, 'next');
  assert.equal(h.usePlayer.getState().position, 0);
  assert.equal(h.playing(), false);
  assert.deepEqual(h.seeks, []);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].remote, true);
  assert.equal(h.events[0].isPlaying, false);
  assert.equal(h.events[0].position, 0);
});

test('all-unavailable queue stops without trying to skip an empty native queue', async () => {
  const h = playerHarness();
  await h.usePlayer.getState().playSong(missing, [missing, { ...missing, id: 'missing-too' }]);
  assert.equal(h.playing(), false);
  assert.equal(h.usePlayer.getState().isPlaying, false);
  assert.equal(h.queue().length, 0);
  assert.equal(h.nextCalls(), 0);
  assert.deepEqual(h.events, []);
});

test('failed last track wraps only when repeat-all is enabled', async () => {
  for (const repeat of ['off', 'all', 'one']) {
    const h = playerHarness();
    h.usePlayer.setState({ repeat });
    await h.usePlayer.getState().playSong(missing, [song('first'), missing]);
    assert.equal(h.playing(), repeat === 'all', repeat);
    assert.equal(h.nextCalls(), 0, repeat);
    if (repeat === 'all') assert.equal(h.usePlayer.getState().currentSong.id, 'first');
    else assert.equal(h.usePlayer.getState().isPlaying, false);
  }
});

test('a playable selection keeps its queue index, position and normal playback', async () => {
  const h = playerHarness();
  const selected = song('selected');
  await h.usePlayer.getState().playSong(selected, [song('first'), selected], { initialPosition: 5_000 });
  assert.equal((await h.native.getActiveTrack()).id, 'selected');
  assert.equal(h.usePlayer.getState().index, 1);
  assert.equal(h.usePlayer.getState().position, 5_000);
  assert.deepEqual(h.seeks, [5]);
  assert.equal(h.playing(), true);
});

test('iTunes resolution reports preview duration, not the catalog full-song duration', async () => {
  const h = playerHarness({ previews: ['preview'] });
  const resolved = await h.api.resolveSongPlaybackUrl(preview);
  assert.equal(resolved.previewOnly, true);
  assert.equal(resolved.duration, 30_000);
  assert.equal(resolved.url, 'https://audio.invalid/preview-preview.m4a');
});

test('preview duration reaches queue, current song, progress state and native metadata', async () => {
  for (const previewOnly of [false, true]) {
    const h = playerHarness({ previews: ['preview'] });
    await h.usePlayer.getState().playSong({ ...preview, previewOnly });
    const state = h.usePlayer.getState();
    assert.equal(state.currentSong.duration, 30_000);
    assert.equal(state.currentSong.previewOnly, true);
    assert.equal(state.queue[0].duration, 30_000);
    assert.equal(state.duration, 30_000);
    assert.equal(h.queue()[0].duration, 30);
    assert.equal(h.events[0].song.duration, 30_000);
    assert.equal(preview.duration, 240_000, 'Original catalog entry is not mutated');
  }
});

test('queued preview gets clip duration without starting playback', async () => {
  const h = playerHarness({ previews: ['preview'] });
  assert.equal(await h.usePlayer.getState().addToQueue(preview), true);
  assert.equal(h.usePlayer.getState().queue[0].duration, 30_000);
  assert.equal(h.queue()[0].duration, 30);
  assert.equal(h.playing(), false);
  assert.deepEqual(h.opened, []);
});

test('full streams retain their original duration', async () => {
  const h = playerHarness({ fullStreams: ['preview'] });
  await h.usePlayer.getState().playSong(preview);
  assert.equal(h.usePlayer.getState().duration, 240_000);
  assert.equal(h.usePlayer.getState().currentSong.previewOnly, false);
  assert.equal(h.queue()[0].duration, 240);
});

test('player restores the persisted queue without starting playback', async () => {
  const persisted = {
    queue: [song('restored'), song('next')],
    currentSongId: 'restored',
    index: 0,
    position: 12_000,
    shuffle: true,
    repeat: 'all',
    volume: 0.6,
  };
  const h = playerHarness({ persistedState: persisted });
  await h.initializePlayer();

  const state = h.usePlayer.getState();
  assert.deepEqual(state.queue.map(item => item.id), ['restored', 'next']);
  assert.equal(state.currentSong.id, 'restored');
  assert.equal(state.position, 12_000);
  assert.equal(state.shuffle, true);
  assert.equal(state.repeat, 'all');
  assert.equal(state.volume, 0.6);
  assert.equal(state.isPlaying, false);
  assert.deepEqual(new Set(h.queue().map(item => item.id)), new Set(['restored', 'next']));
  assert.equal(h.playing(), false);
});

test('room queue UI shows an error, not success or duplicate, for an unavailable track', async () => {
  const h = playerHarness();
  const toasts = [];
  let buttons;
  const { promptAddSong } = loadModule('./mobile/utils/songActions.ts', {
    'react-native': { Alert: { alert: (_title, _message, actions) => { buttons = actions; } } },
    'react-native-toast-message': { show: toast => toasts.push(toast) },
    '../stores/roomStore': { useRoom: { getState: () => ({ code: 'TEST' }) } },
    '../stores/playlistStore': {},
    '../services/roomSync': {
      addSongToRoomQueue: async item => await h.usePlayer.getState().addToQueue(item) ? 'added' : 'duplicate',
    },
  });
  promptAddSong(missing);
  buttons.find(button => button.text === 'Add to Room Queue').onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, 'error');
  assert.equal(toasts[0].text1, 'Song abhi available nahi hai');
  assert.deepEqual(h.opened, []);
});

test('superseded resolution cannot replace the newer selected song', async () => {
  const h = playerHarness();
  let release;
  let started;
  const resolving = new Promise(resolve => { started = resolve; });
  h.api.resolveSongPlaybackUrl = () => {
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const oldLoad = h.usePlayer.getState().playSong(preview);
  await resolving;
  const newLoad = h.usePlayer.getState().playSong(song('new'));
  const selections = [];
  const unsubscribe = h.usePlayer.subscribe(state => selections.push(state.currentSong.id));
  release({ url: 'https://audio.invalid/old.m4a', previewOnly: true, duration: 30_000 });
  await Promise.all([oldLoad, newLoad]);
  unsubscribe();
  assert.ok(selections.every(id => id === 'new'));
  assert.deepEqual(h.queue().map(item => item.id), ['new']);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].song.id, 'new');
});
