/**
 * Apinator transport layer (Phase 11 ke baad iska role: sirf transport).
 *
 * Design:
 * - Poore app me ek hi Apinator client (singleton) — duplicate WebSocket se
 *   bachne ke liye. Business logic (kab join/leave, kya broadcast, kaise apply)
 *   `services/roomSync.ts` me hai; ye file sirf SDK ko wrap karti hai.
 * - Publish HAMESHA Vercel function (/api/publish) se hota hai — secrets
 *   (app id/secret) client pe nahi aate.
 *
 * SDK v2.0.0 ke REAL facts (node_modules/@apinator/client/dist/index.mjs se
 * verify kiye, guess nahi):
 * - Connection state global event ka naam **`state_change`** hai, payload
 *   `{ previous, current }`. (`client.state` bhi poll kar sakte ho, par event
 *   better hai — koi 1s interval nahi chahiye.)
 * - Channel subscribe hone pe event **`realtime:subscription_succeeded`** aata
 *   hai (pehle yahan `apinator:subscribed` bind hota tha — SDK me aisa koi event
 *   nahi hai, isliye "Connected" confirm kabhi nahi hota tha. Ab fix.)
 * - ⚠️ BUG (v2.0.0, dist/index.mjs verify kiya): SDK ka reconnect code NO-OP
 *   hai — handleDisconnect() state 'connecting' karke connect() schedule
 *   karta hai, aur connect() 'connecting' state pe early return karta hai
 *   (index.mjs:202-204 + 260-272). Ek baar connection tootne pe state
 *   hamesha 'connecting' pe stuck → UI "Connecting…" + events band. Isliye
 *   app-level watchdog + forceReconnect (createClient) neeche — ye asli
 *   recovery karta hai.
 * - Reconnect (jo bhi usse kare) ke baad SDK saare channels khud dobara
 *   subscribe karta hai (handleStateChange me sendSubscribe loop,
 *   index.mjs:461-465) — haath se re-subscribe nahi chahiye, par wo sirf tab
 *   kaam aata hai jab connection wapas `connected` ho (upar wala watchdog).
 * - ⚠️ BUG 2 (v2.0.0): activity timer sirf connection_established pe ek baar
 *   arm hota hai, pong pe re-arm nahi hota (pong handler khaali, line 250) —
 *   har connection ~activity_timeout+30s baad force-close hota hai.
 *   `installKeepAlive()` pong pe timer wapas arm karta hai (best-effort);
 *   warna watchdog se phir bhi recover ho jayega.
 * - Global event name se `client.bind('state_change', cb)` bhi possible hai
 *   (globalBindings har message pe check hoti hai) — hum wahi use karte hain.
 */
import axios from 'axios';
import { Apinator, Channel } from '@apinator/client';
import { AppState, type AppStateStatus } from 'react-native';
import { ConnectionState } from '../types';

const APP_KEY = process.env.EXPO_PUBLIC_APINATOR_KEY ?? '';
const CLUSTER = process.env.EXPO_PUBLIC_APINATOR_CLUSTER ?? 'eu';
const PUBLISH_URL = process.env.EXPO_PUBLIC_PUBLISH_URL ?? '';
const PUBLISH_TIMEOUT_MS = 8000;

/** Placeholder detection — .env me example values chhodi hui hon to bhi fail-fast */
function isPlaceholder(value: string): boolean {
  return value.startsWith('YAHAN_') || value.startsWith('YOUR');
}

/* ---------- SDK event names (constants: typo se bachne ke liye) ---------- */

/** channel subscribe successful — iske baad hi events aana shuru hote hain */
export const SUBSCRIBED_EVENT = 'realtime:subscription_succeeded';
/** subscribe fail (private/presence auth ya server error) */
export const SUBSCRIPTION_ERROR_EVENT = 'realtime:subscription_error';
/** presence channel pe member add/remove (Phase 14) */
export const MEMBER_ADDED_EVENT = 'realtime:member_added';
export const MEMBER_REMOVED_EVENT = 'realtime:member_removed';
/** client connection state badla: { previous, current } */
export const STATE_CHANGE_EVENT = 'state_change';

/** SDK khud kitne attempts tak reconnect karta hai (documentation ke liye) */
export const SDK_MAX_RECONNECT_ATTEMPTS = 6;

