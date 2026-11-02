/**
 * groupTransport.ts — group room ka SINGLE realtime transport layer (do backends):
 *
 *   1. APINATOR (jab `EXPO_PUBLIC_APINATOR_KEY` set hai) — socket subscribe +
 *      broadcast Vercel `/api/publish` trigger se (original Phase 11/12 setup).
 *   2. SUPABASE REALTIME BROADCAST (DEFAULT) — public publishable key se
 *      client-to-client broadcast (`supabase-js` channel.send). Na Vercel deploy
 *      chahiye, na Apinator account — group room BAS app open karke chalta hai.
 *      Yahi default isliye hai kyunki purane setup me publish ke liye deployed
 *      backend zaroori tha, aur bina uske room ka sync silently dead rehta tha.
 *
 * roomSync.ts isi module ke through baat karta hai (pehle `./apinator` direct
 * use karta tha). Backends ka switch YAHIN hota hai — roomSync ka orchestration
 * logic (echo guard, seq, presence) backend-agnostic rehta hai.
 *
 * WIRE FORMAT: apinator path JSON string bhejta hai (`JSON.stringify(payload)`)
 * aur supabase path wahi string `payload` field me bhejta hai — receive side
 * (`utils/syncPayload.ts` ke parse* helpers) dono handle karte hain.
 */
import { ConnectionState } from '../types';
import { isSupabaseConfigured, supabase } from '../core/auth/supabaseClient';
import {
  SUBSCRIBED_EVENT,
  SUBSCRIPTION_ERROR_EVENT,
  ensureClient as ensureApinatorClient,
  getClientState as getApinatorState,
  getSubscribedCode as getApinatorSubscribedCode,
  isChannelSubscribed as isApinatorSubscribed,
  isKeyConfigured,
  isPublishConfigured as isApinatorPublishConfigured,
  onStateChange as onApinatorStateChange,
  publishEvent as apinatorPublishEvent,
  subscribeChannel as apinatorSubscribeChannel,
  unsubscribeChannel as apinatorUnsubscribeChannel,
} from './apinator';

/** Transport mode — room UI me dikhata hai (sync kabhi chup-chaap dead na lage) */
export type TransportMode = 'apinator' | 'supabase';

/** Channel abstraction — apinator `Channel` aur supabase broadcast dono isse match karte hain */
export interface GroupChannel {
  bind(eventName: string, cb: (data: unknown) => void): void;
  readonly subscribed: boolean;
}

const APINATOR_MODE = isKeyConfigured();
export const transportMode: TransportMode = APINATOR_MODE ? 'apinator' : 'supabase';

export function getTransportMode(): TransportMode {
  return transportMode;
}

/* ---------- Supabase broadcast backend ---------- */

let sbChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let sbCode: string | null = null;
let sbSubscribed = false;
/** sbSubscribed ka last value — getClientState ise padhta hai */
let sbState: ConnectionState = 'disconnected';
const sbStateHandlers = new Set<(state: ConnectionState) => void>();

function setSbState(state: ConnectionState): void {
  sbState = state;
  sbStateHandlers.forEach(handler => {
    try {
      handler(state);
    } catch (err) {
      console.warn('[groupTransport] state handler failed:', err);
    }
  });
}

/** Subscribe status → humare ConnectionState + bind events */
function handleSubscribeStatus(
  status: string,
  errorCbs: ((data: unknown) => void)[],
  subscribedCbs: ((data: unknown) => void)[],
): void {
  if (status === 'SUBSCRIBED') {
    sbSubscribed = true;
    setSbState('connected');
    subscribedCbs.forEach(cb => {
      try {
        cb(undefined);
      } catch (err) {
        console.warn('[groupTransport] subscribed callback failed:', err);
      }
    });
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    sbSubscribed = false;
    setSbState('failed');
    errorCbs.forEach(cb => {
      try {
        cb(status);
      } catch (err) {
        console.warn('[groupTransport] subscription error callback failed:', err);
      }
    });
    return;
  }
  if (status === 'CLOSED') {
    sbSubscribed = false;
    // supabase-js khud reconnect karta hai — 'connecting' dikhao, 'failed' nahi
    setSbState(sbChannel ? 'connecting' : 'disconnected');
  }
}

