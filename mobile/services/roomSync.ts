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
import Toast from 'react-native-toast-message';
import {
  ChatMessagePayload,
  PlayerActionEvent,
  QueueAddPayload,
  RoomMember,
  Song,
  SyncPayload,
} from '../types';
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
  SYNC_EVENT_CHAT_MESSAGE,
  SYNC_EVENT_CONTROL,
  SYNC_EVENT_MEMBER_JOIN,
  SYNC_EVENT_MEMBER_LEAVE,
  SYNC_EVENT_MEMBERS,
  SYNC_EVENT_QUEUE_ADD,
  SYNC_EVENT_SONG,
  SyncSnapshot,
  buildQueueAddPayload,
  buildSyncPayload,
  buildChatMessagePayload,
  parseChatMessage,
  compensatedPosition,
  isOwnEcho,
  parseQueueAdd,
  parseSyncPayload,
  shouldIgnoreRemote,
  shouldThrottleSeek,
  syncEventForAction,
} from '../utils/syncPayload';

let initialized = false;
let senderId = '';
let disposeStateListener: (() => void) | null = null;
let publishWarned = false;
/** ChatModal khula hai? (khula ho to toast/badge suppress — modal khud dikhata hai) */
let chatOpen = false;

/** ChatModal mount/unmount pe register kare — roomSync toast/unread decide kare */
export function setChatOpen(open: boolean): void {
  chatOpen = open;
}
/* seek throttle (leading edge + trailing flush) */
let lastSeekSentAt = 0;
let pendingSeek: number | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;
let remoteEventQueue: Promise<void> = Promise.resolve();