let client: Apinator | null = null;
let channel: Channel | null = null;
let channelCode: string | null = null;
/** state_change handlers — force-reconnect (naya client) inhe wapas bind karta hai */
const stateCallbacks = new Map<(state: ConnectionState) => void, (payload: unknown) => void>();
/** channel bind callback — force-reconnect naye channel pe yahi wapas lagata hai */
let channelBinder: ((ch: Channel) => void) | null = null;

/* ---------- Reconnection watchdog state (SDK reconnect bug ka fix — neeche) ---------- */
const WATCHDOG_INTERVAL_MS = 5_000;
/** 'connecting' kitni der tak stuck ho to force reconnect karein */
const CONNECTING_STUCK_MS = 6_000;
/** Reconnect ke beech min gap (4s); fail-streak pe exponential → 30s cap */
const RECONNECT_MIN_GAP_MS = 4_000;
const RECONNECT_MAX_GAP_MS = 30_000;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastReconnectAt = 0;
/** 'connecting' kab se hai (state_change / forceReconnect set karte hain) */
let connectingSince = 0;
/** Lagataar reconnect attempts (connected pe reset) — backoff ke liye */
let failStreak = 0;
/** connection_established ka activity_timeout — keep-alive re-arm ke liye */
let activityTimeoutSec = 120;

/* ---------- Config ---------- */

/**
 * Socket chalane ke liye sirf app key chahiye. Publish URL alag check hai —
 * Phase 12 (Vercel deploy) tak socket connect ho jaata hai, sirf broadcast fail
 * hoti hai (room local playback chalta rehta hai).
 */
export function isKeyConfigured(): boolean {
  return Boolean(APP_KEY) && !isPlaceholder(APP_KEY);
}

/** Broadcast (/api/publish) ke liye Vercel URL chahiye */
export function isPublishConfigured(): boolean {
  return Boolean(PUBLISH_URL) && !isPlaceholder(PUBLISH_URL);
}

/** Poora setup (socket + broadcast) tayyar hai? */
export function isConfigured(): boolean {
  return isKeyConfigured() && isPublishConfigured();
}

export function configHint(): string {
  return 'Apinator config missing. mobile/.env me EXPO_PUBLIC_APINATOR_KEY (aur broadcast ke liye EXPO_PUBLIC_PUBLISH_URL) bharo, phir "npx expo start -c" se restart karo.';
}

/* ---------- Client ---------- */

/**
 * Naya client banao + saari bindings wapas lagao (pehli baar aur force
 * reconnect — dono jagah yahi chalta hai). `channelCode` set ho to channel bhi
 * turant: connect hote hi SDK khud `sendSubscribe` bhej dega (ya 'connected'
 * pe handleStateChange bhejega).
 *
 * NOTE (race-free): force-reconnect purane client ko `disconnect()` karke
 * chhod deta hai aur poora naya client banata hai — purane client ka late
 * onclose event naye client ko nahi bigaad sakta (agar wahi client
 * `disconnect()+connect()` karte to purana onclose naye socket ki reference
 * null kar deta — silent failure).
 */
function createClient(): Apinator {
  const c = new Apinator({ appKey: APP_KEY, cluster: CLUSTER });
  installKeepAlive(c);
  for (const cb of stateCallbacks.values()) c.bind(STATE_CHANGE_EVENT, cb);
  if (channelCode && channelBinder) {
    channel = c.subscribe(getChannelName(channelCode));
    channelBinder(channel);
  }
  client = c;
  c.connect();
  startWatchdog(); // SDK ka reconnect no-op hai — app-level recovery chahiye
  return c;
}

/**
 * Client banao + connect karo (idempotent). Config missing ho to throw —
 * caller (roomSync.initRoomSync) isko catch karke friendly state set karta hai,
 * app crash nahi hota.
 */
export function ensureClient(): Apinator {
  if (client) return client;
  if (!isKeyConfigured()) throw new Error(configHint());
  return createClient();
}

export function getClient(): Apinator | null {
  return client;
}

/** SDK state → humare 5 states (`unavailable` → `failed`) */
export function toConnectionState(raw: string | undefined): ConnectionState {
  if (raw === 'connected') return 'connected';
  if (raw === 'connecting') return 'connecting';
  if (raw === 'initialized') return 'initialized';
  if (raw === 'unavailable') return 'failed';
  return 'disconnected';
}

export function getClientState(): ConnectionState {
  return client ? toConnectionState(client.state) : 'disconnected';
}

/** Socket id — sirf debug/log ke liye */
export function getSocketId(): string | null {
  return client?.socketId ?? null;
}

