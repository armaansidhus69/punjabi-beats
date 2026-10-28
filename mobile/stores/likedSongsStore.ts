import { create } from 'zustand';
import { Song } from '../types';
import { getLikedSongs, saveLikedSongs } from '../services/storage';
import { isLikedSong, removeLikedSong, toggleLikedSong } from '../utils/likedSongs';

interface LikedSongsStore {
  songs: Song[];
  loaded: boolean;
  load: () => Promise<void>;
  isLiked: (songId: string) => boolean;
  toggleLiked: (song: Song) => boolean;
  removeLiked: (songId: string) => void;
  clearLiked: () => void;
}

let loadPromise: Promise<void> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

function persist(songs: Song[]): void {
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(() => saveLikedSongs(songs));
}

export const useLikedSongs = create<LikedSongsStore>()((set, get) => ({
  songs: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    if (!loadPromise) {
      loadPromise = getLikedSongs()
        .then(songs => {
          set({ songs, loaded: true });
        })
        .catch(err => {
          console.warn('Liked songs load failed:', err);
          set({ songs: [], loaded: true });
        })
        .finally(() => {
          loadPromise = null;
        });
    }
    await loadPromise;
  },

  isLiked: songId => isLikedSong(get().songs, songId),

  toggleLiked: song => {
    const result = toggleLikedSong(get().songs, song);
    set({ songs: result.songs });
    persist(result.songs);
    return result.liked;
  },

  removeLiked: songId => {
    const songs = removeLikedSong(get().songs, songId);
    set({ songs });
    persist(songs);
  },

  clearLiked: () => {
    set({ songs: [] });
    persist([]);
  },
}));
