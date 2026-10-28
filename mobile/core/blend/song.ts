/**
 * BlendItem → Song adapter — detail screen ki playlist ko existing
 * SongItem/playerStore pipeline me chalanе ke liye. preview khali string
 * jaata hai; playerStore.playSong khud resolveSongPlaybackUrl se resolve
 * karta hai (cached stream + fallback chain).
 */

import type { BlendItem, Song } from '../../types';

export function blendItemToSong(item: BlendItem): Song {
  return {
    id: item.trackId,
    title: item.track.title,
    artist: item.track.artistNames.join(', '),
    cover: item.track.artworkUrl,
    preview: '',
    duration: Math.max(0, item.track.durationSec) * 1000,
    source: item.track.provider,
    previewOnly: !item.track.playableFull,
  };
}
