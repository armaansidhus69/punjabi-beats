import type { Song } from '../types';

export interface LikedSongsToggleResult {
  songs: Song[];
  liked: boolean;
}

export function isLikedSong(songs: Song[], songId: string): boolean {
  return songs.some(song => song.id === songId);
}

export function toggleLikedSong(songs: Song[], song: Song): LikedSongsToggleResult {
  if (isLikedSong(songs, song.id)) {
    return {
      songs: songs.filter(item => item.id !== song.id),
      liked: false,
    };
  }

  return {
    songs: [song, ...songs],
    liked: true,
  };
}

export function removeLikedSong(songs: Song[], songId: string): Song[] {
  return songs.filter(song => song.id !== songId);
}
