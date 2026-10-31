/**
 * Sync payload helpers (Phase 11) — room sync ka *pure* hissa.
 *
 * Yahan sirf data in/out hai: payload build, robust parse, echo/duplicate
 * guards, latency compensation aur seek-throttle predicate. Is file me koi
 * Apinator / player / store import nahi hai (sirf types) — isliye ye headless
 * test ho sakti hai, aur `services/roomSync.ts` in helpers ko use karta hai.
 */
import type {
  ChatMessagePayload,
  PlayerActionEvent,
  QueueAddPayload,
  Song,
  SongSource,
  SyncPayload,
} from '../types';

/* ---------- Event names (client bind + Vercel /api/publish dono me same) ---------- */
/** song badla (queue + position + isPlaying ke saath) */
export const SYNC_EVENT_SONG = 'song-change';
/** play / pause / seek — teeno ek hi event pe, payload ka `type` decide karta hai */
export const SYNC_EVENT_CONTROL = 'playback-control';
/** Phase 14 (presence) — host yehin online members ki list bhejta hai */
export const SYNC_EVENT_MEMBERS = 'member-list';
/** Har client channel subscribe hone pe apna naam + heartbeat yehi bhejta hai */
export const SYNC_EVENT_MEMBER_JOIN = 'member-join';
/** Client room chhodne pe yehi event bhejta hai (host roster se hata deta hai) */
export const SYNC_EVENT_MEMBER_LEAVE = 'member-leave';
/** Koi bhi member (host bhi) queue me naya song add kare — spec event name */
export const SYNC_EVENT_QUEUE_ADD = 'queue-add';
/** FR-5.12 — room chat message (queue-add jaisa pattern) */
export const SYNC_EVENT_CHAT_MESSAGE = 'chat-message';

/* ---------- Tuning constants ---------- */
/** seek me itna chhota farak ignore (network/timer jitter) */
export const SEEK_JITTER_MS = 700;
/** song/play/pause pe itna drift "pehle se same" maana jaata hai */
export const DUPLICATE_POSITION_MS = 2000;
/** sender ka clock bahut peeche/aage ho to max itna hi compensate karo */
export const MAX_LATENCY_COMPENSATION_MS = 5000;
/** ek window me sirf ek seek broadcast (per-frame callers se bachne ke liye) */
export const SEEK_THROTTLE_MS = 250;

/** playerStore ki current state ka chhota snapshot (guard ke liye kaafi) */
export interface SyncSnapshot {
  currentSongId: string | null;
  index: number;
  isPlaying: boolean;
  position: number;
}

export interface BuildContext {
  senderId: string;
  /** player ki current position (ms) — play/pause payload ke liye */
  position: number;
  sentAt: number;
  seq?: number;
  resync?: boolean;
}

/* ---------- Build ---------- */

/** action kaunsa event pe jaayega (song → song-change, baaki → playback-control) */
export function syncEventForAction(action: PlayerActionEvent): string {
  return action.type === 'song' ? SYNC_EVENT_SONG : SYNC_EVENT_CONTROL;
}

