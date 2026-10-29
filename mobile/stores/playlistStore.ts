/**
 * Playlist store (Zustand) — create/delete/add/remove + AsyncStorage persistence.
 * Har mutation ke baad immediately persist hota hai (FR-4.6).
 * Add-to-playlist sheet ka global open/close state bhi yahin hai, taaki Home/
 * Mood/Search jaise kisi bhi screen se SongItem ka '+' button usse khol sake.
 */
import { create } from 'zustand';
import { Playlist, Song } from '../types';
import { getPlaylists, savePlaylists } from '../services/storage';
import { trackEvent } from '../core/analytics/analytics';
import type { ImportedPlaylist } from '../utils/playlistImport';

function generatePlaylistId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PlaylistStore {
  playlists: Playlist[];
  loaded: boolean;
  load: () => Promise<void>;
  createPlaylist: (name: string) => Playlist;
  importPlaylists: (playlists: ImportedPlaylist[]) => Promise<Playlist[]>;
  deletePlaylist: (id: string) => void;
  /** returns false agar duplicate song ho (FR-4.7) */
  addSongToPlaylist: (playlistId: string, song: Song) => Promise<boolean>;
  removeSongFromPlaylist: (playlistId: string, songId: string) => void;
  /* ---------- Add-to-playlist sheet ka global UI state (Phase 9) ---------- */
  /** jis song ke '+' pe tap hua — null hone ka matlab sheet band hai */
  activeSongForAdd: Song | null;
  openAddSheet: (song: Song) => void;
  closeAddSheet: () => void;
}

export const usePlaylists = create<PlaylistStore>()((set, get) => ({
  playlists: [],
  loaded: false,
  activeSongForAdd: null,

  load: async () => {
    const list = await getPlaylists();
    set({ playlists: list, loaded: true });
  },

  createPlaylist: name => {
    const playlist: Playlist = {
      id: generatePlaylistId(),
      name: name.trim(),
      songs: [],
      createdAt: Date.now(),
    };
    const next = [...get().playlists, playlist];
    set({ playlists: next });
    void savePlaylists(next);
    return playlist;
  },

  importPlaylists: async imported => {
    const existing = get().playlists;
    const usedNames = new Set(existing.map(playlist => playlist.name.trim().toLowerCase()));
    const created: Playlist[] = [];

    for (const item of imported) {
      const baseName = item.name.trim() || 'Imported playlist';
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name.toLowerCase())) {
        name = `${baseName} (${suffix})`;
        suffix += 1;
      }
      usedNames.add(name.toLowerCase());
      created.push({
        id: generatePlaylistId(),
        name,
        songs: item.songs,
        createdAt: Date.now(),
      });
    }

    const next = [...existing, ...created];
    set({ playlists: next });
    await savePlaylists(next);
    return created;
  },

  deletePlaylist: id => {
    const next = get().playlists.filter(p => p.id !== id);
    set({ playlists: next });
    void savePlaylists(next);
  },

  addSongToPlaylist: async (playlistId, song) => {
    const target = get().playlists.find(p => p.id === playlistId);
    if (!target) return false;
    // FR-4.7: same playlist me duplicate song allowed nahi
    if (target.songs.some(s => s.id === song.id)) return false;
    const updated: Playlist = { ...target, songs: [...target.songs, song] };
    const next = get().playlists.map(p => (p.id === playlistId ? updated : p));
    set({ playlists: next });
    await savePlaylists(next);
    // Phase 13a — playlist add taste signal
    trackEvent('playlist_add', {
      songId: song.id,
      artistNames: song.artist,
      provider: song.source ?? null,
      durationMs: song.duration,
    });
    return true;
  },

  removeSongFromPlaylist: (playlistId, songId) => {
    const removed = get().playlists
      .find(p => p.id === playlistId)
      ?.songs.find(s => s.id === songId);
    const next = get().playlists.map(p =>
      p.id === playlistId
        ? { ...p, songs: p.songs.filter(s => s.id !== songId) }
        : p,
    );
    set({ playlists: next });
    void savePlaylists(next);
    if (removed) {
      // Phase 13a — playlist remove net-counter hai (add ka minus)
      trackEvent('playlist_remove', {
        songId: removed.id,
        artistNames: removed.artist,
        provider: removed.source ?? null,
        durationMs: removed.duration,
      });
    }
  },

  openAddSheet: song => {
    set({ activeSongForAdd: song });
  },

  closeAddSheet: () => {
    set({ activeSongForAdd: null });
  },
}));
