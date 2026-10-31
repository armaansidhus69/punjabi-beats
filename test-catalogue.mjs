/**
 * Phase 3 — Catalogue core unit tests (headless).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeArtistName,
  slugify,
  matchCuratedArtist,
  extractAlbumsFromSongs,
} from './mobile/core/catalogue/catalogue.ts';

test('normalizeArtistName — strips features, extras, and trims', () => {
  assert.equal(normalizeArtistName('Diljit Dosanjh (feat. Sia)'), 'Diljit Dosanjh');
  assert.equal(normalizeArtistName('  Sidhu Moose Wala [Official Audio]  '), 'Sidhu Moose Wala');
  assert.equal(normalizeArtistName('Karan Aujla, Ikky'), 'Karan Aujla');
  assert.equal(normalizeArtistName('AP Dhillon & Gurinder Gill'), 'AP Dhillon');
  assert.equal(normalizeArtistName(''), '');
});

test('slugify — creates clean route slugs', () => {
  assert.equal(slugify('Diljit Dosanjh'), 'diljit-dosanjh');
  assert.equal(slugify('G.O.A.T.'), 'goat');
  assert.equal(slugify('295 — Sidhu Moose Wala'), '295-sidhu-moose-wala');
  assert.equal(slugify('  '), 'unknown');
});

test('matchCuratedArtist — matches exact and case-insensitive names', () => {
  const sampleArtists = [
    { id: 'diljit-dosanjh', name: 'Diljit Dosanjh', image: 'url1' },
    { id: 'sidhu-moose-wala', name: 'Sidhu Moose Wala', image: 'url2' },
  ];

  const m1 = matchCuratedArtist('Diljit Dosanjh', sampleArtists);
  assert.equal(m1?.id, 'diljit-dosanjh');

  const m2 = matchCuratedArtist('diljit', sampleArtists);
  assert.equal(m2?.id, 'diljit-dosanjh');

  const m3 = matchCuratedArtist('Sidhu Moose Wala (feat. Sunny Malton)', sampleArtists);
  assert.equal(m3?.id, 'sidhu-moose-wala');

  const m4 = matchCuratedArtist('Unknown Singer', sampleArtists);
  assert.equal(m4, null);
});

test('extractAlbumsFromSongs — extracts unique album names from song list', () => {
  const songs = [
    { id: '1', title: 'G.O.A.T.', artist: 'Diljit Dosanjh', cover: 'cover1.jpg', duration: 180000, preview: '' },
    { id: '2', title: 'Clash', artist: 'Diljit Dosanjh', cover: 'cover1.jpg', duration: 170000, preview: '' },
    { id: '3', title: 'Born to Shine', artist: 'Diljit Dosanjh', cover: 'cover1.jpg', duration: 190000, preview: '' },
    { id: '4', title: 'Lover', artist: 'Diljit Dosanjh', cover: 'cover2.jpg', duration: 200000, preview: '' },
  ];

  const albums = extractAlbumsFromSongs(songs, 'Diljit Dosanjh');
  assert.ok(albums.length >= 1);
  assert.equal(albums[0].artist, 'Diljit Dosanjh');
});
