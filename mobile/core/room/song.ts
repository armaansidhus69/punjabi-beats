/**
 * JamTrack → Song adapter — room queue/state ko existing playerStore
 * pipeline (resolveSongPlaybackUrl + fallback chain) me chalanе ke liye.
 * preview khali string jaata hai — playerStore khud resolve karta hai.
 *
 * Pure logic — test-jam.mjs headless use karta hai (RN import nahi).
 */

import type { JamPlaybackState, JamQueueItem, JamTrack, Song } from '../../types';

export function jamTrackToSong(track: JamTrack, trackId: string): Song {
  return {
    id: trackId,
    title: track.title,
    artist: track.artistNames.join(', '),
    cover: track.artworkUrl,
    preview: '',
    duration: Math.max(0, track.durationSec) * 1000,
    source: track.provider,
    previewOnly: !track.playableFull,
  };
}

export function jamQueueItemToSong(item: JamQueueItem): Song {
  return jamTrackToSong(item.track, item.trackId);
}

/** Server playback row → (song, initialPositionMs) resolve; null = khaali state */
export function playbackToSong(state: JamPlaybackState): { song: Song; positionMs: number } | null {
  if (!state.trackId || !state.track) return null;
  return { song: jamTrackToSong(state.track, state.trackId), positionMs: state.positionMs };
}
