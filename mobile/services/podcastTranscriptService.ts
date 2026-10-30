/**
 * Publisher transcript fetch boundary (Phase 7b).
 *
 * RSS ref chooses format; service sirf HTTPS text fetch + 2 MiB guard karta,
 * pure core parser common segment model banata hai. Koi proxy/AI/key nahi.
 */

import type { PodcastEpisode, PodcastTranscript } from '../types';
import { chooseTranscriptRef, parseTranscriptByMime } from '../core/podcast/transcript';
import { normalizeTranscriptMime } from '../core/podcast/rss';

const REQUEST_TIMEOUT_MS = 10_000;
export const TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;

export type PodcastTranscriptErrorCode =
  | 'unavailable'
  | 'network'
  | 'too_large'
  | 'malformed'
  | 'unsupported';

export class PodcastTranscriptError extends Error {
  readonly code: PodcastTranscriptErrorCode;

  constructor(code: PodcastTranscriptErrorCode, message: string) {
    super(message);
    this.name = 'PodcastTranscriptError';
    this.code = code;
  }
}

export function describePodcastTranscriptError(err: unknown): string {
  if (err instanceof PodcastTranscriptError) {
    switch (err.code) {
      case 'unavailable':
        return 'Publisher ne is episode ka transcript nahi diya';
      case 'too_large':
        return 'Transcript bahut bada hai — safety limit 2 MiB hai';
      case 'malformed':
        return 'Publisher transcript format samajh nahi aaya';
      case 'unsupported':
        return 'Ye transcript format abhi supported nahi hai';
      default:
        return 'Transcript load nahi hua — network ya web CORS check karo';
    }
  }
  return 'Transcript load nahi hua — dobara try karo';
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
    if (bytes > TRANSCRIPT_MAX_BYTES) return bytes;
  }
  return bytes;
}

let lastCache:
  | { episodeId: string; sourceUrl: string; transcript: PodcastTranscript }
  | null = null;

export function resetPodcastTranscriptCacheForTest(): void {
  lastCache = null;
}

export async function fetchPodcastTranscript(
  episode: PodcastEpisode,
): Promise<PodcastTranscript> {
  const ref = chooseTranscriptRef(episode.transcripts);
  if (!ref) {
    throw new PodcastTranscriptError(
      episode.transcripts.length > 0 ? 'unsupported' : 'unavailable',
      'No supported publisher transcript ref',
    );
  }
  try {
    if (new URL(ref.url).protocol !== 'https:') {
      throw new PodcastTranscriptError('unsupported', 'Transcript URL must be HTTPS');
    }
  } catch (err) {
    if (err instanceof PodcastTranscriptError) throw err;
    throw new PodcastTranscriptError('unsupported', 'Transcript URL invalid');
  }

  if (lastCache?.episodeId === episode.id && lastCache.sourceUrl === ref.url) {
    return lastCache.transcript;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ref.url, {
      signal: controller.signal,
      headers: { accept: ref.type },
    });
    if (!response.ok) {
      throw new PodcastTranscriptError('network', `Transcript HTTP ${response.status}`);
    }
    const responseType = normalizeTranscriptMime(response.headers.get('Content-Type'));
    if (responseType !== null && responseType !== ref.type) {
      console.warn('[transcript] RSS/HTTP MIME mismatch; RSS type used:', ref.type, responseType);
    }
    const contentLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(contentLength) && contentLength > TRANSCRIPT_MAX_BYTES) {
      throw new PodcastTranscriptError('too_large', `Content-Length ${contentLength}`);
    }
    const raw = await response.text();
    if (utf8ByteLength(raw) > TRANSCRIPT_MAX_BYTES) {
      throw new PodcastTranscriptError('too_large', 'Transcript body exceeds limit');
    }
    const segments = parseTranscriptByMime(ref.type, raw);
    if (segments.length === 0) {
      throw new PodcastTranscriptError('malformed', 'Zero valid transcript segments');
    }
    const transcript: PodcastTranscript = {
      episodeId: episode.id,
      sourceUrl: ref.url,
      mimeType: ref.type,
      language: ref.language,
      timed: segments.some(segment => segment.startMs !== null),
      segments,
    };
    lastCache = { episodeId: episode.id, sourceUrl: ref.url, transcript };
    return transcript;
  } catch (err) {
    if (err instanceof PodcastTranscriptError) throw err;
    throw new PodcastTranscriptError(
      'network',
      err instanceof Error ? err.message : 'Transcript fetch failed',
    );
  } finally {
    clearTimeout(timer);
  }
}
