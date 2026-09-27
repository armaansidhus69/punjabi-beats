/**
 * Room store (Zustand) — group room ka state (code, host/joined, connection,
 * members). Yahan koi Apinator/socket code nahi hai.
 *
 * REALTIME WIRING (Phase 11): `services/roomSync.ts` is store ke lifecycle
 * events sunta hai — bilkul waise hi jaise wo playerStore ke action events
 * sunta hai. Isse do faayde:
 *   1. roomStore aur roomSync ka circular import nahi banta (one-way dependency).
 *   2. Koi bhi screen sirf `createRoom()/joinRoom()/leaveRoom()` call kare —
 *      channel subscribe/unsubscribe apne aap ho jaata hai.
 *
 * Connection state ka matlab: socket/room ka status (FR-5.8). Ye roomSync
 * update karta hai (SDK ke `state_change` event se), screens sirf padhte hain.
 */
import { create } from 'zustand';
import { ConnectionState, Room, RoomMember } from '../types';
import { generateRoomCode } from '../services/apinator';
import { getRoomName, saveRoomName } from '../services/storage';

/** Room enter/leave event — roomSync ka listener isi pe channel manage karta hai */
export type RoomLifecycleEvent =
  | { type: 'entered'; code: string; isHost: boolean }
  | { type: 'left' };

let lifecycleListener: ((event: RoomLifecycleEvent) => void) | null = null;

export function setRoomLifecycleListener(
  listener: ((event: RoomLifecycleEvent) => void) | null,
): void {
  lifecycleListener = listener;
}

/** Listener fail ho to room ka local flow na ruke (playerStore.emitAction jaisa) */
function emitLifecycle(event: RoomLifecycleEvent): void {
  try {
    lifecycleListener?.(event);
  } catch (err) {
    console.warn('Room lifecycle listener failed:', err);
  }
}

/** Room code 6 digits (FR-5.1) */
const CODE_PATTERN = /^\d{6}$/;

/** Default display name (FR-5.11) — user Room tab se badal sakta hai */
function defaultGuestName(): string {
  return `Guest-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** `Room` (types/index.ts) extend — code/isHost/members wahin define hain */
interface RoomStore extends Room {
  /** 5 states: initialized | connecting | connected | disconnected | failed */
  connectionState: ConnectionState;
  /** sync/join error message (UI pe dikhta hai) */
  error: string | null;
  /** FR-5.11 — join time pe announce hone wala naam (AsyncStorage me persist) */
  name: string;
  /** Naya 6-digit code banao aur room enter karo (code return — screens navigate karte hain) */
  createRoom: () => string;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  /** Naam badlo (Room tab ka input) + AsyncStorage me persist */
  setName: (name: string) => void;
  /** Saved naam AsyncStorage se laao (Room tab mount pe ek baar) */
  hydrateName: () => Promise<void>;
  /* roomSync ke liye setters (UI direct use nahi karta) */
  setConnectionState: (state: ConnectionState) => void;
  setError: (error: string | null) => void;
  setMembers: (members: RoomMember[]) => void;
}

export const useRoom = create<RoomStore>()((set, get) => ({
  code: null,
  isHost: false,
  connectionState: 'initialized',
  error: null,
  members: [],
  name: defaultGuestName(),

  createRoom: () => {
    const code = generateRoomCode();
    set({ code, isHost: true, error: null, members: [], connectionState: 'connecting' });
    emitLifecycle({ type: 'entered', code, isHost: true });
    return code;
  },

  joinRoom: code => {
    const clean = code.trim();
    if (!CODE_PATTERN.test(clean)) {
      throw new Error('Room code 6 digits ka hona chahiye');
    }
    // Host apne hi room me hai → dobara join nahi (warna host badge ud jaata hai)
    if (get().code === clean && get().isHost) return;
    set({ code: clean, isHost: false, error: null, members: [], connectionState: 'connecting' });
    emitLifecycle({ type: 'entered', code: clean, isHost: false });
  },

  leaveRoom: () => {
    if (!get().code) return; // idempotent (screen unmount pe dobara call hota hai)
    set({ code: null, isHost: false, members: [], error: null });
    emitLifecycle({ type: 'left' });
  },

  setName: name => {
    const clean = name.slice(0, 20);
    set({ name: clean });
    void saveRoomName(clean); // persist — next session me bhi wahi naam rahe
  },

  hydrateName: async () => {
    const saved = await getRoomName();
    if (saved && saved !== get().name) set({ name: saved });
  },

  setConnectionState: state => {
    if (state !== get().connectionState) set({ connectionState: state });
  },

  setError: error => {
    if (error !== get().error) set({ error });
  },

  setMembers: members => {
    set({ members });
  },
}));
