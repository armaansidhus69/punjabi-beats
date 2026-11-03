/**
 * Browser playback boundary.
 *
 * Web build me TrackPlayer native module available nahi hota. Direct provider
 * audio URL ko browser ke native HTMLAudioElement se bajao — iframe, YouTube
 * link-out, ya external app fallback nahi.
 */

export interface WebPlaybackTrack {
  id: string;
  url: string;
}

export interface WebPlaybackCallbacks {
  onProgress: (positionMs: number, durationMs: number) => void;
  onState: (isPlaying: boolean) => void;
  onEnded: () => void;
  onError: (error: unknown) => void;
}

let audio: HTMLAudioElement | null = null;
let callbacks: WebPlaybackCallbacks | null = null;

function requireAudio(): HTMLAudioElement {
  if (typeof Audio === 'undefined') {
    throw new Error('Browser audio playback is unavailable');
  }
  if (!audio) audio = new Audio();
  return audio;
}

export function setupWebPlayback(nextCallbacks: WebPlaybackCallbacks): void {
  const element = requireAudio();
  callbacks = nextCallbacks;
  element.preload = 'auto';

  if (element.dataset.punjabiBeatsBound === 'true') return;
  element.dataset.punjabiBeatsBound = 'true';

  element.addEventListener('timeupdate', () => {
    const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
    callbacks?.onProgress(element.currentTime * 1000, durationMs);
  });
  element.addEventListener('loadedmetadata', () => {
    const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
    callbacks?.onProgress(element.currentTime * 1000, durationMs);
  });
  element.addEventListener('play', () => callbacks?.onState(true));
  element.addEventListener('pause', () => callbacks?.onState(false));
  element.addEventListener('ended', () => callbacks?.onEnded());
  element.addEventListener('error', event => callbacks?.onError(event));
}

export function loadWebTrack(track: WebPlaybackTrack): void {
  const element = requireAudio();
  element.pause();
  element.src = track.url;
  element.load();
}

export async function playWebPlayback(): Promise<void> {
  await requireAudio().play();
}

export function pauseWebPlayback(): void {
  requireAudio().pause();
}

export function seekWebPlayback(positionMs: number): void {
  const element = requireAudio();
  if (Number.isFinite(element.duration)) {
    element.currentTime = Math.max(0, Math.min(positionMs / 1000, element.duration));
  } else {
    element.currentTime = Math.max(0, positionMs / 1000);
  }
}

export function setWebVolume(volume: number): void {
  requireAudio().volume = Math.max(0, Math.min(1, volume));
}

export function resetWebPlayback(): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
