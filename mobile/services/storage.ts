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

export async function getRecentlyPlayed(): Promise<Song[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Song[]) : [];
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
