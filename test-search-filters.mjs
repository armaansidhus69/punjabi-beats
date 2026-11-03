import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchIndex, dedupeSearchSongs } from './mobile/utils/searchFilters.ts';

function song(id, overrides = {}) {
  return {
    id,
    title: id,
    artist: 'Test Artist',
    album: 'Test Album',
    cover: `https://img.invalid/${id}.jpg`,
    preview: `https://audio.invalid/${id}.mp3`,
    duration: 180_000,
    source: 'jiosaavn',
    ...overrides,
  };
}

test('search index deduplicates duplicate provider rows', () => {
  const index = buildSearchIndex(
    [
      song('Softly', { title: 'Softly', artist: 'Karan Aujla' }),
      song('softly-copy', { title: 'softly', artist: 'Karan Aujla, Ikky' }),
      song('Cheques', { title: 'Cheques', artist: 'Shubh' }),
    ],
    [],
    'softly',
  );

  assert.equal(index.songs.length, 1);
  assert.equal(index.artists.length, 1);
  assert.equal(index.artists[0].name, 'Karan Aujla');
});

test('songs, artists and albums use independent case-insensitive matches and counts', () => {
  const index = buildSearchIndex(
    [
      song('one', { title: 'Softly', artist: 'Karan Aujla', album: 'Making Memories' }),
      song('two', { title: 'Winning Speech', artist: 'Karan Aujla', album: 'Making Memories' }),
      song('three', { title: 'Softly Remix', artist: 'Another Artist', album: 'Remix Collection' }),
    ],
    [
      { id: 'playlist-1', name: 'Karan Favourites', songs: [], createdAt: 1 },
      { id: 'playlist-2', name: 'Workout', songs: [], createdAt: 2 },
    ],
    'KARAN',
  );

  assert.equal(index.songs.length, 2);
  assert.equal(index.artists.length, 1);
  assert.equal(index.artists[0].count, 2);
  assert.equal(index.albums.length, 1);
  assert.equal(index.albums[0].title, 'Making Memories');
  assert.equal(index.albums[0].count, 2);
  assert.equal(index.playlists.length, 1);
});

test('partial album queries return the matching album and its related songs', () => {
  const index = buildSearchIndex(
    [
      song('one', { title: 'Softly', artist: 'Karan Aujla', album: 'Making Memories' }),
      song('two', { title: 'Winning Speech', artist: 'Karan Aujla', album: 'Making Memories' }),
      song('three', { title: 'Tauba Tauba', artist: 'Karan Aujla', album: 'Other Release' }),
    ],
    [],
    'memories',
  );

  assert.equal(index.songs.length, 2);
  assert.equal(index.artists.length, 1);
  assert.equal(index.albums.length, 1);
  assert.equal(index.albums[0].title, 'Making Memories');
  assert.equal(index.albums[0].count, 2);
});

test('album search does not invent albums from song titles', () => {
  const index = buildSearchIndex(
    [song('one', { title: '295', artist: 'Sidhu Moose Wala', album: undefined })],
    [],
    '295',
  );

  assert.equal(index.songs.length, 1);
  assert.deepEqual(index.albums, []);
});

test('dedupe helper keeps distinct albums separate', () => {
  const songs = [
    song('one', { title: 'Intro', artist: 'Artist', album: 'Album A' }),
    song('two', { title: 'Intro', artist: 'Artist', album: 'Album B' }),
  ];

  assert.equal(dedupeSearchSongs(songs).length, 2);
});
