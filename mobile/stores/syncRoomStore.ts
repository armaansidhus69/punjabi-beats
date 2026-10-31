/**
 * SyncRoom Store (Zustand)
 * Manages live group listening state, personal pause/catch-up, and host transport controls.
 */
import { create } from 'zustand';
import type {
  LiveRoomSnapshot,
  PersonalState,
  SyncStatus,
  AddToQueueInput,
  CreateRoomInput,
} from '../types/syncroom';
import * as SyncRoomService from '../services/syncRoomService';
import { getIdealPositionMs, shouldResync, createAnchor } from '../core/syncEngine';

interface SyncRoomStore {
  snapshot: LiveRoomSnapshot | null;
  personal: PersonalState;
  isHydrating: boolean;
  error: string | null;

  createRoom: (input: CreateRoomInput) => Promise<string>;
  joinRoom: (inviteCode: string) => Promise<string>;
  leaveRoom: () => Promise<void>;
  endRoom: () => Promise<void>;

  setPersonalPaused: (paused: boolean) => void;
  setVolume: (v: number) => void;
  rejoinLive: () => void;

  addToQueue: (input: AddToQueueInput) => Promise<void>;
  voteSkip: () => Promise<void>;
  hostPlayPause: () => Promise<void>;
  hostSkip: () => Promise<void>;

  applyServerSnapshot: (snap: LiveRoomSnapshot) => void;
  tickPlayer: (localPositionMs: number) => { seekTo?: number; status: SyncStatus };

  reset: () => void;
}

const initialPersonal: PersonalState = {
  isPausedForMe: false,
  volume: 1,
  localStatus: 'connecting',
};

export const useSyncRoomStore = create<SyncRoomStore>((set, get) => ({
  snapshot: null,
  personal: { ...initialPersonal },
  isHydrating: false,
  error: null,

  createRoom: async (input) => {
    set({ isHydrating: true, error: null });
    try {
      const roomId = await SyncRoomService.createRoom(input);
      const snap = await SyncRoomService.fetchSnapshot(roomId);
      set({ snapshot: snap, isHydrating: false, personal: { ...initialPersonal, localStatus: 'ready' } });
      SyncRoomService.subscribe(roomId, (s) => get().applyServerSnapshot(s));
      return roomId;
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to create sync room';
      set({ error: msg, isHydrating: false });
      throw e;
    }
  },

  joinRoom: async (code) => {
    set({ isHydrating: true, error: null });
    try {
      const roomId = await SyncRoomService.joinRoom(code);
      const snap = await SyncRoomService.fetchSnapshot(roomId);
      set({ snapshot: snap, isHydrating: false, personal: { ...initialPersonal, localStatus: 'preparing' } });
      SyncRoomService.subscribe(roomId, (s) => get().applyServerSnapshot(s));
      return roomId;
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to join sync room';
      set({ error: msg, isHydrating: false });
      throw e;
    }
  },

  leaveRoom: async () => {
    const id = get().snapshot?.room.roomId;
    if (id) {
      try {
        await SyncRoomService.leaveRoom(id);
      } catch {
        /* ignore leave network error */
      }
    }
    get().reset();
  },

  endRoom: async () => {
    const id = get().snapshot?.room.roomId;
    if (id) {
      try {
        await SyncRoomService.endRoom(id);
      } catch {
        /* ignore end network error */
      }
    }
    get().reset();
  },

  setPersonalPaused: (paused) => {
    set((s) => ({
      personal: {
        ...s.personal,
        isPausedForMe: paused,
        localStatus: paused ? 'paused_for_you' : 'catching_up',
      },
    }));
  },

  setVolume: (v) =>
    set((s) => ({
      personal: { ...s.personal, volume: Math.max(0, Math.min(1, v)) },
    })),

  rejoinLive: () => {
    set((s) => ({
      personal: {
        ...s.personal,
        isPausedForMe: false,
        localStatus: 'catching_up',
        lastResyncAt: undefined,
      },
    }));
  },

  addToQueue: async (input) => {
    const roomId = get().snapshot?.room.roomId;
    if (!roomId) return;
    await SyncRoomService.addToQueue(roomId, input);
  },

  voteSkip: async () => {
    const roomId = get().snapshot?.room.roomId;
    const trackId = get().snapshot?.playback.trackId;
    if (!roomId || !trackId) return;
    await SyncRoomService.voteSkip(roomId, trackId);
  },

  hostPlayPause: async () => {
    const snap = get().snapshot;
    if (!snap) return;
    const nextStatus = snap.playback.status === 'playing' ? 'paused' : 'playing';
    const ideal = getIdealPositionMs(snap.playback);
    const anchor = createAnchor(
      snap.playback.trackId,
      ideal,
      nextStatus,
      snap.playback.stateVersion
    );
    await SyncRoomService.updatePlayback(snap.room.roomId, anchor);
  },

  hostSkip: async () => {
    const roomId = get().snapshot?.room.roomId;
    if (!roomId) return;
    await SyncRoomService.skipToNext(roomId);
  },

  applyServerSnapshot: (snap) => {
    set({ snapshot: snap });
  },

  tickPlayer: (localPositionMs) => {
    const { snapshot, personal } = get();
    if (!snapshot || personal.isPausedForMe) {
      return { status: personal.isPausedForMe ? 'paused_for_you' : personal.localStatus };
    }

    const ideal = getIdealPositionMs(snapshot.playback);
    const needs = shouldResync(ideal, localPositionMs, personal.lastResyncAt);

    if (needs) {
      set((s) => ({
        personal: { ...s.personal, localStatus: 'catching_up', lastResyncAt: Date.now() },
      }));
      return { seekTo: ideal, status: 'catching_up' };
    }

    const status: SyncStatus = snapshot.playback.status === 'playing' ? 'synced' : 'ready';
    if (personal.localStatus !== status) {
      set((s) => ({ personal: { ...s.personal, localStatus: status } }));
    }
    return { status };
  },

  reset: () => {
    SyncRoomService.unsubscribe();
    set({ snapshot: null, personal: { ...initialPersonal }, error: null, isHydrating: false });
  },
}));

