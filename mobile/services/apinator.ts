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
 * - SDK khud reconnect karta hai: max 6 attempts, delay 1s → 2s → 4s … 30s cap,
 *   phir state `unavailable`. Reconnect ke baad SDK saare channels ko khud
 *   dobara subscribe karta hai (handleStateChange me loop hai) — isliye
 *   haath se re-subscribe karne ki zaroorat nahi.
 * - Global event name se `client.bind('state_change', cb)` bhi possible hai
 *   (globalBindings har message pe check hoti hai) — hum wahi use karte hain.
 */
import axios from 'axios';
import { Apinator, Channel } from '@apinator/client';
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
 * Client banao + connect karo (idempotent). Config missing ho to throw —
 * caller (roomSync.initRoomSync) isko catch karke friendly state set karta hai,
 * app crash nahi hota.
 */
export function ensureClient(): Apinator {
  if (client) return client;
  if (!isKeyConfigured()) throw new Error(configHint());
  client = new Apinator({ appKey: APP_KEY, cluster: CLUSTER });
  client.connect();
  return client;
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
    const data = (payload ?? {}) as { current?: string };
    handler(toConnectionState(data.current));
  };
  c.bind(STATE_CHANGE_EVENT, cb);
  return () => c.unbind(STATE_CHANGE_EVENT, cb);
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
  unsubscribeChannel();
  try {
    client?.disconnect();
  } catch (err) {
    console.warn('Apinator disconnect failed:', err);
  }
  client = null;
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
