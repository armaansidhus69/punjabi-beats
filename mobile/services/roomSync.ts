/**
 * Room sync orchestrator (Phase 11) — poora "kaam" yahi file karti hai.
 *
 * ⚠️ SABSE ZAROORI: ECHO LOOP KAHAN TOOTTA HAI
 *   local action  → playerStore emitAction({ remote: false })  → hum broadcast karte hain
 *   remote event  → playerStore action({ remote: true })       → emitAction({ remote: true })
 *                 → handleLocalAction usse turant SKIP karta hai
 *   Isliye remote se aaya action dobara broadcast nahi hota — loop band.
 *   (Doosra guard: `senderId === mySenderId` — apne hi publish ka echo ignore.)
 *
 * 3 LAYERS (separation of concerns):
 *   services/apinator.ts   → sirf transport (socket, channel subscribe, publish)
 *   services/roomSync.ts   → ye file: kab join/leave, kya bhejna, kaise apply (orchestration)
 *   utils/syncPayload.ts   → pure helpers (build/parse/guards) — headless testable
 *
 * REGISTRATION (ek jagah se):
 *   app/_layout.tsx → initRoomSync()
 *     ├─ playerStore.setPlayerActionListener(handleLocalAction)    → broadcast
 *     ├─ roomStore.setRoomLifecycleListener(handleRoomLifecycle)   → join/leave
 *     └─ apinator.onStateChange(...)                               → connectionState
 *   Screens sirf roomStore.createRoom()/joinRoom()/leaveRoom() call karte hain —
 *   socket/handlers ka hisaab yahin hota hai.
 *
 * PHASE 12 (Vercel /api/publish deploy) ke bina: socket connect ho jaata hai,
 * sirf broadcast fail hoti hai — local playback normally chalta rehta hai
 * (ek hi baar friendly warning log hoti hai).
 */
import { Channel } from '@apinator/client';
import { PlayerActionEvent, RoomMember, SyncPayload } from '../types';
import { usePlayer, setPlayerActionListener } from '../stores/playerStore';
import { RoomLifecycleEvent, setRoomLifecycleListener, useRoom } from '../stores/roomStore';
import {
  SUBSCRIBED_EVENT,
  SUBSCRIPTION_ERROR_EVENT,
  ensureClient,
  getClientState,
  getSubscribedCode,
  isChannelSubscribed,
  isPublishConfigured,
  onStateChange,
  publishEvent,
  subscribeChannel,
  unsubscribeChannel,
} from './apinator';
import {
  SEEK_THROTTLE_MS,
  SYNC_EVENT_CONTROL,
  SYNC_EVENT_MEMBER_JOIN,
  SYNC_EVENT_MEMBER_LEAVE,
  SYNC_EVENT_MEMBERS,
  SYNC_EVENT_SONG,
  SyncSnapshot,
  buildSyncPayload,
  compensatedPosition,
  isOwnEcho,
  parseSyncPayload,
  shouldIgnoreRemote,
  shouldThrottleSeek,
  syncEventForAction,
} from '../utils/syncPayload';

let initialized = false;
let senderId = '';
let disposeStateListener: (() => void) | null = null;
let publishWarned = false;
/* seek throttle (leading edge + trailing flush) */
let lastSeekSentAt = 0;
let pendingSeek: number | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;

/* ---------- Presence roster (Phase 14 — FR-5.10 / FR-5.11) ---------- */
/**
 * Host ki roster: senderId → member + last heartbeat. Sirf host rakhta hai;
 * updated list host hi `member-list` event se broadcast karta hai. Heartbeat
 * stale members (abrupt disconnect) ko khud hata deta hai.
 */
const presenceRoster = new Map<string, { name: string; lastSeen: number }>();
let presenceTimer: ReturnType<typeof setInterval> | null = null;
const PRESENCE_HEARTBEAT_MS = 30_000;
const PRESENCE_STALE_MS = 90_000;

/**
 * Is device ki identity — sirf apne hi echo ko pehchanna ke liye (security
 * nahi). Har app session pe naya; persist karne ki zaroorat nahi kyunki
 * session ke bahar purane events relevant nahi.
 */
