/**
 * Offline Audio Cache Client (Phase 6 / IMP-07).
 * Real binary audio cache management using CacheStorage API / local blob URLs
 * for seamless offline playback of 320kbps Punjabi tracks.
 */

const OFFLINE_CACHE_NAME = 'punjabi-beats-offline-v1';

function cacheKeyForSong(songId: string): string {
  return `https://offline.punjabibeats.local/track/${encodeURIComponent(songId)}`;
}

// In-memory fallback for environments without CacheStorage (e.g. headless tests)
const memoryBlobCache = new Map<string, { blob: Blob; url: string }>();

export async function hasLocalCachedBlob(songId: string): Promise<boolean> {
  if (memoryBlobCache.has(songId)) return true;
  if (typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const cache = await window.caches.open(OFFLINE_CACHE_NAME);
    const match = await cache.match(cacheKeyForSong(songId));
    return Boolean(match);
  } catch {
    return false;
  }
}

export async function getCachedAudioBlobUrl(songId: string): Promise<string | null> {
  const mem = memoryBlobCache.get(songId);
  if (mem) return mem.url;

  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await window.caches.open(OFFLINE_CACHE_NAME);
    const match = await cache.match(cacheKeyForSong(songId));
    if (!match) return null;
    const blob = await match.blob();
    if (blob.size < 1024) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export interface DownloadAudioParams {
  songId: string;
  streamUrl: string;
  estimatedDurationSec?: number;
  signal?: AbortSignal;
  onProgress?: (pct: number, bytesLoaded: number) => void;
}

export async function downloadAudioToLocalCache(
  params: DownloadAudioParams,
): Promise<{ sizeBytes: number }> {
  const { songId, streamUrl, estimatedDurationSec = 200, signal, onProgress } = params;

  const res = await fetch(streamUrl, { signal });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || 'audio/mp4';
  const headerTotal = Number(res.headers.get('content-length') || '0');
  const estimatedTotal =
    headerTotal > 1000
      ? headerTotal
      : Math.max(2_000_000, estimatedDurationSec * 40_000);

  let blob: Blob;

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (onProgress) {
          const pct = Math.min(99, Math.max(1, Math.round((loaded / estimatedTotal) * 100)));
          onProgress(pct, loaded);
        }
      }
    }
    blob = new Blob(chunks as BlobPart[], { type: contentType });
  } else {
    blob = await res.blob();
    if (onProgress) {
      onProgress(100, blob.size);
    }
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(OFFLINE_CACHE_NAME);
      await cache.put(
        cacheKeyForSong(songId),
        new Response(blob, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(blob.size),
          },
        }),
      );
    } catch {
      // Fallback to memory URL if cache.put fails
      const url = URL.createObjectURL(blob);
      memoryBlobCache.set(songId, { blob, url });
    }
  } else {
    const url = URL.createObjectURL(blob);
    memoryBlobCache.set(songId, { blob, url });
  }

  if (onProgress) onProgress(100, blob.size);
  return { sizeBytes: blob.size };
}

export async function removeLocalCachedBlob(songId: string): Promise<void> {
  const mem = memoryBlobCache.get(songId);
  if (mem) {
    URL.revokeObjectURL(mem.url);
    memoryBlobCache.delete(songId);
  }

  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(OFFLINE_CACHE_NAME);
    await cache.delete(cacheKeyForSong(songId));
  } catch {
    // ignore
  }
}

export async function clearAllLocalCachedBlobs(): Promise<void> {
  for (const item of memoryBlobCache.values()) {
    URL.revokeObjectURL(item.url);
  }
  memoryBlobCache.clear();

  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    await window.caches.delete(OFFLINE_CACHE_NAME);
  } catch {
    // ignore
  }
}