function cancelPendingSeek(): void {
  if (seekTimer) {
    clearTimeout(seekTimer);
    seekTimer = null;
  }
  pendingSeek = null;
}

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
      console.log('[roomSync][DEBUG] connection change:', state);
      const room = useRoom.getState();
      room.setConnectionState(state);
      // Reconnect ke baad safety net: agar transport ka channel kisi wajah se
      // toot gaya ho (SDK normally khud re-subscribe karta hai) to wapas join.
      if (state === 'connected' && room.code && getSubscribedCode() !== room.code) {
        console.log('[roomSync][DEBUG] channel missing after reconnect — re-joining', room.code);
        joinSyncChannel(room.code);
      }
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
  publishWarned = false;
  chatOpen = false;
  remoteEventQueue = Promise.resolve();
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
  const currentCode = getSubscribedCode();

  // Pehle se isi room pe subscribed hain → dobara subscribe nahi
  if (currentCode === code && isChannelSubscribed()) {
    room.setConnectionState('connected');
    return;
  }

  // Agar kisi doosre room se switch kar rahe hain, toh pehle purana clean karo
  if (currentCode && currentCode !== code) {
    leaveSyncChannel();
  }

  try {
    room.setError(null);
    room.setConnectionState('connecting');
    console.log('[roomSync][DEBUG] subscribing to room-' + code, `(client=${getClientState()})`);
    subscribeChannel(code, bindChannelEvents);
    // NOTE: Yahan getClientState() set NAHI karna hai, warna SUBSCRIBED_EVENT se
    // pehle hi UI 'connected' dikhane lagega. SUBSCRIBED_EVENT khud state update karega.
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
 * Event names: `song-change` (song + queue), `playback-control` (play/pause/seek),
 * `queue-add` (member ne queue me naya song daala) aur `member-list` (Phase 14
 * presence ke liye reserved — abhi sirf bind hai).
 */
function bindChannelEvents(ch: Channel): void {
  ch.bind(SYNC_EVENT_SONG, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_SONG);
    void handleRemoteEvent(data);
  });
  ch.bind(SYNC_EVENT_CONTROL, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_CONTROL);
    void handleRemoteEvent(data);
  });
  ch.bind(SYNC_EVENT_QUEUE_ADD, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_QUEUE_ADD);
    void handleQueueAdd(data);
  });
  // FR-5.12 room chat — queue-add jaisa pattern (koi bhi member, host bhi)
  ch.bind(SYNC_EVENT_CHAT_MESSAGE, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_CHAT_MESSAGE);
    handleChatMessage(data);
  });
  ch.bind(SYNC_EVENT_MEMBERS, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_MEMBERS);
    handleMemberList(data);
  });
  ch.bind(SYNC_EVENT_MEMBER_JOIN, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_MEMBER_JOIN);
    handleMemberJoin(data);
  });
  ch.bind(SYNC_EVENT_MEMBER_LEAVE, (data: unknown) => {
    console.log('[roomSync][DEBUG] event received:', SYNC_EVENT_MEMBER_LEAVE);
    handleMemberLeave(data);
  });
  // SDK ka asli subscribe-success event (pehle galat naam bind hota tha)
  ch.bind(SUBSCRIBED_EVENT, () => {
    console.log('[roomSync][DEBUG] channel subscribed:', ch.name);
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
  cancelPendingSeek();
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

  // Agar seek ke alawa koi bhi action (song/play/pause) aaya,
  // toh purana pending seek cancel karo taaki out-of-order broadcast na ho.
  cancelPendingSeek();

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
  payload: SyncPayload | QueueAddPayload | ChatMessagePayload | Record<string, unknown>,
): Promise<void> {
  try {
    console.log('[roomSync][DEBUG] event sent:', event, '→ room-' + code);
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

/* ---------- Room queue add (spec: koi bhi member — host bhi — add kar sake) ---------- */

/**
 * FR-5.12 room chat send — queue-add pattern: pehle apna message local store
 * me (turant dikhe), phir 'chat-message' broadcast. Khali text -> 'empty',
 * room me nahi -> 'no-room'.
 */
export async function sendChatMessage(text: string): Promise<'sent' | 'empty' | 'no-room'> {
  const chatRoom = useRoom.getState();
  const chatCode = chatRoom.code;
  if (!chatCode) return 'no-room';
  const payload: ChatMessagePayload | null = buildChatMessagePayload(
    text,
    chatRoom.name.trim() || 'Guest',
    { senderId: getSenderId(), sentAt: Date.now() },
  );
  if (!payload) return 'empty';
  chatRoom.addMessage({
    id: payload.id,
    sender: payload.sender,
    text: payload.text,
    timestamp: payload.timestamp,
    senderId: payload.senderId,
    self: true,
  });
  await publish(chatCode, SYNC_EVENT_CHAT_MESSAGE, payload);
  return 'sent';
}

/**
 * Incoming 'chat-message' — queue-add jaisa: (1) apna echo skip (sender khud
 * already add kar chuka hai), (2) id dedupe — addMessage bhi guard karta hai,
 * (3) bekaar payload parseChatMessage me reject. Modal band ho to Toast +
 * unread badge; khula ho to list khud dikhati hai.
 */
function handleChatMessage(raw: unknown): void {
  const msg = parseChatMessage(raw);
  if (!msg) return;
  if (msg.senderId === getSenderId()) return;
  const room = useRoom.getState();
  const before = room.messages.length;
  room.addMessage({
    id: msg.id,
    sender: msg.sender,
    text: msg.text,
    timestamp: msg.timestamp,
    senderId: msg.senderId,
    self: false,
  });
  if (useRoom.getState().messages.length === before) return;
  if (!chatOpen) {
    const current = useRoom.getState();
    current.setUnreadCount(current.unreadCount + 1);
    Toast.show({ type: 'info', text1: `${msg.sender}`, text2: msg.text });
  }
}

/**
 * '+' → "Add to Room Queue". Pehle apne device pe queue me add (turant
 * dikhta hai), phir sab members ko 'queue-add' broadcast. Koi isHost check
 * nahi — host aur guest dono chala sakte hain. Dedupe id pe:
 * duplicate → 'duplicate', room me nahi → 'no-room'.
 */
export async function addSongToRoomQueue(
  song: Song,
): Promise<'added' | 'duplicate' | 'no-room'> {
  const room = useRoom.getState();
  if (!room.code) return 'no-room';

  const added = await usePlayer.getState().addToQueue(song);
  if (!added) return 'duplicate';

  // Apna echo wapas aake dobara add na kare — isliye senderId bhejte hain
  const code = getSubscribedCode();
  if (code) {
    void publish(
      code,
      SYNC_EVENT_QUEUE_ADD,
      buildQueueAddPayload(song, room.name.trim() || 'Guest', {
        senderId: getSenderId(),
        sentAt: Date.now(),
      }),
    );
  }
  return 'added';
}

/**
 * Remote 'queue-add' → apne queue me add + Toast "<naam> ne '<song>' add kiya".
 * Guards: (1) apna hi echo skip (sender khud already add kar chuka hai),
 * (2) dedupe — race me do members ne ek saath same song bheja ho to skip,
 * (3) bekaar payload parseQueueAdd me hi reject.
 */
async function handleQueueAdd(raw: unknown): Promise<void> {
  const msg = parseQueueAdd(raw);
  if (!msg) return;
  if (msg.senderId === getSenderId()) return;

  try {
    const added = await usePlayer.getState().addToQueue(msg.song);
    if (!added) return;
    Toast.show({ type: 'info', text1: `${msg.addedBy} ne '${msg.song.title}' add kiya` });
  } catch (err) {
    console.warn('roomSync: queue-add apply fail:', err);
  }
}

/* ---------- Remote event → local player ---------- */

/**
 * Apinator event aane pe chalta hai (song-change / playback-control dono).
 * Flow: parse → apna echo ignore → duplicate guard → player action `remote: true`.
 * `remote: true` ka matlab: ye action dobara broadcast NAHI hoga (loop band).
 */
export function handleRemoteEvent(raw: unknown): Promise<void> {
  // Queue mein chain karo taaki playSong() ke beech mein pause/seek race na kare
  remoteEventQueue = remoteEventQueue
    .then(() => applyRemoteEventInternal(raw))
    .catch(err => {
      console.warn('roomSync: queue error:', err);
    });
  return remoteEventQueue;
}

async function applyRemoteEventInternal(raw: unknown): Promise<void> {
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
  if (!member || member.id === getSenderId()) return; // Apna echo ignore

  const existing = presenceRoster.get(member.id);
  const isNewMember = !existing;
  const isNameChanged = existing ? existing.name !== member.name : false;

  // Heartbeat timestamp hamesha update karo
  presenceRoster.set(member.id, { name: member.name, lastSeen: Date.now() });

  // Sirf tab broadcast karo jab sach mein koi naya aaya ho ya naam badla ho (No Heartbeat Spam!)
  if (isNewMember || isNameChanged) {
    broadcastMemberList();
  }

  // BUG FIX (FR-5.3): Naye joiner ko current song aur position turant bhejo!
  if (isNewMember && room.code) {
    const p = usePlayer.getState();
    if (p.currentSong) {
      const now = Date.now();
      const payload = buildSyncPayload(
        {
          type: 'song',
          song: p.currentSong,
          queue: p.queue,
          position: p.position,
          isPlaying: p.isPlaying,
          remote: false,
        },
        { senderId: getSenderId(), position: p.position, sentAt: now },
      );
      void publish(room.code, SYNC_EVENT_SONG, payload);
    }
  }
}

function handleMemberLeave(raw: unknown): void {
  const member = parsePresenceMember(raw);
  if (!member) return;

  const room = useRoom.getState();
  if (room.isHost) {
    if (presenceRoster.delete(member.id)) broadcastMemberList();
  } else {
    // Guest side: agar koi member (ya Host) leave kare toh local list se turant hatao
    room.setMembers(room.members.filter(m => m.id !== member.id));
  }
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
    // Host ko SYNC_EVENT_MEMBER_JOIN bhejne ki zaroorat nahi, wo khud roster maintain karta hai
    presenceRoster.set(id, { name, lastSeen: Date.now() });
    broadcastMemberList();
  } else {
    void publish(code, SYNC_EVENT_MEMBER_JOIN, { senderId: id, name, sentAt: Date.now() });
  }
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
      const name = room.name.trim() || 'Guest';
      presenceRoster.set(id, { name, lastSeen: now });

      let pruned = false;
      for (const [memberId, entry] of presenceRoster) {
        if (memberId !== id && now - entry.lastSeen > PRESENCE_STALE_MS) {
          presenceRoster.delete(memberId);
          pruned = true;
        }
      }
      // Sirf tab broadcast karo jab koi stale member prune hua ho
      if (pruned) {
        broadcastMemberList();
      }
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