/**
 * Connection state changes subscribe karo. Return: unsubscribe function
 * (initRoomSync ek hi baar register karta hai, wahi rehta hai).
 */
export function onStateChange(handler: (state: ConnectionState) => void): () => void {
  const c = ensureClient();
  const cb = (payload: unknown): void => {
    const data = (payload ?? {}) as { previous?: string; current?: string };
    console.log('[apinator][DEBUG] state_change:', data.previous, '→', data.current);
    // Watchdog ke liye precise timing: 'connecting' kab se hai / streak reset
    if (data.current === 'connected') {
      connectingSince = 0;
      failStreak = 0;
    } else if (data.current === 'connecting') {
      connectingSince = Date.now();
    }
    handler(toConnectionState(data.current));
  };
  // Map me rakho taaki force-reconnect (naya client) inhe wapas bind kar sake
  stateCallbacks.set(handler, cb);
  c.bind(STATE_CHANGE_EVENT, cb);
  return () => {
    stateCallbacks.delete(handler);
    client?.unbind(STATE_CHANGE_EVENT, cb);
  };
}

/* ---------- Reconnection watchdog (SDK reconnect bug ka app-level fix) ---------- */
/*
 * SDK v2.0.0 me reconnect NO-OP hai (header BUG notes): ek baar WS tootne pe
 * state hamesha 'connecting' pe stuck rehti hai. Isliye app khud health check
 * karta hai aur naya client banata hai (createClient) — naya client banane se
 * purane socket ka late onclose event naye client ko nahi bigaad sakta
 * (race-free), aur saari bindings + channel khud wapas lag jaate hain.
 */

/** Fail-streak ke hisaab se backoff: 4s → 8s → 16s → 30s cap */
function reconnectGapMs(): number {
  return Math.min(RECONNECT_MIN_GAP_MS * 2 ** Math.min(failStreak, 3), RECONNECT_MAX_GAP_MS);
}

/**
 * Force reconnect — purana client detach karke naya client (bindings + channel
 * re-subscribe + fresh connect). `checkConnectionHealth`/AppState resume se
 * call hota hai; manual retry ke liye bhi export hai.
 */
export function forceReconnect(reason: string): void {
  const old = client;
  if (!old || old.state === 'connected') return;
  const now = Date.now();
  if (now - lastReconnectAt < reconnectGapMs()) return;
  lastReconnectAt = now;
  connectingSince = now;
  failStreak += 1;
  console.warn(`[apinator][DEBUG] forceReconnect(${reason}) — state=${old.state}`);
  client = null;
  try {
    // state 'disconnected' + saare timers clear → purana client ab inert hai
    // (late onclose bhi sirf purane client ko chhuta hai)
    old.disconnect();
  } catch (err) {
    console.warn('[apinator] old client disconnect failed:', err);
  }
  if (!isKeyConfigured()) return;
  createClient();
}

/**
 * Health check (har WATCHDOG_INTERVAL_MS): connected chhod ke koi bhi state
 * CONNECTING_STUCK_MS tak tik jaaye to reconnect. Network down ho to backoff
 * ke saath chalte reho — waapas aane pe apne aap recover.
 */
function checkConnectionHealth(): void {
  const c = client;
  if (!c) return;
  const state = c.state;
  const now = Date.now();
  if (state === 'connected') {
    connectingSince = 0;
    failStreak = 0;
    return;
  }
  if (state === 'connecting') {
    if (connectingSince === 0) {
      connectingSince = now;
      return;
    }
    if (now - connectingSince >= CONNECTING_STUCK_MS) {
      forceReconnect('stuck-connecting');
    }
    return;
  }
  // initialized / disconnected / unavailable → connected nahi hai, recover karo
  forceReconnect(`state-${state}`);
}

/**
 * Background → foreground: OS ne WS band kiya ho to SDK state 'connecting' pe
 * stuck rehta hai (bug) — resume pe abhi turant recovery chahiye (interval ka
 * wait nahi, warna user ko "Connecting…" dikhta rahega).
 */
function handleAppStateChange(next: AppStateStatus): void {
  if (next !== 'active') return;
  console.log('[apinator][DEBUG] AppState → active — health check');
  if (client && client.state !== 'connected') {
    lastReconnectAt = 0; // resume pe backoff hata do — abhi turant recovery
    forceReconnect('app-resume');
  }
}

function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(checkConnectionHealth, WATCHDOG_INTERVAL_MS);
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

