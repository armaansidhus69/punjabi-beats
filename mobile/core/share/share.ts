/**
 * Share client pure core (Phase 8a).
 *
 * App values → safe public entity; resolved server payload gets second guard;
 * actions are typed allowlist (payload se raw route kabhi nahi).
 */

import type { Playlist, Song } from '../../types';

export const SHARE_TTL_SEC = 30 * 24 * 60 * 60;
export const SHARE_TOKEN_MAX_CHARS = 8192;
export const SHARE_CLOCK_SKEW_SEC = 5 * 60;

export type ShareKind = 'track' | 'playlist' | 'room' | 'blend' | 'jam' | 'lyrics';

export interface SharedTrackDescriptor {
  title: string;
  artist: string;
}

export interface TrackShareData extends SharedTrackDescriptor {
  cover?: string;
}

export interface PlaylistShareData {
  name: string;
  totalCount: number;
  tracks: SharedTrackDescriptor[];
}

export interface RoomShareData {
  code: string;
  name?: string;
}

export interface BlendShareData {
  code: string;
  name?: string;
}

export interface JamShareData extends BlendShareData {
  roomType?: 'jam' | 'party';
}

export interface LyricsShareData extends SharedTrackDescriptor {
  lines: string[];
  startMs?: number;
  cover?: string;
}

export type ShareDataByKind = {
  track: TrackShareData;
  playlist: PlaylistShareData;
  room: RoomShareData;
  blend: BlendShareData;
  jam: JamShareData;
  lyrics: LyricsShareData;
};

export type ShareEntity = {
  [Kind in ShareKind]: {
    kind: Kind;
    data: ShareDataByKind[Kind];
    /** Native fallback only; service POST body explicitly isse drop karta. */
    fallbackText: string;
  };
}[ShareKind];

export type ResolvedSharePayload = {
  [Kind in ShareKind]: {
    v: 1;
    kind: Kind;
    data: ShareDataByKind[Kind];
    iat: number;
    exp: number;
  };
}[ShareKind];

export type ShareAction =
  | { type: 'play_track'; query: string; startMs?: number }
  | { type: 'import_playlist'; name: string; tracks: SharedTrackDescriptor[] }
  | { type: 'navigate'; target: 'room' | 'blend' | 'jam'; code: string };

export interface ShareCreateResponse {
  token: string;
  url: string;
  expiresAt: string;
  remaining: number | null;
}

const INVITE_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const ROOM_CODE = /^\d{6}$/;
const KINDS = new Set<ShareKind>(['track', 'playlist', 'room', 'blend', 'jam', 'lyrics']);

function cleanText(value: unknown, maxChars: number, required = true): string | null {
  const clean = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars)
    : '';
  if (required && clean.length === 0) return null;
  return clean;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inviteCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return INVITE_CODE.test(code) ? code : null;
}

function roomCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim() : '';
  return ROOM_CODE.test(code) ? code : null;
}

function optionalName(value: unknown): string | null {
  const name = cleanText(value, 80, false);
  return name && name.length > 0 ? name : null;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function lyricsLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 0 && codePointLength(clean) <= 160 ? clean : null;
}

