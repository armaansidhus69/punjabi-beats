/**
 * Signed-share landing state (Phase 8a).
 * Token resolve + catalog actions yahan; screen sirf typed navigation karta.
 */

import { create } from 'zustand';
import Toast from 'react-native-toast-message';
import type { Song } from '../types';
import {
  shareAction,
  type ResolvedSharePayload,
  type ShareAction,
  type SharedTrackDescriptor,
} from '../core/share/share';
import { resolveShareToken, ShareServiceError } from '../services/shareService';
import { searchSongs } from '../services/musicApi';
import { usePlayer } from './playerStore';
import { usePlaylists } from './playlistStore';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';

interface ShareStore {
  token: string;
  payload: ResolvedSharePayload | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  resolvedSongs: Song[];
  importedPlaylistId: string | null;

  openToken: (token: string) => Promise<boolean>;
  retry: () => Promise<boolean>;
  clear: () => void;
  performPrimaryAction: () => Promise<ShareAction | null>;
  playResolved: () => Promise<boolean>;
}

let requestToken = 0;

function shareErrorText(err: unknown): string {
  if (err instanceof ShareServiceError) {
    if (err.code === 'bad_request' || err.code === 'invalid') return 'Share link invalid ya expire ho gaya';
    if (err.code === 'no_key') return 'Share API app build me configure nahi hai';
  }
  return 'Share link load nahi hua — network check karo';
}

async function resolveDescriptor(descriptor: SharedTrackDescriptor): Promise<Song | null> {
  try {
    const songs = await searchSongs(`${descriptor.title} ${descriptor.artist}`, 5);
    const playable = songs.filter(song => song.preview.length > 0);
    return playable.find(song => song.previewOnly !== true) ?? playable[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveDescriptors(descriptors: SharedTrackDescriptor[]): Promise<Song[]> {
  const found: Song[] = [];
  for (let index = 0; index < descriptors.length; index += 3) {
    const batch = descriptors.slice(index, index + 3);
    const results = await Promise.all(batch.map(resolveDescriptor));
    for (const song of results) {
      if (song && !found.some(existing => existing.id === song.id)) found.push(song);
    }
  }
  return found;
}

export const useShare = create<ShareStore>((set, get) => ({
  token: '',
  payload: null,
  loading: false,
  error: null,
  busy: false,
  resolvedSongs: [],
  importedPlaylistId: null,

  openToken: async token => {
    const request = ++requestToken;
    set({
      token,
      payload: null,
      loading: true,
      error: null,
      busy: false,
      resolvedSongs: [],
      importedPlaylistId: null,
    });
    try {
      const payload = await resolveShareToken(token);
      if (request !== requestToken || get().token !== token) return false;
      set({ payload, loading: false });
      return true;
    } catch (err) {
      if (request !== requestToken || get().token !== token) return false;
      set({ loading: false, error: shareErrorText(err) });
      return false;
    }
  },

  retry: async () => {
    const token = get().token;
    if (token.length === 0) return false;
    return get().openToken(token);
  },

  clear: () => {
    requestToken += 1;
    set({
      token: '',
      payload: null,
      loading: false,
      error: null,
      busy: false,
      resolvedSongs: [],
      importedPlaylistId: null,
    });
  },

  performPrimaryAction: async () => {
    const payload = get().payload;
    if (!payload || get().busy) return null;
    const action = shareAction(payload);
    tapFeedback();
    if (action.type === 'navigate') {
      successFeedback();
      Toast.show({ type: 'success', text1: 'Signed invite verify ho gaya' });
      return action;
    }

    set({ busy: true, error: null });
    try {
      if (action.type === 'play_track') {
        const descriptor = payload.kind === 'track' || payload.kind === 'lyrics'
          ? payload.data
          : null;
        const song = descriptor ? await resolveDescriptor(descriptor) : null;
        if (!song) throw new Error('track_not_found');
        await usePlayer.getState().playSong(song, [song], { startPaused: false });
        if (action.startMs !== undefined) {
          await usePlayer.getState().seek(action.startMs);
        }
        set({ resolvedSongs: [song] });
        successFeedback();
        Toast.show({
          type: 'success',
          text1:
            payload.kind === 'lyrics'
              ? 'Shared lyrics track chal raha hai'
              : 'Shared track chal raha hai',
        });
        return action;
      }

      const songs = await resolveDescriptors(action.tracks);
      if (songs.length === 0) throw new Error('playlist_empty');
      const playlists = usePlaylists.getState();
      const playlist = playlists.createPlaylist(`Shared: ${action.name}`.slice(0, 80));
      for (const song of songs) {
        await playlists.addSongToPlaylist(playlist.id, song);
      }
      set({ resolvedSongs: songs, importedPlaylistId: playlist.id });
      successFeedback();
      Toast.show({
        type: 'success',
        text1: 'Shared playlist import ho gayi',
        text2: `${songs.length}/${action.tracks.length} tracks mile`,
      });
      return action;
    } catch (err) {
      console.warn('[share] primary action failed:', err instanceof Error ? err.message : 'unknown');
      warningFeedback();
      Toast.show({
        type: 'error',
        text1: action.type === 'play_track' ? 'Shared track nahi mila' : 'Playlist tracks nahi mile',
      });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  playResolved: async () => {
    const songs = get().resolvedSongs;
    if (songs.length === 0 || get().busy) return false;
    tapFeedback();
    set({ busy: true });
    try {
      await usePlayer.getState().playSong(songs[0], songs, { startPaused: false });
      successFeedback();
      Toast.show({ type: 'success', text1: 'Shared playlist chal rahi hai' });
      return true;
    } catch (err) {
      console.warn('[share] play resolved failed:', err);
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Playlist play nahi hui' });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
