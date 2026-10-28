import type { Playlist, Song, SongSource } from '../types';

export interface ImportedPlaylist {
  name: string;
  songs: Song[];
  skippedSongs: number;
}

export class PlaylistImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylistImportError';
  }
}

const SONG_SOURCES: SongSource[] = [
  'jiosaavn',
  'audius',
  'itunes',
  'jamendo',
  'gaana',
  'youtube_music',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isSongSource(value: unknown): value is SongSource {
  return typeof value === 'string' && SONG_SOURCES.includes(value as SongSource);
}

function normalizeDuration(value: unknown): number | null {
  const duration = asNumber(value);
  if (duration === null || duration < 0) return null;
  // Common exports use seconds while Punjabi Beats stores milliseconds.
  return duration > 0 && duration < 1000 ? Math.round(duration * 1000) : Math.round(duration);
}

function normalizeSong(value: unknown, index: number): Song | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = asText(raw.title) || asText(raw.name);
  const artist =
    asText(raw.artist) ||
    asText(raw.artistName) ||
    asText(raw.author) ||
    asText(raw.albumArtist);
  const preview =
    asText(raw.preview) ||
    asText(raw.audioUrl) ||
    asText(raw.audio_url) ||
    asText(raw.url);
  const duration = normalizeDuration(raw.duration ?? raw.durationMs ?? raw.duration_ms);

  // An imported track must have enough metadata and an audio URL to remain
  // playable by the existing queue/player boundary.
  if (!title || !artist || !preview || duration === null) return null;

  return {
    id: asText(raw.id) || asText(raw.trackId) || `imported-${index}-${title.toLowerCase().replace(/\s+/g, '-')}`,
    title,
    artist,
    cover: asText(raw.cover) || asText(raw.artworkUrl) || asText(raw.artwork_url) || asText(raw.image),
    preview,
    duration,
    source: isSongSource(raw.source) ? raw.source : undefined,
    videoId: asText(raw.videoId) || asText(raw.video_id) || undefined,
    previewOnly: raw.previewOnly === true,
  };
}

function playlistEntries(value: unknown, fallbackName: string): { name: string; songs: unknown[] }[] {
  if (Array.isArray(value)) {
    if (value.every(item => item && typeof item === 'object' && ('songs' in item || 'tracks' in item))) {
      return value.map((item, index) => {
        const raw = item as Record<string, unknown>;
        return {
          name: asText(raw.name) || asText(raw.title) || `${fallbackName} ${index + 1}`,
          songs: Array.isArray(raw.songs) ? raw.songs : Array.isArray(raw.tracks) ? raw.tracks : [],
        };
      });
    }
    return [{ name: fallbackName, songs: value }];
  }

  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  if (raw.playlist && typeof raw.playlist === 'object') {
    return playlistEntries(raw.playlist, fallbackName);
  }
  if (Array.isArray(raw.playlists)) return playlistEntries(raw.playlists, fallbackName);
  if (Array.isArray(raw.songs) || Array.isArray(raw.tracks)) {
    return [
      {
        name: asText(raw.name) || asText(raw.title) || fallbackName,
        songs: Array.isArray(raw.songs) ? raw.songs : Array.isArray(raw.tracks) ? raw.tracks : [],
      },
    ];
  }
  return [];
}

export function parsePlaylistImportText(text: string, fallbackName = 'Imported playlist'): ImportedPlaylist[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new PlaylistImportError('File valid JSON nahi hai. Punjabi Beats playlist JSON import karo.');
  }

  const entries = playlistEntries(parsed, fallbackName);
  if (entries.length === 0) {
    throw new PlaylistImportError('File vich koi playlist nahi mili.');
  }

  const imported = entries.map((entry, playlistIndex) => {
    const songs = entry.songs
      .map((song, songIndex) => normalizeSong(song, playlistIndex * 10000 + songIndex))
      .filter((song): song is Song => song !== null);
    return {
      name: entry.name.trim() || `${fallbackName} ${playlistIndex + 1}`,
      songs,
      skippedSongs: entry.songs.length - songs.length,
    };
  });

  if (imported.every(item => item.songs.length === 0)) {
    throw new PlaylistImportError(
      'Import vich playable songs nahi mile. Har song vich title, artist, audio URL, te duration chahida hai.',
    );
  }
  return imported.filter(item => item.songs.length > 0);
}

export function playlistToImportJson(playlist: Playlist): string {
  return JSON.stringify(
    {
      name: playlist.name,
      songs: playlist.songs,
    },
    null,
    2,
  );
}