function normalizeData(kind: ShareKind, raw: unknown): ShareDataByKind[ShareKind] | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (kind === 'track') {
    const title = cleanText(record.title, 120);
    const artist = cleanText(record.artist, 120);
    if (title === null || artist === null) return null;
    const data: TrackShareData = { title, artist };
    const cover = httpsUrl(record.cover);
    if (cover !== null) data.cover = cover;
    return data;
  }
  if (kind === 'playlist') {
    const name = cleanText(record.name, 80);
    if (name === null) return null;
    const tracks: SharedTrackDescriptor[] = [];
    if (Array.isArray(record.tracks)) {
      for (const candidate of record.tracks.slice(0, 10)) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const row = candidate as Record<string, unknown>;
        const title = cleanText(row.title, 120);
        const artist = cleanText(row.artist, 120);
        if (title !== null && artist !== null) tracks.push({ title, artist });
      }
    }
    const countRaw = typeof record.totalCount === 'number' && Number.isFinite(record.totalCount)
      ? Math.round(record.totalCount)
      : 0;
    return {
      name,
      totalCount: Math.max(tracks.length, Math.min(5000, Math.max(0, countRaw))),
      tracks,
    };
  }
  if (kind === 'lyrics') {
    const title = cleanText(record.title, 120);
    const artist = cleanText(record.artist, 120);
    if (title === null || artist === null || !Array.isArray(record.lines)) return null;
    if (record.lines.length === 0 || record.lines.length > 4) return null;
    const lines: string[] = [];
    for (const value of record.lines) {
      const line = lyricsLine(value);
      if (line === null) return null;
      lines.push(line);
    }
    if (codePointLength(lines.join('\n')) > 280) return null;
    const data: LyricsShareData = { title, artist, lines };
    if (record.startMs !== undefined && record.startMs !== null) {
      if (
        typeof record.startMs !== 'number' ||
        !Number.isInteger(record.startMs) ||
        record.startMs < 0 ||
        record.startMs > 86_400_000
      ) {
        return null;
      }
      data.startMs = record.startMs;
    }
    const cover = httpsUrl(record.cover);
    if (cover !== null) data.cover = cover;
    return data;
  }
  if (kind === 'room') {
    const code = roomCode(record.code);
    if (code === null) return null;
    const data: RoomShareData = { code };
    const name = optionalName(record.name);
    if (name !== null) data.name = name;
    return data;
  }
  const code = inviteCode(record.code);
  if (code === null) return null;
  if (kind === 'blend') {
    const data: BlendShareData = { code };
    const name = optionalName(record.name);
    if (name !== null) data.name = name;
    return data;
  }
  const data: JamShareData = { code };
  const name = optionalName(record.name);
  if (name !== null) data.name = name;
  if (record.roomType === 'jam' || record.roomType === 'party') data.roomType = record.roomType;
  return data;
}

export function buildTrackShare(song: Song): ShareEntity | null {
  const data = normalizeData('track', {
    title: song.title,
    artist: song.artist,
    cover: song.cover,
  }) as TrackShareData | null;
  if (data === null) return null;
  return {
    kind: 'track',
    data,
    fallbackText: `"${song.title}" — ${song.artist}\nPunjabi Beats pe suno: ${song.preview}`,
  };
}

export function buildPlaylistShare(playlist: Playlist): ShareEntity | null {
  const data = normalizeData('playlist', {
    name: playlist.name,
    totalCount: playlist.songs.length,
    tracks: playlist.songs.slice(0, 10).map(song => ({ title: song.title, artist: song.artist })),
  }) as PlaylistShareData | null;
  if (data === null) return null;
  const lines = playlist.songs.slice(0, 10).map(song => `• ${song.title} — ${song.artist}`);
  const more = playlist.songs.length > 10 ? `\n… aur ${playlist.songs.length - 10} songs` : '';
  return {
    kind: 'playlist',
    data,
    fallbackText:
      `Punjabi Beats playlist "${playlist.name}" (${playlist.songs.length} songs):\n` +
      `${lines.join('\n')}${more}`,
  };
}

export function buildRoomShare(code: string, name?: string | null): ShareEntity | null {
  const data = normalizeData('room', { code, name }) as RoomShareData | null;
  if (data === null) return null;
  return {
    kind: 'room',
    data,
    fallbackText: `Punjabi Beats ke group room me aa jao! Room code: ${data.code}`,
  };
}

export function buildBlendShare(name: string, code: string): ShareEntity | null {
  const data = normalizeData('blend', { name, code }) as BlendShareData | null;
  if (data === null) return null;
  return {
    kind: 'blend',
    data,
    fallbackText:
      `${name} — Punjabi Beats Blend join karo! 🎵 Code: ${data.code} ya link kholo: ` +
      `punjabi-beats://blend/join?code=${data.code}`,
  };
}