function subscribeSupabase(code: string, bind: (channel: GroupChannel) => void): void {
  if (!supabase) throw new Error('Supabase config missing — group room sync unavailable');
  unsubscribeSupabase();

  const channel = supabase.channel(`room-${code}`, {
    config: {
      // self:false — apna broadcast wapas nahi aata (senderId guard bhi hai)
      broadcast: { self: false, ack: false },
    },
  });

  const subscribedCbs: ((data: unknown) => void)[] = [];
  const errorCbs: ((data: unknown) => void)[] = [];

  const adapter: GroupChannel = {
    bind(eventName: string, cb: (data: unknown) => void): void {
      if (eventName === SUBSCRIBED_EVENT) {
        subscribedCbs.push(cb);
        return;
      }
      if (eventName === SUBSCRIPTION_ERROR_EVENT) {
        errorCbs.push(cb);
        return;
      }
      // Broadcast event — payload (JSON string) seedha parser ko jaata hai
      channel.on('broadcast', { event: eventName }, (message: { payload?: unknown }) => {
        cb(message?.payload);
      });
    },
    get subscribed(): boolean {
      return sbSubscribed;
    },
  };

  bind(adapter);
  sbCode = code;
  sbChannel = channel;
  sbSubscribed = false;
  setSbState('connecting');
  channel.subscribe(status => handleSubscribeStatus(status, errorCbs, subscribedCbs));
}

function unsubscribeSupabase(): void {
  const channel = sbChannel;
  const code = sbCode;
  sbChannel = null;
  sbCode = null;
  sbSubscribed = false;
  if (!supabase || !channel || !code) return;
  try {
    void supabase.removeChannel(channel);
  } catch (err) {
    console.warn('[groupTransport] supabase channel cleanup failed:', err);
  }
}

async function publishSupabase(code: string, event: string, data: unknown): Promise<void> {
  const channel = sbChannel;
  if (!supabase || !channel || sbCode !== code) {
    throw new Error('Supabase room channel subscribed nahi hai');
  }
  const result = await channel.send({ type: 'broadcast', event, payload: data });
  if (result !== 'ok') {
    throw new Error(`Supabase broadcast fail: ${String(result)}`);
  }
}

/* ---------- Unified transport API (roomSync isi se baat karta hai) ---------- */

export { SUBSCRIBED_EVENT, SUBSCRIPTION_ERROR_EVENT };

/**
 * Transport tayyar karo. Apinator mode me socket connect hota hai; supabase
 * mode me client pehle se bana hota hai (supabaseClient.ts) — kuch nahi karna.
 * Config bilkul na ho to throw karta hai (roomSync friendly state set karta hai).
 */
export function ensureTransport(): void {
  if (APINATOR_MODE) {
    ensureApinatorClient();
    return;
  }
  if (!supabase) {
    throw new Error(
      'Group room transport unavailable — EXPO_PUBLIC_APINATOR_KEY ya EXPO_PUBLIC_SUPABASE_URL me se ek chahiye.',
    );
  }
}

export function getClientState(): ConnectionState {
  if (APINATOR_MODE) return getApinatorState();
  return sbState;
}

export function getSubscribedCode(): string | null {
  if (APINATOR_MODE) return getApinatorSubscribedCode();
  return sbCode;
}

export function isChannelSubscribed(): boolean {
  if (APINATOR_MODE) return isApinatorSubscribed();
  return sbSubscribed;
}

/**
 * Broadcast available hai? Apinator mode me deployed /api/publish chahiye;
 * supabase mode me public key kaafi hai (broadcast direct client-to-client).
 */
export function isPublishConfigured(): boolean {
  if (APINATOR_MODE) return isApinatorPublishConfigured();
  return isSupabaseConfigured();
}

export function onStateChange(handler: (state: ConnectionState) => void): () => void {
  if (APINATOR_MODE) return onApinatorStateChange(handler);
  sbStateHandlers.add(handler);
  return () => {
    sbStateHandlers.delete(handler);
  };
}

export function subscribeChannel(code: string, bind: (channel: GroupChannel) => void): void {
  if (APINATOR_MODE) {
    // apinator Channel structurally GroupChannel se match karta hai (bind +
    // subscribed) — binder dono ke liye same hai
    apinatorSubscribeChannel(code, bind as Parameters<typeof apinatorSubscribeChannel>[1]);
    return;
  }
  subscribeSupabase(code, bind);
}

export function unsubscribeChannel(): void {
  if (APINATOR_MODE) {
    apinatorUnsubscribeChannel();
    return;
  }
  unsubscribeSupabase();
}

export async function publishEvent(code: string, event: string, data: unknown): Promise<void> {
  if (APINATOR_MODE) {
    await apinatorPublishEvent(code, event, data);
    return;
  }
  await publishSupabase(code, event, data);
}
