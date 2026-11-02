/**
 * Downloads service (Phase 6 v1) — stream-cache downloads with explicit
 * user intent.
 *
 * Free-forever app + open-source URLs isliye plan wala DRM/license model
 * N/A hai: "download" = full audio stream ko app-sandbox me file save karna
 * (license_expiry field skip). playerStore.resolveTrack downloads ko FIRST
 * check karta hai (getDownloadedUrl sync in-memory) — offline playback +
 * data bachat. UI flag-gated hai (`downloads_enabled`).
 *
 * v1 note: downloadAsync granular progress nahi deta — progress 0→50→100
 * coarse rehta hai (pause/resume v2 me resumable API ke saath).
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import type { Song } from '../types';
import {
  reduceDownload,
  isPlayableOffline,
  type DownloadEvent,
  type DownloadItem,
  type DownloadStatus,
} from '../core/downloads/stateMachine';
import { readLocalJson, writeLocalJson } from '../core/database/localStore';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { trackEvent } from '../core/analytics/analytics';

const STORE_KEY = '@pb_downloads';
const DOWNLOADS_DIR = `${FileSystem.documentDirectory ?? ''}pb-downloads/`;

/** songId filesystem-safe banao (URL-safe ids already, phir bhi guard). */
function safeFileId(songId: string): string {
  return songId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'song';
}

function makeItem(song: Song): DownloadItem {
  return { id: song.id, song, status: 'queued', progress: 0, updatedAt: Date.now() };
}

interface DownloadsState {
  items: DownloadItem[];
  hydrated: boolean;
  /** store init — persisted items restore (file existence trust karte hain) */
  hydrate: () => Promise<void>;
  download: (song: Song) => Promise<boolean>;
  remove: (songId: string) => Promise<void>;
  retry: (songId: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

function patchItem(
  items: DownloadItem[],
  songId: string,
  event: DownloadEvent,
): { items: DownloadItem[]; changed: boolean } {
  let changed = false;
  const next = items.map(item => {
    if (item.id !== songId) return item;
    const updated = reduceDownload(item, event);
    if (updated !== item) changed = true;
    return updated;
  });
  return { items: changed ? next : items, changed };
}

async function persist(items: DownloadItem[]): Promise<void> {
  try {
    await writeLocalJson(STORE_KEY, items);
  } catch (err) {
    console.warn('[downloads] persist failed:', err);
  }
}

export const useDownloads = create<DownloadsState>()((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const stored = await readLocalJson<DownloadItem[]>(STORE_KEY);
      const items = Array.isArray(stored) ? stored.filter(item => item?.id && item.song) : [];
      set({ items, hydrated: true });
    } catch (err) {
      console.warn('[downloads] hydrate failed:', err);
      set({ items: [], hydrated: true });
    }
  },

  download: async song => {
    if (!isFeatureEnabled('downloads_enabled')) return false;
    const existing = get().items.find(item => item.id === song.id);
    if (existing && (existing.status === 'downloading' || existing.status === 'downloaded')) {
      return existing.status === 'downloaded';
    }
    const item = existing ?? makeItem(song);
    const items = existing ? get().items : [...get().items, item];
    set({ items: patchItem(items, song.id, { type: 'start' }).items });
    try {
      await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true }).catch(() => undefined);
      const fileName = `${safeFileId(song.id)}.mp3`;
      const filePath = `${DOWNLOADS_DIR}${fileName}`;
      const result = await FileSystem.downloadAsync(song.preview, filePath);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`HTTP ${result.status}`);
      }
      const { items: withFile, changed } = patchItem(get().items, song.id, {
        type: 'complete',
        filePath: result.uri,
        sizeBytes: Number(result.headers?.['Content-Length'] ?? undefined) || undefined,
      });
      if (changed) {
        set({ items: withFile });
        await persist(withFile);
        trackEvent('download_complete', { songId: song.id });
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { items: failed, changed } = patchItem(get().items, song.id, { type: 'fail', error: message });
      if (changed) {
        set({ items: failed });
        await persist(failed);
      }
      trackEvent('download_failed', { songId: song.id });
      return false;
    }
  },

  remove: async songId => {
    const item = get().items.find(entry => entry.id === songId);
    if (!item) return;
    if (item.filePath) {
      await FileSystem.deleteAsync(item.filePath, { idempotent: true }).catch(() => undefined);
    }
    const items = get().items.filter(entry => entry.id !== songId);
    set({ items });
    await persist(items);
  },

  retry: async songId => {
    const item = get().items.find(entry => entry.id === songId);
    if (!item) return;
    const { items, changed } = patchItem(get().items, songId, { type: 'retry' });
    if (!changed) return;
    set({ items });
    await get().download(item.song);
  },

  clearAll: async () => {
    await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true }).catch(() => undefined);
    set({ items: [] });
    await persist([]);
  },
}));

/** Sync lookup — playerStore.resolveTrack har queue item ke liye call karta hai. */
export function getDownloadedUrl(songId: string): string | null {
  const item = useDownloads.getState().items.find(entry => entry.id === songId);
  if (!item || !isPlayableOffline(item) || !item.filePath) return null;
  return item.filePath;
}

export function getDownloadStatus(songId: string): DownloadStatus | null {
  return useDownloads.getState().items.find(entry => entry.id === songId)?.status ?? null;
}

/** Storage usage — Downloads screen header me dikhta hai. */
export function getTotalBytes(items: DownloadItem[]): number {
  return items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
}