function position(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Local player action → wire payload. `song` action me queue/index bhi jaata
 * hai taaki naya device turant same queue pe aa jaaye.
 */
export function buildSyncPayload(action: PlayerActionEvent, ctx: BuildContext): SyncPayload {
  const base: { senderId: string; sentAt: number; seq?: number; resync?: boolean } = {
    senderId: ctx.senderId,
    sentAt: ctx.sentAt,
  };
  if (typeof ctx.seq === 'number') base.seq = ctx.seq;
  if (ctx.resync) base.resync = true;

  if (action.type === 'song') {
    const queue = action.queue.length > 0 ? action.queue : [action.song];
    const found = queue.findIndex(s => s.id === action.song.id);
    return {
      type: 'song',
      song: action.song,
      queue,
      index: found >= 0 ? found : 0,
      position: position(action.position),
      isPlaying: action.isPlaying,
      ...base,
    };
  }

  if (action.type === 'play') {
    return { type: 'play', position: position(ctx.position), ...base };
  }

  if (action.type === 'pause') {
    return { type: 'pause', position: position(ctx.position), ...base };
  }

  return { type: 'seek', position: position(action.position), ...base };
}

/* ---------- Parse (robust) ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const SONG_SOURCES: readonly SongSource[] = [
  'jiosaavn',
  'audius',
  'itunes',
  'jamendo',
  'gaana',
  'youtube_music',
];

function parseSongSource(value: unknown): SongSource | undefined {
  return typeof value === 'string' && SONG_SOURCES.includes(value as SongSource)
    ? (value as SongSource)
    : undefined;
}

/** Song shape validate + coerce karo, including source-specific playback identity. */
function toSong(value: unknown): Song | null {
  if (!isRecord(value)) return null;
  const { id, title, artist, cover, preview } = value;
  if (typeof id !== 'string' || !id) return null;
  const source = parseSongSource(value.source);
  const videoId = typeof value.videoId === 'string' && value.videoId ? value.videoId : undefined;
  const playableWithoutPreview = source === 'youtube_music' && !!videoId;
  if ((typeof preview !== 'string' || !preview) && !playableWithoutPreview) return null;
  const duration = Number(value.duration);
  return {
    id,
    title: typeof title === 'string' && title ? title : 'Unknown',
    artist: typeof artist === 'string' && artist ? artist : 'Unknown',
    cover: typeof cover === 'string' ? cover : '',
    preview: typeof preview === 'string' ? preview : '',
    duration: Number.isFinite(duration) && duration > 0 ? duration : 30000,
    source,
    videoId,
    // Room sync se aaya song bhi badge/player note sahi dikhaye (field pass-through)
    previewOnly: value.previewOnly === true,
  };
}

/**
 * Incoming event data → SyncPayload.
 * SDK normally parsed object deta hai, par string bhi aa sakti hai (ya
 * double-encoded JSON string) — dono handle karte hain. Bekaar payload pe
 * `null` return hota hai, caller chup-chaap ignore kar deta hai (crash nahi).
 */
export function parseSyncPayload(raw: unknown): SyncPayload | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('roomSync: payload JSON parse failed:', err);
      return null;
    }
  }
  if (!isRecord(data)) return null;

  const senderId = typeof data.senderId === 'string' ? data.senderId : '';
  // senderId ke bina apna hi echo pehchanna impossible hai → reject
  if (!senderId) return null;

  const sentAt = Number(data.sentAt);
  const base: { senderId: string; sentAt: number; seq?: number; resync?: boolean } = {
    senderId,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  };
  if (typeof data.seq === 'number' && Number.isFinite(data.seq)) {
    base.seq = data.seq;
  }
  if (data.resync === true) {
    base.resync = true;
  }

  if (data.type === 'song') {
    const song = toSong(data.song);
    if (!song) return null;
    const queue = Array.isArray(data.queue)
      ? data.queue.map(toSong).filter((s): s is Song => s !== null)
      : [];
    const finalQueue = queue.length > 0 ? queue : [song];
    const rawIndex = Number(data.index);
    const index =
      Number.isFinite(rawIndex) && rawIndex >= 0 && rawIndex < finalQueue.length
        ? Math.floor(rawIndex)
        : Math.max(0, finalQueue.findIndex(s => s.id === song.id));
    return {
      type: 'song',
      song,
      queue: finalQueue,
      index,
      position: position(Number(data.position)),
      // missing ho to "chal raha hai" maan lete hain (song-change ka intent wahi hai)
      isPlaying: data.isPlaying !== false,
      ...base,
    };
  }

  if (data.type === 'play') {
    return { type: 'play', position: position(Number(data.position)), ...base };
  }

  if (data.type === 'pause') {
    return { type: 'pause', position: position(Number(data.position)), ...base };
  }

  if (data.type === 'seek') {
    return { type: 'seek', position: position(Number(data.position)), ...base };
  }

  return null;
}

/* ---------- Room queue-add (koi bhi member queue me add kar sake) ---------- */

/** Local '+' action → 'queue-add' wire payload (spec: { song, addedBy }) */
export function buildQueueAddPayload(
  song: Song,
  addedBy: string,
  ctx: { senderId: string; sentAt: number },
): QueueAddPayload {
  const name = typeof addedBy === 'string' ? addedBy.trim().slice(0, 20) : '';
  return { song, addedBy: name || 'Guest', senderId: ctx.senderId, sentAt: ctx.sentAt };
}

/**
 * Incoming 'queue-add' → QueueAddPayload. Robust parse bilkul parseSyncPayload
 * jaisa: string/object dono accept, bekaar payload pe null (caller skip).
 */
export function parseQueueAdd(raw: unknown): QueueAddPayload | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('roomSync: queue-add JSON parse failed:', err);
      return null;
    }
  }
  if (!isRecord(data)) return null;

  const senderId = typeof data.senderId === 'string' ? data.senderId : '';
  if (!senderId) return null;
  const song = toSong(data.song);
  if (!song) return null;

  const rawName = typeof data.addedBy === 'string' ? data.addedBy.trim() : '';
  const sentAt = Number(data.sentAt);
  return {
    song,
    addedBy: rawName.slice(0, 20) || 'Guest',
    senderId,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  };
}

/* ---------- Chat (FR-5.12 — queue-add pattern) ---------- */

/** Chat input limit (UI + wire dono pe same) */
export const CHAT_TEXT_MAX = 500;
/** UI list cap (ChatModal purane drop karta hai) */
export const CHAT_HISTORY_MAX = 200;
/** roomStore.name jaisa sender display name cap */
export const CHAT_SENDER_MAX = 20;