export function buildJamShare(
  name: string,
  code: string,
  type: 'jam' | 'listening_party',
): ShareEntity | null {
  const roomType = type === 'jam' ? 'jam' : 'party';
  const data = normalizeData('jam', { name, code, roomType }) as JamShareData | null;
  if (data === null) return null;
  const label = type === 'jam' ? 'Jam' : 'Listening Party';
  return {
    kind: 'jam',
    data,
    fallbackText:
      `${name} — Punjabi Beats ${label} party shuru! 🎧 Code: ${data.code} ya link: ` +
      `punjabi-beats://jam/join?code=${data.code}`,
  };
}

export function buildLyricsShare(
  song: Song,
  lines: string[],
  startMs?: number | null,
): ShareEntity | null {
  const data = normalizeData('lyrics', {
    title: song.title,
    artist: song.artist,
    lines,
    startMs,
    cover: song.cover,
  }) as LyricsShareData | null;
  if (data === null) return null;
  return {
    kind: 'lyrics',
    data,
    fallbackText: `“${data.lines.join('\n')}”\n— ${data.title}, ${data.artist} · Punjabi Beats`,
  };
}

export function validateResolvedShare(raw: unknown, nowSec: number): ResolvedSharePayload | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === 'string' && KINDS.has(record.kind as ShareKind)
    ? (record.kind as ShareKind)
    : null;
  if (
    record.v !== 1 ||
    kind === null ||
    typeof record.iat !== 'number' ||
    !Number.isInteger(record.iat) ||
    typeof record.exp !== 'number' ||
    !Number.isInteger(record.exp) ||
    record.iat < 0 ||
    record.iat > nowSec + SHARE_CLOCK_SKEW_SEC ||
    record.exp <= nowSec ||
    record.exp <= record.iat ||
    record.exp - record.iat > SHARE_TTL_SEC
  ) {
    return null;
  }
  const data = normalizeData(kind, record.data);
  if (data === null) return null;
  return { v: 1, kind, data, iat: record.iat, exp: record.exp } as ResolvedSharePayload;
}

export function fallbackShareText(entity: ShareEntity): string {
  return entity.fallbackText;
}

export function shareAction(payload: ResolvedSharePayload): ShareAction {
  switch (payload.kind) {
    case 'track':
      return { type: 'play_track', query: `${payload.data.title} ${payload.data.artist}` };
    case 'playlist':
      return {
        type: 'import_playlist',
        name: payload.data.name,
        tracks: payload.data.tracks,
      };
    case 'room':
      return { type: 'navigate', target: 'room', code: payload.data.code };
    case 'blend':
      return { type: 'navigate', target: 'blend', code: payload.data.code };
    case 'jam':
      return { type: 'navigate', target: 'jam', code: payload.data.code };
    case 'lyrics':
      return {
        type: 'play_track',
        query: `${payload.data.title} ${payload.data.artist}`,
        ...(payload.data.startMs !== undefined ? { startMs: payload.data.startMs } : {}),
      };
  }
}

export function validateCreateResponse(
  raw: unknown,
  expectedBase: string,
  nowMs: number = Date.now(),
): ShareCreateResponse | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.token !== 'string' ||
    record.token.length === 0 ||
    record.token.length > SHARE_TOKEN_MAX_CHARS ||
    !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.token) ||
    typeof record.url !== 'string' ||
    typeof record.expiresAt !== 'string'
  ) {
    return null;
  }
  try {
    const expected = new URL(expectedBase);
    const url = new URL(record.url);
    if (
      expected.protocol !== 'https:' ||
      url.protocol !== 'https:' ||
      url.origin !== expected.origin ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0 ||
      url.pathname !== '/api/share' ||
      url.searchParams.get('token') !== record.token ||
      [...url.searchParams.keys()].some(key => key !== 'token') ||
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= nowMs
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    token: record.token,
    url: record.url,
    expiresAt: record.expiresAt,
    remaining: typeof record.remaining === 'number' ? record.remaining : null,
  };
}
