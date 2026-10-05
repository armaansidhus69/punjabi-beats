/**
 * Storage service — AsyncStorage wrapper (playlists, recently played, searches).
 * Saare reads defensively handle hote hain (corrupt data pe empty fallback).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Playlist, Song } from '../types';

const PLAYLISTS_KEY = '@pb_playlists';
const RECENT_KEY = '@pb_recently_played';
const SEARCHES_KEY = '@pb_recent_searches';

const MAX_RECENT_SONGS = 20;

/* ---------- Playlists ---------- */

function isPlaylistArray(value: unknown): value is Playlist[] {
  return (
    Array.isArray(value) &&
    value.every(
      p =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Playlist).id === 'string' &&
        typeof (p as Playlist).name === 'string' &&
        Array.isArray((p as Playlist).songs),
    )
  );
}

export async function getPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return isPlaylistArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Playlists read failed:', err);
    return [];
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch (err) {
    console.warn('Playlists save failed:', err);
  }
}

/* ---------- Recently Played (last 20) ---------- */

const RECENT_MISSING_FIELDS = ['id', 'title', 'artist', 'preview'] as const;

/**
 * Song shape guard (2026-10-05) — pehle yahan raw `as Song[]` cast tha, jo
 * file ke "saare reads defensively handle hote hain" claim ke against tha.
 * Corrupt/old-schema data pe `recent.tsx` ko non-array milta → FlatList crash.
 * Ab bekaar rows filter ho jaati hain (missing id/title/preview).
 */
/**
 * Ek row valid hai? (array-level guard nahi — element-level type guard)
 */
function isSong(value: unknown): value is Song {
  if (typeof value !== 'object' || value === null) return false;
  const song = value as Partial<Song>;
  return RECENT_MISSING_FIELDS.every(field => typeof song[field] === 'string');
}

function isSongArray(value: unknown): value is Song[] {
  return Array.isArray(value) && value.every(isSong);
}

export async function getRecentlyPlayed(): Promise<Song[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (isSongArray(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      // Kuch valid ho to valid wale rakho — ek corrupt entry poori history
      // khaane se behtar hai.
      const kept = parsed.filter(isSong);
      console.warn(
        `Recently played data corrupt tha — ${parsed.length - kept.length} invalid row drop ki`,
      );
      return kept;
    }
    // Array hi nahi (object/string/number) — puri history corrupt
    console.warn('Recently played data corrupt tha — [] reset kiya');
    return [];
  } catch (err) {
    console.warn('Recently played read failed:', err);
    return [];
  }
}

/** Song ko top pe daalta hai (dedupe karke, max 20) */
export async function addRecentlyPlayed(song: Song): Promise<void> {
  try {
    const existing = await getRecentlyPlayed();
    const next = [song, ...existing.filter(s => s.id !== song.id)].slice(
      0,
      MAX_RECENT_SONGS,
    );
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('Recently played save failed:', err);
  }
}

export async function clearRecentlyPlayed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_KEY);
  } catch (err) {
    console.warn('Recently played clear failed:', err);
  }
}

/* ---------- Recent Searches (Phase 5 — dedupe/cap logic searchStore me hai) ---------- */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(q => typeof q === 'string');
}

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Recent searches read failed:', err);
    return [];
  }
}

export async function saveRecentSearches(queries: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SEARCHES_KEY, JSON.stringify(queries));
  } catch (err) {
    console.warn('Recent searches save failed:', err);
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEARCHES_KEY);
  } catch (err) {
    console.warn('Recent searches clear failed:', err);
  }
}

/* ---------- Dead JioSaavn mirrors (musicApi cache persistence) ---------- */

const DEAD_MIRRORS_KEY = '@pb_dead_mirrors';

/**
 * base → expiryMs entries padho. Corrupt/expired data pe `[]` (fail-safe —
 * worst case mirrors dobara probe ho jaate, app crash nahi hota).
 */
export async function getDeadMirrors(): Promise<[string, number][]> {
  try {
    const raw = await AsyncStorage.getItem(DEAD_MIRRORS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    // shape check: [string, number>now]
    return parsed.filter(
      (e): e is [string, number] =>
        Array.isArray(e) &&
        e.length === 2 &&
        typeof e[0] === 'string' &&
        e[0].length > 0 &&
        typeof e[1] === 'number' &&
        e[1] > now,
    );
  } catch (err) {
    console.warn('Dead mirrors read failed:', err);
    return [];
  }
}

/** Dead mirror entries persist karo (musicApi fire-and-forget call karta hai) */
export async function saveDeadMirrors(entries: [string, number][]): Promise<void> {
  try {
    // expired entries bhi mat likho — storage size bounded rahe
    const now = Date.now();
    const clean = entries.filter(([base, until]) => base && until > now);
    await AsyncStorage.setItem(DEAD_MIRRORS_KEY, JSON.stringify(clean));
  } catch (err) {
    console.warn('Dead mirrors save failed:', err);
  }
}

/* ---------- Room display name (Phase 14 — FR-5.11) ---------- */

const ROOM_NAME_KEY = '@pb_room_name';

export async function getRoomName(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(ROOM_NAME_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 20) : null;
  } catch (err) {
    console.warn('Room name read failed:', err);
    return null;
  }
}

export async function saveRoomName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ROOM_NAME_KEY, name.slice(0, 20));
  } catch (err) {
    console.warn('Room name save failed:', err);
  }
}