export function getSenderId(): string {
  if (!senderId) {
    senderId = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
  return senderId;
}

function snapshot(): SyncSnapshot {
  const p = usePlayer.getState();
  return {
    currentSongId: p.currentSong?.id ?? null,
    index: p.index,
    isPlaying: p.isPlaying,
    position: p.position,
  };
}

/* ---------- Init (app/_layout.tsx se ek baar) ---------- */

/**
 * Client connect + listeners register. Idempotent hai (StrictMode/dev double
 * call safe) aur config missing hone pe crash nahi karta — sirf room sync
 * band rehta hai (`connectionState: 'failed'` + error message).
 */
export function initRoomSync(): void {
  if (initialized) return;
  initialized = true;
  getSenderId();

  // Local playback actions ka listener (broadcast) + room lifecycle listener
  setPlayerActionListener(handleLocalAction);
  setRoomLifecycleListener(handleRoomLifecycle);

  try {
    disposeStateListener = onStateChange(state => {
      useRoom.getState().setConnectionState(state);
    });
    ensureClient(); // connect() — state 'connecting' ho jaata hai

    if (!isPublishConfigured()) {
      console.warn(
        'roomSync: EXPO_PUBLIC_PUBLISH_URL set nahi hai — room me playback broadcast nahi hoga (Phase 12 ke baad .env update karo). Local playback normal chalega.',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apinator init fail';
    console.warn('roomSync: init skipped —', message);
    useRoom.getState().setConnectionState('failed');
    useRoom.getState().setError(message);
  }
}

/** Teardown (tests/dev ke liye) — app normally ise call nahi karta */
export function disposeRoomSync(): void {
  setPlayerActionListener(null);
  setRoomLifecycleListener(null);
  disposeStateListener?.();
  disposeStateListener = null;
  leaveSyncChannel();
  initialized = false;
}

/* ---------- Room lifecycle → channel join/leave ---------- */

/** roomStore ne room enter/left kiya (create/join/leave se automatically) */
function handleRoomLifecycle(event: RoomLifecycleEvent): void {
  if (event.type === 'entered') {
    joinSyncChannel(event.code);
  } else {
    leaveSyncChannel();
  }
}

/**
 * `room-{code}` channel subscribe + event bind (host create kare ya guest join
 * kare — dono case me yahi chalta hai).
 */
export function joinSyncChannel(code: string): void {
  const room = useRoom.getState();

  // Pehle se isi room pe subscribed hain → dobara subscribe nahi
  if (getSubscribedCode() === code) {
    room.setConnectionState(getClientState());
    return;
  }

  try {
    room.setError(null);
    room.setConnectionState('connecting');
    subscribeChannel(code, bindChannelEvents);
    room.setConnectionState(getClientState());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Room sync start nahi ho paya';
    console.warn('roomSync: join failed —', message);
    room.setConnectionState('failed');
    room.setError(message);
  }
}

/**
 * Channel events bind. Ye alag function hai kyunki room switch/reconnect pe
 * channel dobara subscribe hota hai aur handlers ek hi jagah se lagne chahiye.
 *
 * Event names: `song-change` (song + queue), `playback-control` (play/pause/seek)
 * aur `member-list` (Phase 14 presence ke liye reserved — abhi sirf bind hai).
 */
function bindChannelEvents(ch: Channel): void {
  ch.bind(SYNC_EVENT_SONG, (data: unknown) => {
    void handleRemoteEvent(data);
  });
  ch.bind(SYNC_EVENT_CONTROL, (data: unknown) => {
    void handleRemoteEvent(data);
  });
  ch.bind(SYNC_EVENT_MEMBERS, (data: unknown) => {
    handleMemberList(data);
  });
  ch.bind(SYNC_EVENT_MEMBER_JOIN, (data: unknown) => {
    handleMemberJoin(data);
  });
  ch.bind(SYNC_EVENT_MEMBER_LEAVE, (data: unknown) => {
    handleMemberLeave(data);
  });
  // SDK ka asli subscribe-success event (pehle galat naam bind hota tha)
  ch.bind(SUBSCRIBED_EVENT, () => {
    const room = useRoom.getState();
    room.setConnectionState('connected');
    room.setError(null);
    // Presence (Phase 14): apna naam announce + heartbeat chalu
    announcePresence();
    startPresenceHeartbeat();
  });
  ch.bind(SUBSCRIPTION_ERROR_EVENT, (data: unknown) => {
    console.warn('roomSync: channel subscribe error', data);
    const room = useRoom.getState();
    room.setConnectionState('failed');
    room.setError('Room se connect nahi ho paye — internet check karo');
  });
}

/**
 * Channel chhodo (socket zinda rehta hai, agla join turant hoga). Room switch
 * pe subscribeChannel khud bhi isi ko call karta hai.
 */
export function leaveSyncChannel(): void {
  if (seekTimer) {
    clearTimeout(seekTimer);
    seekTimer = null;
  }
  pendingSeek = null;
  lastSeekSentAt = 0;
  // Presence: unsubscribe se pehle "main chala gaya" bhejo — host roster se
  // hata dega. Publish HTTP se hai, isliye channel live hone ki zaroorat nahi.
  announceLeave();
  stopPresenceHeartbeat();
  presenceRoster.clear();
  unsubscribeChannel();
  const room = useRoom.getState();
  room.setMembers([]);
  // Room chala gaya par socket connected ho sakta hai — wahi state dikhao
  room.setConnectionState(getClientState());
}

export function isSyncing(): boolean {
  return getSubscribedCode() !== null && isChannelSubscribed();
}

/* ---------- Local action → broadcast ---------- */

/**
 * playerStore ke har local action pe chalta hai.
 * Skip conditions: (1) remote se aaya action (loop break), (2) room me nahi hain.
 */
export function handleLocalAction(action: PlayerActionEvent): void {
  if (action.remote) return;

  const code = getSubscribedCode();
  if (!code) return;

  if (action.type === 'seek') {
    enqueueSeek(action.position);
    return;
  }

  const now = Date.now();
  const payload = buildSyncPayload(action, {
    senderId: getSenderId(),
    position: usePlayer.getState().position,
    sentAt: now,
  });
  void publish(code, syncEventForAction(action), payload);
}

/**
 * Seek throttle: ek window me ek hi broadcast (leading edge), window ke andar
 * aaye to trailing flush pe last position bhej do. Isse 2 devices ke beech
 * seek spam nahi hota.
 */
function enqueueSeek(positionMs: number): void {
  if (!shouldThrottleSeek(lastSeekSentAt, Date.now())) {
    flushSeek(positionMs);
    return;
  }
  pendingSeek = positionMs;
  if (seekTimer) return;
  seekTimer = setTimeout(() => {
    seekTimer = null;
    const pending = pendingSeek;
    pendingSeek = null;
    if (pending !== null) flushSeek(pending);
  }, SEEK_THROTTLE_MS);
}

function flushSeek(positionMs: number): void {
  const code = getSubscribedCode();
  if (!code) return;
  const now = Date.now();
  lastSeekSentAt = now;
  const payload = buildSyncPayload(
    { type: 'seek', position: positionMs, remote: false },
    { senderId: getSenderId(), position: positionMs, sentAt: now },
  );
  void publish(code, SYNC_EVENT_CONTROL, payload);
}

/**
 * Vercel /api/publish pe POST. **Silent fail** — network ya backend down ho to
 * bhi local playback nahi rukna chahiye (warning sirf ek baar log hoti hai).
 */
async function publish(
  code: string,
  event: string,
  payload: SyncPayload | Record<string, unknown>,
): Promise<void> {
  try {
    // Wire pe JSON string bhejte hain; receive side string aur object dono
    // handle karta hai (SDK khud bhi JSON string ko parse kar deta hai).
    await publishEvent(code, event, JSON.stringify(payload));
  } catch (err) {
    if (!publishWarned) {
      publishWarned = true;
      console.warn(
        'roomSync: broadcast fail (local playback chalu rahega):',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/* ---------- Remote event → local player ---------- */

/**
 * Apinator event aane pe chalta hai (song-change / playback-control dono).
 * Flow: parse → apna echo ignore → duplicate guard → player action `remote: true`.
 * `remote: true` ka matlab: ye action dobara broadcast NAHI hoga (loop band).
 */
export async function handleRemoteEvent(raw: unknown): Promise<void> {
  const msg = parseSyncPayload(raw);
  if (!msg) return; // bekaar payload → chup-chaap ignore (crash nahi)
  if (isOwnEcho(msg, getSenderId())) return;

  const now = Date.now();
  const target = compensatedPosition(msg.position, msg.sentAt, now);
  if (shouldIgnoreRemote(msg, snapshot(), target)) return;

  const player = usePlayer.getState();
  try {
    switch (msg.type) {
      case 'song':
        // Late joiner ko host ki exact position se start karte hain (FR-5.3);
        // host paused tha to yahan bhi paused (startPaused: true).
        await player.playSong(msg.song, msg.queue, {
          initialPosition: target,
          startPaused: !msg.isPlaying,
          remote: true,
        });
        return;
      case 'play':
        await player.play({ remote: true, seekTo: target });
        return;
      case 'pause':
        await player.pause({ remote: true, seekTo: target });
        return;
      case 'seek':
        await player.seek(msg.position, { remote: true });
        return;
    }
  } catch (err) {
    console.warn('roomSync: remote action apply fail:', err);
  }
}

/* ---------- Presence (Phase 14 ke liye reserved) ---------- */

function parseRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
}

/** Presence payload se naam/id safe nikalo (bekaar payload → null) */
function parsePresenceMember(raw: unknown): { id: string; name: string } | null {
  const data = parseRecord(raw);
  if (!data) return null;
  const id = typeof data.senderId === 'string' ? data.senderId : '';
  if (!id) return null;
  const rawName = typeof data.name === 'string' ? data.name.trim() : '';
  return { id, name: rawName.slice(0, 20) || 'Guest' };
}

/**
 * `member-join` — kisi client ne apna naam announce kiya. Sirf host roster
 * maintain karta hai (FR-5.10) aur turant updated `member-list` broadcast
 * karta hai. Apna hi echo aaye to set idempotent hai — duplicate nahi banta.
 */
function handleMemberJoin(raw: unknown): void {
  const room = useRoom.getState();
  if (!room.isHost) return;
  const member = parsePresenceMember(raw);
  if (!member) return;
  presenceRoster.set(member.id, { name: member.name, lastSeen: Date.now() });
  broadcastMemberList();
}

/** `member-leave` — client chala gaya (sirf host roster se hatata hai) */
function handleMemberLeave(raw: unknown): void {
  const room = useRoom.getState();
  if (!room.isHost) return;
  const member = parsePresenceMember(raw);
  if (!member) return;
  if (presenceRoster.delete(member.id)) broadcastMemberList();
}

/**
 * `member-list` event — host ne online members ki list bheji (FR-5.10).
 * Purana `string[]` format bhi accept karta hai (backward compatible).
 */
function handleMemberList(raw: unknown): void {
  const data = parseRecord(raw);
  if (!data || !Array.isArray(data.members)) {
    useRoom.getState().setMembers([]);
    return;
  }
  const list: RoomMember[] = [];
  for (const m of data.members) {
    if (typeof m === 'string' && m) {
      list.push({ id: m, name: 'Guest' });
    } else if (m && typeof m === 'object') {
      const rec = m as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id : '';
      const name =
        typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim().slice(0, 20) : 'Guest';
      if (id) list.push({ id, name });
    }
  }
  useRoom.getState().setMembers(list);
}

/**
 * Apna naam + heartbeat channel pe bhejo (FR-5.11). Host khud ko roster me
 * daal ke turant `member-list` broadcast karta hai — isliye akela host bhi
 * members list me dikhta hai.
 */
function announcePresence(): void {
  const code = getSubscribedCode();
  if (!code) return;
  const room = useRoom.getState();
  const id = getSenderId();
  const name = room.name.trim() || 'Guest';
  if (room.isHost) {
    presenceRoster.set(id, { name, lastSeen: Date.now() });
    broadcastMemberList();
  }
  void publish(code, SYNC_EVENT_MEMBER_JOIN, { senderId: id, name, sentAt: Date.now() });
}

/** Room chhodte waqt host ko batao — host roster se hamara id hata dega */
function announceLeave(): void {
  const code = getSubscribedCode();
  if (!code) return;
  void publish(code, SYNC_EVENT_MEMBER_LEAVE, { senderId: getSenderId(), sentAt: Date.now() });
}

/** Host ke roster ki current list sab members ko bhejo (FR-5.10) */
function broadcastMemberList(): void {
  const code = getSubscribedCode();
  if (!code || !useRoom.getState().isHost) return;
  const members: RoomMember[] = [...presenceRoster.entries()].map(([id, m]) => ({
    id,
    name: m.name,
  }));
  void publish(code, SYNC_EVENT_MEMBERS, { senderId: getSenderId(), members, sentAt: Date.now() });
}

/**
 * 30s heartbeat: guest dobara `member-join` bhejta hai (lastSeen refresh),
 * host stale members prune karta hai (abrupt disconnect ka cleanup) + list
 * dobara broadcast karta hai.
 */
function startPresenceHeartbeat(): void {
  stopPresenceHeartbeat();
  presenceTimer = setInterval(() => {
    const room = useRoom.getState();
    if (!room.code || getSubscribedCode() === null) {
      stopPresenceHeartbeat();
      return;
    }
    const id = getSenderId();
    const now = Date.now();
    if (room.isHost) {
      for (const [memberId, entry] of presenceRoster) {
        if (memberId !== id && now - entry.lastSeen > PRESENCE_STALE_MS) {
          presenceRoster.delete(memberId);
        }
      }
      announcePresence(); // self refresh + member-list broadcast
    } else {
      void publish(room.code, SYNC_EVENT_MEMBER_JOIN, {
        senderId: id,
        name: room.name.trim() || 'Guest',
        sentAt: now,
      });
    }
  }, PRESENCE_HEARTBEAT_MS);
}

function stopPresenceHeartbeat(): void {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

/* ---------- Debug helper ---------- */

/** Room screen ke chhote debug line ke liye (identity + room + socket state) */
export function getSyncSummary(): {
  senderId: string;
  roomCode: string | null;
  connection: string;
  subscribed: boolean;
} {
  const room = useRoom.getState();
  return {
    senderId: getSenderId(),
    roomCode: getSubscribedCode() ?? room.code,
    connection: room.connectionState,
    subscribed: isChannelSubscribed(),
  };
}
