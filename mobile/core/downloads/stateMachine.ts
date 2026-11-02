/**
 * Downloads state machine (Phase 6 v1) — pure transition reducer.
 *
 * States plan ke download model se (available hata ke v1 me queued se start —
 * free-forever app me license/expiry N/A hai, open-source URLs). Service
 * (downloadsService) FileSystem calls karta hai aur events dispatch; yahan
 * sirf legal transitions — invalid event pe item UNCHANGED wapas (fail-safe).
 */

import type { Song } from '../../types';

export type DownloadStatus = 'queued' | 'downloading' | 'downloaded' | 'failed';

export interface DownloadItem {
  /** song.id — ek song ka ek hi download (dedupe by id) */
  id: string;
  song: Song;
  status: DownloadStatus;
  /** local file:// path — sirf downloaded me set */
  filePath?: string;
  /** 0..100 */
  progress: number;
  sizeBytes?: number;
  error?: string;
  updatedAt: number;
}

export type DownloadEvent =
  | { type: 'start' }
  | { type: 'progress'; progress: number }
  | { type: 'complete'; filePath: string; sizeBytes?: number }
  | { type: 'fail'; error: string }
  | { type: 'retry' }
  | { type: 'delete' };

const LEGAL: Record<DownloadStatus, DownloadEvent['type'][]> = {
  queued: ['start', 'delete'],
  downloading: ['progress', 'complete', 'fail', 'delete'],
  downloaded: ['delete', 'retry'],
  failed: ['retry', 'delete'],
};

function canTransition(status: DownloadStatus, type: DownloadEvent['type']): boolean {
  return LEGAL[status].includes(type);
}

/** Ek event ka asar — illegal transition pe same item (naya object nahi). */
export function reduceDownload(item: DownloadItem, event: DownloadEvent): DownloadItem {
  if (!canTransition(item.status, event.type)) return item;
  switch (event.type) {
    case 'start':
      return { ...item, status: 'downloading', progress: 0, error: undefined, updatedAt: Date.now() };
    case 'progress': {
      const progress = Math.min(100, Math.max(0, Math.round(event.progress)));
      return { ...item, progress, updatedAt: Date.now() };
    }
    case 'complete':
      return {
        ...item,
        status: 'downloaded',
        progress: 100,
        filePath: event.filePath,
        ...(event.sizeBytes !== undefined ? { sizeBytes: event.sizeBytes } : {}),
        error: undefined,
        updatedAt: Date.now(),
      };
    case 'fail':
      return { ...item, status: 'failed', error: event.error, updatedAt: Date.now() };
    case 'retry':
      return { ...item, status: 'queued', progress: 0, error: undefined, updatedAt: Date.now() };
    case 'delete':
      // delete store-level removal karta hai; reducer sirf marker deta hai
      return { ...item, status: 'queued', filePath: undefined, progress: 0, updatedAt: Date.now() };
  }
}

/** 'downloaded' file wapas hai? (offline playback validation) */
export function isPlayableOffline(item: DownloadItem | undefined): boolean {
  return item?.status === 'downloaded' && typeof item.filePath === 'string' && item.filePath.length > 0;
}