/**
 * SDK BUG-WORKAROUND (keep-alive): activity timer sirf connection_established
 * pe ek baar arm hota hai aur pong pe re-arm nahi hota (pong handler khaali) —
 * warna har connection activity_timeout+30s baad force-close hota hai. Hum
 * connection_established se timeout capture karte hain aur pong pe SDK ke apne
 * `resetActivityTimer()` se wapas arm karte hain. `resetActivityTimer`
 * TS-private hai — feature-detect + try/catch: SDK update me hat jaye to
 * chup-chaap skip (watchdog se phir bhi recover ho jayega).
 */
function installKeepAlive(c: Apinator): void {
  try {
    const conn = (c as unknown as { connection?: { resetActivityTimer?: (sec: number) => void } })
      .connection;
    if (!conn || typeof conn.resetActivityTimer !== 'function') return;
    c.bind('realtime:connection_established', (data: unknown) => {
      const d = (data ?? {}) as { activity_timeout?: unknown };
      if (typeof d.activity_timeout === 'number' && d.activity_timeout > 0) {
        activityTimeoutSec = d.activity_timeout;
      }
      console.log(
        '[apinator][DEBUG] connection_established — activity_timeout=',
        activityTimeoutSec,
      );
    });
    c.bind('realtime:pong', () => {
      try {
        conn.resetActivityTimer?.(activityTimeoutSec);
      } catch {
        /* best-effort — watchdog sambhal lega */
      }
    });
  } catch (err) {
    console.warn('[apinator] keep-alive install skip:', err);
  }
}

/* ---------- Channel lifecycle (room join/leave) ---------- */

/** 6-digit numeric room code (FR-5.1) — bolne/type karne me aasan */
export function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function getChannelName(code: string): string {
  return `room-${code}`;
}

export function getSubscribedCode(): string | null {
  return channelCode;
}

export function getSubscribedChannel(): Channel | null {
  return channel;
}

export function isChannelSubscribed(): boolean {
  return channel?.subscribed === true;
}

/**
 * Room channel subscribe. Room switch pe purana channel pehle clean hota hai.
 * `bind` callback me caller apne handlers lagata hai — transport ko events ki
 * jaankari nahi honi chahiye (decoupling: bind/rebind ek hi jagah rehta hai).
 */
export function subscribeChannel(code: string, bind: (channel: Channel) => void): Channel {
  const c = ensureClient();
  if (channel && channelCode === code) return channel;
  unsubscribeChannel();
  channelBinder = bind; // force-reconnect naye client pe yahi callback wapas chalayega
  const ch = c.subscribe(getChannelName(code));
  bind(ch);
  channel = ch;
  channelCode = code;
  return ch;
}

/**
 * Channel chhodo par socket zinda rakho (user dobara kisi room me join kar
 * sakta hai — reconnect turant).
 * `unbindAll()` zaroori hai warna purane callbacks channel pe pade rehte hain
 * (memory leak + doosre room ke events pe galat handler chalta).
 */
export function unsubscribeChannel(): void {
  const c = client;
  const ch = channel;
  const code = channelCode;
  channel = null;
  channelCode = null;
  channelBinder = null;
  if (!c || !ch || !code) return;
  try {
    ch.unbindAll();
    c.unsubscribe(getChannelName(code));
  } catch (err) {
    console.warn('Apinator channel cleanup failed:', err);
  }
}

/** Poora teardown (socket bhi band) — app unload / dev testing ke liye */
export function disconnectClient(): void {
  stopWatchdog();
  unsubscribeChannel();
  try {
    client?.disconnect();
  } catch (err) {
    console.warn('Apinator disconnect failed:', err);
  }
  client = null;
  connectingSince = 0;
  failStreak = 0;
}

/* ---------- Publish (server-side trigger ke through) ---------- */

/**
 * Event publish — Vercel serverless function (/api/publish) ko POST karta hai.
 * Secrets sirf server pe hote hain, isliye client se direct trigger nahi karte
 * (SDK ka `trigger` bhi sirf 'client-' prefix wale events allow karta hai, aur
 * wo doosre clients ko nahi pahunchte).
 */
export async function publishEvent(code: string, event: string, data: unknown): Promise<void> {
  if (!isPublishConfigured()) {
    throw new Error(
      'Publish URL missing. mobile/.env me EXPO_PUBLIC_PUBLISH_URL (Vercel /api/publish ka absolute URL) set karo.',
    );
  }
  await axios.post(
    PUBLISH_URL,
    { channel: getChannelName(code), event, data },
    { timeout: PUBLISH_TIMEOUT_MS },
  );
}
