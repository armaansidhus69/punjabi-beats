/**
 * AI playlist store (Phase 13b) — generation flow state (zustand).
 *
 * Server call service me, screen sirf render — pattern podcasts/blend jaisa.
 * Save naya ledger nahi banata: playlistStore ke createPlaylist +
 * addSongToPlaylist reuse hote hain (FR-4.7 dedupe wahan already hai).
 */

import { create } from 'zustand';
import Toast from 'react-native-toast-message';
import type { AiPlanRow, AiPromptHistoryEntry } from '../types';
import {
  appendPromptHistory,
  describeAiPlaylistError,
  generatePlaylist,
  loadPromptHistory,
  resolveCandidates,
} from '../services/aiPlaylistService';
import { countPlayable } from '../core/ai/playlist';
import { usePlayer } from './playerStore';
import { usePlaylists } from './playlistStore';
import { selectionFeedback, successFeedback, warningFeedback } from '../utils/haptics';

/** save-name default: prompt truncate 40 (screen chip/rss me bhi isi se) */
function defaultPlaylistName(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.length <= 40 ? `AI: ${clean}` : `AI: ${clean.slice(0, 39)}…`;
}

interface AiPlaylistStore {
  planRows: AiPlanRow[];
  /** server quota echo — generation ke baad set */
  remaining: number | null;
  busy: boolean;
  history: AiPromptHistoryEntry[];
  historyLoaded: boolean;
  /** last successful prompt — default save-name ke liye */
  lastPrompt: string;

  initialize: () => Promise<void>;
  generate: (prompt: string, options?: { refineText?: string }) => Promise<boolean>;
  removeRow: (index: number) => void;
  playAll: () => Promise<void>;
  saveAsPlaylist: (name?: string) => Promise<boolean>;
}

export const useAiPlaylist = create<AiPlaylistStore>((set, get) => ({
  planRows: [],
  remaining: null,
  busy: false,
  history: [],
  historyLoaded: false,
  lastPrompt: '',

  initialize: async () => {
    if (get().historyLoaded) return;
    const history = await loadPromptHistory();
    set({ history, historyLoaded: true });
  },

  generate: async (prompt, options) => {
    const trimmed = prompt.trim();
    if (trimmed.length < 2) {
      Toast.show({ type: 'info', text1: 'Prompt thoda lamba likho (min 2 chars)' });
      selectionFeedback();
      return false;
    }
    if (get().busy) return false;
    set({ busy: true });
    selectionFeedback();
    try {
      // history me fail attempts bhi nahi jate — sirf successful prompt save
      const { tracks, remaining } = await generatePlaylist(trimmed, options);
      const rows = await resolveCandidates(tracks);
      set({
        planRows: rows,
        remaining,
        lastPrompt: trimmed,
        history: await appendPromptHistory(get().history, {
          prompt: trimmed,
          refineText: options?.refineText,
          ts: new Date().toISOString(),
        }),
      });
      successFeedback();
      const matched = countPlayable(rows);
      Toast.show({ type: 'success', text1: `AI playlist ready — ${matched} tracks matched` });
      return true;
    } catch (err) {
      warningFeedback();
      Toast.show({ type: 'error', text1: describeAiPlaylistError(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  removeRow: index => {
    const rows = get().planRows;
    if (index < 0 || index >= rows.length) return;
    selectionFeedback();
    set({ planRows: rows.filter((_, cursor) => cursor !== index) });
  },

  playAll: async () => {
    const playable = get()
      .planRows.filter(row => row.song !== null)
      .map(row => row.song!);
    if (playable.length === 0) {
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Playable gaane nahi — dobara generate karo' });
      return;
    }
    successFeedback();
    // normal playSong pipeline — signals/skip policy automatically lagti rehti hai
    await usePlayer.getState().playSong(playable[0], playable, { startPaused: false });
  },

  saveAsPlaylist: async name => {
    const playable = get()
      .planRows.filter(row => row.song !== null)
      .map(row => row.song!);
    if (playable.length === 0) {
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Save karne layak kuch nahi hai' });
      return false;
    }
    const playlistStore = usePlaylists.getState();
    const playlist = playlistStore.createPlaylist(name?.trim() || defaultPlaylistName(get().lastPrompt || 'AI playlist'));
    for (const song of playable) {
      await playlistStore.addSongToPlaylist(playlist.id, song);
    }
    successFeedback();
    Toast.show({ type: 'success', text1: `Saved "${playlist.name}" — ${playable.length} tracks` });
    return true;
  },
}));
