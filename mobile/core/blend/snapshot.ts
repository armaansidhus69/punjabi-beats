/**
 * Taste snapshot builder (Phase 10 Blend).
 * liked + playlists ka compact, deterministic payload banata hai jo
 * blend_snapshots me upsert hota hai aur Edge Function pool karta hai.
 *
 * Pure logic hai — koi RN/supabase import nahi (headless tests chalte hain).
 */

import type { Playlist, SongSource, Song, TasteArtist, TasteSnapshot, TasteSnapshotSong } from '../../types';

/** Liked songs ko playlist occurrences se zyada weight (stronger signal) */
const LIKE_WEIGHT = 2;
const PLAYLIST_WEIGHT = 1;
export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_SONGS = 40;
export const MAX_SNAPSHOT_ARTISTS = 15;

/** "A, B" display string → ["A", "B"] (musicApi mappers comma-join karte hain) */
function splitArtistNames(artist: string): string[] {
  return artist
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
}

/** song coordinates (har source ka mapper → common Song) se denormalized shot */
function toSnapshotSong(song: Song, count: number): TasteSnapshotSong {
  return {
    id: song.id,
    title: song.title,
    artistNames: splitArtistNames(song.artist),
    artworkUrl: song.cover,
    provider: (song.source ?? 'jiosaavn') as SongSource,
    durationSec: Math.round(song.duration / 1000),
    playableFull: !song.previewOnly,
    count,
  };
}

/**
 * Playlist songs order-stable hai (playlist me manual order hota hai),
 * isliye counting pehle karte hain, phir sorting deterministically.
 */
function countSongOccurrences(likedSongs: Song[], playlists: Playlist[]): Map<string, { song: Song; count: number }> {
  const map = new Map<string, { song: Song; count: number }>();

  const bump = (song: Song, weight: number): void => {
    const entry = map.get(song.id);
    if (entry) {
      entry.count += weight;
    } else {
      map.set(song.id, { song, count: weight });
    }
  };

  likedSongs.forEach(song => bump(song, LIKE_WEIGHT));
  playlists.forEach(playlist => {
    playlist.songs.forEach(song => bump(song, PLAYLIST_WEIGHT));
  });

  return map;
}

/**
 * Pure UTF-8 encoder (no Buffer/TextEncoder hard dependency) — Node, RN
 * Hermes aur Deno me same bytes deta hai (copies ke parity je liye zaruri).
 */
function utf8Bytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/**
 * FNV-1a 64-bit — BigInt se clean math (Hermes/RN 0.74 + Node dono support
 * karte hain). Input: sorted, deduped song ids; output: 16-char hex.
 */
export function fnv1a64Hex(parts: readonly string[]): string {
  const offsetBasis = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;

  let hash = offsetBasis;
  for (const part of parts) {
    for (const byte of utf8Bytes(part)) {
      hash = ((hash ^ BigInt(byte)) * prime) & mask64;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** Snapshot builder — liked + playlists se top songs/artists */
export function buildTasteSnapshot(likedSongs: Song[], playlists: Playlist[]): TasteSnapshot {
  const counts = countSongOccurrences(likedSongs, playlists);

  const songIds = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const libraryHash = fnv1a64Hex(songIds);

  // Sort: count desc, phir id asc (deterministic across devices)
  const songs: TasteSnapshotSong[] = [...counts.values()]
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.song.id.localeCompare(b.song.id);
    })
    .slice(0, MAX_SNAPSHOT_SONGS)
    .map(entry => toSnapshotSong(entry.song, entry.count));

  const artistCounts = new Map<string, number>();
  for (const { song, count } of counts.values()) {
    // duplicate-less artist names (split + strip) — repeat occurrences sum
    const seen = new Set<string>();
    for (const name of splitArtistNames(song.artist)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + count);
    }
  }

  const artists: TasteArtist[] = [...artistCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SNAPSHOT_ARTISTS);

  return { version: SNAPSHOT_VERSION, libraryHash, songs, artists };
}
