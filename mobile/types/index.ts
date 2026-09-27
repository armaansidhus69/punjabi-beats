/**
 * Core data types — poore app me yahi use honge (strict TS, no `any`).
 */

export interface Song {
  id: string;
  title: string;
  artist: string;
  cover: string;
  /** Direct audio URL (320kbps preferred) */
  preview: string;
  /** Duration in milliseconds */
  duration: number;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

export interface Mood {
  id: string;
  title: string;
  emoji: string;
  /** Card accent color (grid me har mood alag dikhe) */
  color?: string;
  /** Search query (iTunes IN store pe probe-verified, constants/moods.ts me list) */
  query: string;
}

/* ---------- Phase 11: room real-time sync ---------- */

/**
 * SyncAction — room me broadcast hone wala playback action.
 * `song` variant me `position` + `isPlaying` bhi jaate hain (spec me sirf `index`
 * tha) — late joiner ko exactly wahi jagah se start karna hai (FR-5.3) aur
 * baaki devices ko pata rahe ki song chal raha hai ya paused hai.
 */
export type SyncAction =
  | {
      type: 'song';
      song: Song;
      queue: Song[];
      /** queue me is song ka index */
      index: number;
      /** ms */
      position: number;
      isPlaying: boolean;
    }
  | { type: 'play'; position: number }
  | { type: 'pause'; position: number }
  | { type: 'seek'; position: number };

/** Wire payload: action + sender identity + timestamp (latency compensation) */
export type SyncPayload = SyncAction & {
  /** bhejne wale device ka id — apne hi echo ko ignore karne ke liye */
  senderId: string;
  /** Date.now() — receive pe elapsed add karke position align karte hain */
  sentAt: number;
};

/**
 * Local player events — playerStore emit karta hai, roomSync consume karta hai.
 * `remote: true` = ye action doosre device se aaya tha, isliye broadcast NAHI
 * karna. Echo loop isi flag se tootta hai (isliye ye required field hai).
 */
export type PlayerActionEvent =
  | {
      type: 'song';
      song: Song;
      queue: Song[];
      position: number;
      isPlaying: boolean;
      remote: boolean;
    }
  | { type: 'play'; remote: boolean }
  | { type: 'pause'; remote: boolean }
  | { type: 'seek'; position: number; remote: boolean };

/**
 * Apinator SDK ke raw states + humara `failed`:
 * `initialized | connecting | connected | disconnected | failed`
 * (SDK ka `unavailable` → `failed` map hota hai).
 */
export type ConnectionState = 'initialized' | 'connecting' | 'connected' | 'disconnected' | 'failed';

/** UI alias — screens ye naam use karte hain (same 5 states) */
export type ConnectionStatus = ConnectionState;

/** Repeat modes (FR-2.10) */
export type RepeatMode = 'off' | 'all' | 'one';

/** Pure data shape — playerStore isse extend karta hai */
export interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  index: number;
  isPlaying: boolean;
  /** ms */
  position: number;
  /** ms */
  duration: number;
  /** FR-2.9 shuffle mode */
  shuffle: boolean;
  /** FR-2.10 repeat mode */
  repeat: RepeatMode;
  /** FR-2.11 volume (0..1) — local device, room sync me kabhi broadcast nahi */
  volume: number;
}

/* ---------- Phase 1 + 14: group room ---------- */

/**
 * Group room ka core shape — `roomStore` ise extend karta hai.
 * `members` live presence list hai (FR-5.10) — host roomSync ke roster se
 * broadcast karta hai, naam FR-5.11 se aata hai.
 */
export interface Room {
  /** 6-digit code; null = room ke bahar */
  code: string | null;
  isHost: boolean;
  /** online members (session-scoped senderId + join-time naam) */
  members: RoomMember[];
}

/** Ek online member (FR-5.10 + FR-5.11) */
export interface RoomMember {
  /** device session ka senderId — sirf identity ke liye (security nahi) */
  id: string;
  /** join time pe user ka chuna hua naam (default `Guest-XXXX`) */
  name: string;
}
