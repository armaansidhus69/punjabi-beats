/**
 * Core data types — poore app me yahi use honge (strict TS, no `any`).
 */

export type SongSource = 'jiosaavn' | 'audius' | 'itunes' | 'jamendo' | 'gaana' | 'youtube_music';

export interface Song {
  id: string;
  title: string;
  artist: string;
  cover: string;
  /** Direct audio URL (320kbps preferred) */
  preview: string;
  /** Duration in milliseconds */
  duration: number;
  /** Source provider used to fetch this song */
  source?: SongSource;
  /** Verome/YouTube Music video id (for stream refresh logic) */
  videoId?: string;
  /**
   * Sirf 30s preview available hai (iTunes preview limitation — full song nahi).
   * JioSaavn mirror se full song aaye to false rehta hai; SongItem ka "30s"
   * badge aur player ka preview note sirf true pe dikhte hain.
   */
  previewOnly?: boolean;
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
 * Wire payload: 'queue-add' — kisi room member (host ya guest) ne queue me
 * naya song add kiya. `addedBy` = uska room display name (toast me dikhta hai).
 * Echo/dedupe ke liye senderId + sentAt zaruri hain (SyncPayload jaisa hi).
 */
export interface QueueAddPayload {
  song: Song;
  /** bhejne wale member ka display name (roomStore.name) */
  addedBy: string;
  senderId: string;
  sentAt: number;
}

/**
 * Wire payload: 'chat-message' (FR-5.12) — queue-add jaisa pattern.
 * Koi bhi member (host bhi) bhej sake; echo/dedupe ke liye senderId + sentAt.
 */
export interface ChatMessagePayload {
  /** `${senderId}-${sentAt}-${rand}` — receiver dedupe isi pe karta hai */
  id: string;
  /** bhejne wale member ka display name (roomStore.name) */
  sender: string;
  /** trimmed, max 500 chars */
  text: string;
  /** bhejne ka wall-clock time (bubble me "9:35 PM" isi se banta hai) */
  timestamp: number;
  senderId: string;
  sentAt: number;
}

/**
 * Room chat ka UI message — payload + `self` flag (apna message right side).
 * Runtime only hai, persist nahi hota (room leave pe clear).
 */
export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  senderId: string;
  self: boolean;
}

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

/* ---------- Phase 10 (roadmap): Blend — taste-mix shared playlist ---------- */

/** blend_items me denormalized track metadata (jsonb) — playback resolves hota hai */
export interface BlendTrack {
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: SongSource;
  /** seconds (Song.duration ms ka second-source hai) */
  durationSec: number;
  /** full stream available (previewOnly ka inverse) */
  playableFull: boolean;
}

export interface BlendItem {
  id: string;
  blendId: string;
  /** provider canonical song id */
  trackId: string;
  /** jis member ka taste data track laaya (null = orphan cleanup) */
  sourceUserId: string | null;
  score: number;
  position: number;
  track: BlendTrack;
  origin: 'generated' | 'member';
  createdAt?: string;
}

export interface TasteArtist {
  /** lowercase-normalized display name */
  name: string;
  count: number;
}

export interface TasteSnapshotSong {
  /** provider canonical song id */
  id: string;
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: SongSource;
  durationSec: number;
  playableFull: boolean;
  /** liked (2) + playlist occurrences (1) ka combined weight */
  count: number;
}

/** Device-side taste payload — users apni hi row upsert karte hain */
export interface TasteSnapshot {
  version: 1;
  /** FNV-1a 64 hex — sorted song-id list ka hash (recompute no-op guard) */
  libraryHash: string;
  songs: TasteSnapshotSong[];
  artists: TasteArtist[];
}

export type BlendVisibility = 'members' | 'public';
export type BlendComputeStatus = 'pending' | 'computing' | 'ready' | 'error';
export type BlendMemberRole = 'owner' | 'member';

export interface Blend {
  id: string;
  ownerId: string;
  name: string;
  coverUrl: string | null;
  visibility: BlendVisibility;
  inviteCode: string;
  /** ISO timestamptz */
  inviteExpiresAt: string;
  algorithmVersion: string;
  computeStatus: BlendComputeStatus;
  lastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row + profiles join data (store me matchPercent client compute karta hai) */
export interface BlendMember {
  blendId: string;
  userId: string;
  role: BlendMemberRole;
  joinedAt: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/* ---------- Phase 11 (roadmap): Jam + Listening Party — server-authoritative rooms ---------- */

export type RoomType = 'jam' | 'listening_party';
export type RoomStatus = 'active' | 'paused' | 'closed' | 'expired';
export type RoomRole = 'owner' | 'co_host' | 'moderator' | 'participant' | 'listener';

/** room_playback_state.track / room_queue_items.track (denormalized jsonb) */
export interface JamTrack {
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: SongSource;
  durationSec: number;
  playableFull: boolean;
}

export interface JamRoom {
  id: string;
  ownerId: string;
  type: RoomType;
  title: string;
  coverUrl: string | null;
  visibility: 'private_invite' | 'public';
  inviteCode: string;
  maxParticipants: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JamMember {
  roomId: string;
  userId: string;
  role: RoomRole;
  joinedAt: string;
  /** presence heartbeat — stale > 90s = offline render */
  lastSeenAt: string;
  /** chat mute (moderation) — null = not muted */
  mutedUntil: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** room_playback_state — ONE row per room (server-authoritative) */
export interface JamPlaybackState {
  roomId: string;
  trackId: string | null;
  track: JamTrack | null;
  positionMs: number;
  isPlaying: boolean;
  /** queue-mutations counter (server-side bump) */
  queueVersion: number;
  /** playback/queue state counter — monotonic, server-side bump */
  stateVersion: number;
  updatedBy: string | null;
  /** server clock ISO of last write — predicted position iska use karta hai */
  updatedAt: string;
}

export interface JamQueueItem {
  id: string;
  roomId: string;
  trackId: string;
  track: JamTrack;
  addedBy: string | null;
  position: number;
  /** null = pending; set = consumed */
  playedAt: string | null;
  createdAt: string;
}

export type JamMessageKind = 'chat' | 'reaction_log' | 'system';

export interface JamMessage {
  id: string;
  roomId: string;
  userId: string | null;
  kind: JamMessageKind;
  /** chat text ya reaction emoji (1–500 chars) */
  body: string;
  trackId: string | null;
  replyToId: string | null;
  createdAt: string;
}

/* ---------- Phase 12a (roadmap): Podcasts — RSS-first episodes v1 ---------- */

export interface PodcastShow {
  /** iTunes collectionId */
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  /** RSS feed — null ho to lookup fallback chalta hai */
  feedUrl: string | null;
  primaryGenre: string | null;
}

export interface PodcastEpisode {
  /** audioUrl ka stable fnv1a-64 hash — resume/played keys isse drive hote hain */
  id: string;
  showId: string;
  showTitle: string;
  title: string;
  description: string | null;
  artworkUrl: string;
  durationMs: number;
  /** full stream — enclosure / episodeUrl (30s preview problem NAHI hai yahan) */
  audioUrl: string;
  /** ISO */
  publishedAt: string;
}

/** @pb_podcast_progress map ki value (pure merge policy core/podcast/progress.ts) */
export interface PodcastProgressEntry {
  positionMs: number;
  durationMs: number;
  played: boolean;
  updatedAt: string;
  /** row render + replay ke liye denormalized (types PodcastEpisode se) */
  title: string;
  showTitle: string;
  artworkUrl: string;
  audioUrl: string;
}
