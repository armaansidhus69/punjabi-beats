/**
 * Storage service — AsyncStorage wrapper (playlists, recently played, searches).
 * Saare reads defensively handle hote hain (corrupt data pe empty fallback).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Playlist, RepeatMode, Song, PodcastShow, PodcastProgressEntry, SignalsLedger, TasteStats, AiPromptHistoryEntry, AssistantMessage } from '../types';

const PLAYLISTS_KEY = '@pb_playlists';
const RECENT_KEY = '@pb_recently_played';
const SEARCHES_KEY = '@pb_recent_searches';
const PLAYER_STATE_KEY = '@pb_player_state';
const LIKED_SONGS_KEY = '@pb_liked_songs';

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

/* ---------- Liked Songs ---------- */

export async function getLikedSongs(): Promise<Song[]> {
  try {
    const raw = await AsyncStorage.getItem(LIKED_SONGS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (isSongArray(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      const kept = parsed.filter(isSong);
      console.warn(
        `Liked songs data corrupt tha — ${parsed.length - kept.length} invalid row drop ki`,
      );
      return kept;
    }
    console.warn('Liked songs data corrupt tha — [] reset kiya');
    return [];
  } catch (err) {
    console.warn('Liked songs read failed:', err);
    return [];
  }
}

export async function saveLikedSongs(songs: Song[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(songs));
  } catch (err) {
    console.warn('Liked songs save failed:', err);
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

/* ---------- Player queue snapshot ---------- */

export interface PersistedPlayerState {
  queue: Song[];
  currentSongId: string | null;
  index: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
}

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === 'off' || value === 'all' || value === 'one';
}

function isPersistedPlayerState(value: unknown): value is PersistedPlayerState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<PersistedPlayerState>;
  return (
    isSongArray(state.queue) &&
    (state.currentSongId === null || typeof state.currentSongId === 'string') &&
    typeof state.index === 'number' &&
    Number.isFinite(state.index) &&
    typeof state.position === 'number' &&
    Number.isFinite(state.position) &&
    state.position >= 0 &&
    typeof state.shuffle === 'boolean' &&
    isRepeatMode(state.repeat) &&
    typeof state.volume === 'number' &&
    Number.isFinite(state.volume) &&
    state.volume >= 0 &&
    state.volume <= 1
  );
}

export async function getPersistedPlayerState(): Promise<PersistedPlayerState | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAYER_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedPlayerState(parsed) ? parsed : null;
  } catch (err) {
    console.warn('Player state read failed:', err);
    return null;
  }
}

export async function savePersistedPlayerState(state: PersistedPlayerState): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Player state save failed:', err);
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

/* ---------- Podcasts (Phase 12a — saved shows + episode progress) ---------- */

const PODCAST_SHOWS_KEY = '@pb_podcast_shows';
const PODCAST_PROGRESS_KEY = '@pb_podcast_progress';

/** saved (follow) shows — local-only, guest-usable */
export async function getSavedPodcastShows(): Promise<PodcastShow[]> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_SHOWS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as PodcastShow[]) : [];
  } catch (err) {
    console.warn('Saved podcast shows read failed:', err);
    return [];
  }
}

export async function saveSavedPodcastShows(shows: PodcastShow[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PODCAST_SHOWS_KEY, JSON.stringify(shows));
  } catch (err) {
    console.warn('Saved podcast shows write failed:', err);
  }
}

export type PodcastProgressMap = Record<string, PodcastProgressEntry>;

/** episodeId → progress map (resume + played badges isi se render hote) */
export async function getPodcastProgressMap(): Promise<PodcastProgressMap> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PodcastProgressMap;
  } catch (err) {
    console.warn('Podcast progress read failed:', err);
    return {};
  }
}

/** ek episode ki entry upsert (read-modify-write; throttle caller pe) */
export async function savePodcastProgressEntry(
  episodeId: string,
  entry: PodcastProgressEntry,
): Promise<void> {
  try {
    const map = await getPodcastProgressMap();
    map[episodeId] = entry;
    await AsyncStorage.setItem(PODCAST_PROGRESS_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('Podcast progress write failed:', err);
  }
}

/* ---------- Play signals (Phase 13a — signalsService ke liye raw keys) ---------- */

const PLAY_SIGNALS_KEY = '@pb_play_signals';
const TASTE_STATS_KEY = '@pb_taste_stats';

export async function getPlaySignalsLedger(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(PLAY_SIGNALS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (err) {
    console.warn('Play signals read failed:', err);
    return null;
  }
}

export async function savePlaySignalsLedger(ledger: SignalsLedger): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAY_SIGNALS_KEY, JSON.stringify(ledger));
  } catch (err) {
    console.warn('Play signals write failed:', err);
  }
}

export async function getTasteStatsRaw(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(TASTE_STATS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (err) {
    console.warn('Taste stats read failed:', err);
    return null;
  }
}

export async function saveTasteStatsRaw(stats: TasteStats): Promise<void> {
  try {
    await AsyncStorage.setItem(TASTE_STATS_KEY, JSON.stringify(stats));
  } catch (err) {
    console.warn('Taste stats write failed:', err);
  }
}

/* ---------- AI playlist prompt history (Phase 13b — cap service-side) ---------- */

const AI_PROMPT_HISTORY_KEY = '@pb_ai_prompts';

export async function getAiPromptHistoryRaw(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(AI_PROMPT_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (err) {
    console.warn('AI prompt history read failed:', err);
    return null;
  }
}

export async function saveAiPromptHistory(history: AiPromptHistoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_PROMPT_HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('AI prompt history write failed:', err);
  }
}

/* ---------- AI assistant chat (Phase 13c — cap store-side) ---------- */

const AI_CHAT_HISTORY_KEY = '@pb_ai_chat';

export async function getAiChatHistoryRaw(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(AI_CHAT_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (err) {
    console.warn('AI chat history read failed:', err);
    return null;
  }
}

export async function saveAiChatHistory(messages: AssistantMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch (err) {
    console.warn('AI chat history write failed:', err);
  }
}

/* ---------- Lyrics cache (Phase 7a — versioned envelope, cap core-side) ---------- */

const LYRICS_CACHE_KEY = '@pb_lyrics';

export async function getLyricsCacheRaw(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(LYRICS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch (err) {
    console.warn('Lyrics cache read failed:', err);
    return null;
  }
}

export async function saveLyricsCache(value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(value));
  } catch (err) {
    console.warn('Lyrics cache write failed:', err);
  }
}