function chatId(senderId: string, sentAt: number): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${senderId}-${sentAt}-${rand}`;
}

/**
 * Local chat text → 'chat-message' wire payload (spec: { sender, text,
 * timestamp, id }). Khali text → null (caller wapas 'empty' de).
 */
export function buildChatMessagePayload(
  text: string,
  sender: string,
  ctx: { senderId: string; sentAt: number },
): ChatMessagePayload | null {
  const clean = typeof text === 'string' ? text.trim().slice(0, CHAT_TEXT_MAX) : '';
  if (!clean) return null;
  const name = typeof sender === 'string' ? sender.trim().slice(0, CHAT_SENDER_MAX) : '';
  const sentAt = Number.isFinite(ctx.sentAt) && ctx.sentAt > 0 ? ctx.sentAt : Date.now();
  return {
    id: chatId(ctx.senderId, sentAt),
    sender: name || 'Guest',
    text: clean,
    timestamp: sentAt,
    senderId: ctx.senderId,
    sentAt,
  };
}

/**
 * Incoming 'chat-message' → ChatMessagePayload. parseQueueAdd jaisa robust:
 * string/object dono accept, bekaar payload pe null (caller skip).
 */
export function parseChatMessage(raw: unknown): ChatMessagePayload | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('roomSync: chat-message JSON parse failed:', err);
      return null;
    }
  }
  if (!isRecord(data)) return null;

  const senderId = typeof data.senderId === 'string' ? data.senderId : '';
  if (!senderId) return null;
  const text = typeof data.text === 'string' ? data.text.trim().slice(0, CHAT_TEXT_MAX) : '';
  if (!text) return null;

  const id = typeof data.id === 'string' && data.id ? data.id : '';
  if (!id) return null;
  const rawSender = typeof data.sender === 'string' ? data.sender.trim() : '';
  const timestamp = Number(data.timestamp);
  const sentAt = Number(data.sentAt);
  return {
    id,
    sender: rawSender.slice(0, CHAT_SENDER_MAX) || 'Guest',
    text,
    timestamp:
      Number.isFinite(timestamp) && timestamp > 0
        ? Math.round(timestamp)
        : Number.isFinite(sentAt) && sentAt > 0
          ? Math.round(sentAt)
          : Date.now(),
    senderId,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  };
}

/* ---------- Guards / math ---------- */

/** Apne hi bheje event ka echo — isse apply karna loop bana dega */
export function isOwnEcho(msg: SyncPayload, senderId: string): boolean {
  return msg.senderId === senderId;
}

/**
 * Latency compensation: packet bhejne se ab tak guzra waqt (ms).
 * Device clocks alag hote hain, isliye 0..maxMs ke beech clamp.
 */
export function latencyCompensation(
  sentAt: number,
  now: number,
  maxMs: number = MAX_LATENCY_COMPENSATION_MS,
): number {
  if (!Number.isFinite(sentAt) || sentAt <= 0) return 0;
  const elapsed = now - sentAt;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.round(Math.min(elapsed, maxMs));
}

/** Remote event ka target position (elapsed add karke) */
export function compensatedPosition(
  p: number,
  sentAt: number,
  now: number,
  isPlaying: boolean = true,
  maxSkewMs: number = MAX_LATENCY_COMPENSATION_MS,
): number {
  if (!isPlaying) return Math.max(0, Math.round(p));
  return Math.max(0, Math.round(p + latencyCompensation(sentAt, now, maxSkewMs)));
}

/**
 * Ye remote event apply karne ka koi matlab nahi (already wahi state)?
 * Zaroori hai kyunki auto-next pe saare devices ek hi song-change bhejte hain —
 * bina guard ke har device audio dobara load karta rehta (glitch storm).
 */
export function shouldIgnoreRemote(
  msg: SyncPayload,
  snapshot: SyncSnapshot,
  target: number,
): boolean {
  if (msg.resync) return false;
  const sameSpot = Math.abs(snapshot.position - target) < DUPLICATE_POSITION_MS;
  switch (msg.type) {
    case 'song':
      return (
        snapshot.currentSongId === msg.song.id &&
        snapshot.index === msg.index &&
        snapshot.isPlaying === msg.isPlaying &&
        sameSpot
      );
    case 'play':
      return snapshot.isPlaying && sameSpot;
    case 'pause':
      return !snapshot.isPlaying && sameSpot;
    case 'seek':
      return Math.abs(snapshot.position - target) < SEEK_JITTER_MS;
  }
}

/** Seek broadcast throttle (leading edge): window ke andar ho to skip */
export function shouldThrottleSeek(
  lastSentAt: number,
  now: number,
  minIntervalMs: number = SEEK_THROTTLE_MS,
): boolean {
  if (!Number.isFinite(lastSentAt) || lastSentAt <= 0) return false;
  return now - lastSentAt < minIntervalMs;
}
