/**
 * Jam store (Phase 11) — zustand: rooms list + active room + realtime apply
 * + player glue. Server-authoritative: playback/queue mutations yahin se
 * controlRoom (Edge Function) ke through — direct table writes nahi. Local
 * player sirf server state follow karta hai (versioning core/room/versioning.ts).
 */

import { create } from 'zustand';
import type {
  JamMember,
  JamMessage,
  JamPlaybackState,
  JamQueueItem,
  JamRoom,
  RoomRole,
  Song,
} from '../types';
import { getCurrentUser } from '../core/auth/authService';
import {
  JamServiceError,
  controlRoom,
  createRoom,
  getRoom,
  joinByInviteCode,
  listMyRooms,
  sendChatMessage as sendChatMessageService,
  sendReactionLog as sendReactionLogService,
  songToJamTrack,
  type ControlResult,
  type CreateRoomInput,
} from '../services/jamService';
import { sendEphemeral, subscribeJamChanges } from '../services/jamRealtime';
import { can, canModerateMember } from '../core/room/permissions';
import { captureClockSkew, HEARTBEAT_INTERVAL_MS, serverNow } from '../core/room/timeModel';
import { shouldApply, stampFromRow, type VersionStamp } from '../core/room/versioning';
import { jamQueueItemToSong, playbackToSong } from '../core/room/song';
import { usePlayer } from './playerStore';

/** room member role assign karne layak targets (owner/listener excluded) */
export type AssignableRole = Exclude<RoomRole, 'owner' | 'listener'>;

interface JamStore {
  rooms: JamRoom[];
  roomsLoading: boolean;
  loadRooms: () => Promise<void>;

  activeRoom: JamRoom | null;
  activeMembers: JamMember[];
  /** pending queue (played_at null), position asc */
  activeQueue: JamQueueItem[];
  activeMessages: JamMessage[];
  myRole: RoomRole | null;
  /** last fresh server playback row (as-received) */
  serverPlayback: JamPlaybackState | null;
  /** monotonic apply gate state */
  lastApplied: VersionStamp | null;
  /** server clock − device clock, ms (first sync pe capture) */
  clockSkewMs: number;
  loading: boolean;
  detailError: string | null;

  openRoom: (roomId: string) => Promise<void>;
  closeActive: () => void;
  refreshActive: () => Promise<void>;

  createRoomAndOpen: (input: CreateRoomInput) => Promise<JamRoom>;
  joinWithCode: (code: string) => Promise<string>;
  leaveActive: () => Promise<void>;

  queueAddSong: (song: Song) => Promise<void>;
  queueRemoveItem: (item: JamQueueItem) => Promise<void>;
  queueReorder: (orderedIds: string[]) => Promise<void>;

  /** control roles only — can() gates UI + server dono */
  jamPlay: (positionMs?: number) => Promise<void>;
  jamPause: (positionMs?: number) => Promise<void>;
  jamSeek: (positionMs: number) => Promise<void>;
  jamNext: () => Promise<void>;

  muteMember: (userId: string, durationMs?: number) => Promise<void>;
  unmuteMember: (userId: string) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  assignRole: (userId: string, targetRole: AssignableRole) => Promise<void>;

  sendChatMessage: (body: string, replyToId?: string) => Promise<void>;
  sendReaction: (emoji: string) => Promise<void>;
  closeRoom: () => Promise<void>;
}

/** presence heartbeat — active room me chalta rehta hai (module-local) */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Local player ko server playback state pe le aao (version-gate ke BAAD hi
 * yahan aata hai). Track change → playSong(queue se); playing/pause flip →
 * existing toggle paths ({ remote: true } — Apinator echo guard respects).
 */
function followServerPlayback(playback: JamPlaybackState): void {
  const player = usePlayer.getState();
  const resolve = playbackToSong(playback);

  if (!resolve) {
    if (player.currentSong !== null) void player.pause({ remote: true });
    return;
  }

  const sameTrack = player.currentSong?.id === resolve.song.id;
  if (!sameTrack) {
    const queue: Song[] = useJam.getState().activeQueue.map(jamQueueItemToSong);
    void player.playSong(resolve.song, queue, {
      initialPosition: resolve.positionMs,
      startPaused: !playback.isPlaying,
      remote: true,
    });
    return;
  }

  if (playback.isPlaying && !player.isPlaying) {
    void player.togglePlay({ remote: true });
  } else if (!playback.isPlaying && player.isPlaying) {
    void player.pause({ remote: true });
  }
}

/** control write ka authoritative version — local gate pointer turant aage */
function adoptControlVersion(set: (partial: Partial<JamStore>) => void, result: ControlResult): void {
  if (typeof result.stateVersion === 'number') {
    set({
      lastApplied: {
        stateVersion: result.stateVersion,
        queueVersion: result.queueVersion ?? 0,
      },
    });
  }
}

export const useJam = create<JamStore>()((set, get) => ({
  rooms: [],
  roomsLoading: false,

  activeRoom: null,
  activeMembers: [],
  activeQueue: [],
  activeMessages: [],
  myRole: null,
  serverPlayback: null,
  lastApplied: null,
  clockSkewMs: 0,
  loading: false,
  detailError: null,

  loadRooms: async () => {
    set({ roomsLoading: true });
    try {
      set({ rooms: await listMyRooms() });
    } catch (err) {
      console.warn('Jam rooms load failed:', err);
      set({ rooms: [] });
    } finally {
      set({ roomsLoading: false });
    }
  },

  openRoom: async roomId => {
    set({ loading: true, detailError: null });
    try {
      const detail = await getRoom(roomId);
      // realtime — koi bhi room data change → refresh (version-gate andar)
      subscribeJamChanges(roomId, kind => {
        void kind;
        void useJam.getState().refreshActive();
      });
      heartbeatTimer = setInterval(() => {
        const state = useJam.getState();
        if (!state.activeRoom) return;
        void controlRoom('heartbeat', { roomId: state.activeRoom.id }).catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);

      const me = await getCurrentUser().then(user => user?.id ?? null);
      set({
        activeRoom: detail.room,
        activeMembers: detail.members,
        activeQueue: detail.queue,
        activeMessages: detail.messages,
        myRole: detail.members.find(member => member.userId === me)?.role ?? null,
      });
      applyServerState(set, detail.playback);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Room open failed';
      console.warn('Jam open failed:', err);
      set({ activeRoom: null, detailError: message });
    } finally {
      set({ loading: false });
    }
  },

  closeActive: () => {
    stopHeartbeat();
    set({
      activeRoom: null,
      activeMembers: [],
      activeQueue: [],
      activeMessages: [],
      myRole: null,
      serverPlayback: null,
      lastApplied: null,
      clockSkewMs: 0,
      detailError: null,
    });
  },

  refreshActive: async () => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    try {
      const detail = await getRoom(roomId);
      const me = await getCurrentUser().then(user => user?.id ?? null);
      set({
        activeRoom: detail.room,
        activeMembers: detail.members,
        activeQueue: detail.queue,
        activeMessages: detail.messages,
        myRole: detail.members.find(member => member.userId === me)?.role ?? null,
      });
      applyServerState(set, detail.playback);
      // room band/expired → heartbeat band (screen bhi roz auto-kick)
      if (detail.room.status !== 'active') stopHeartbeat();
    } catch (err) {
      console.warn('Jam refresh failed:', err);
    }
  },

  createRoomAndOpen: async input => {
    const room = await createRoom(input);
    await get().loadRooms();
    return room;
  },

  joinWithCode: async code => {
    const roomId = await joinByInviteCode(code);
    await get().loadRooms();
    return roomId;
  },

  leaveActive: async () => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    // owner leave → server promotion/-close logic karta hai (spec)
    await controlRoom('leave', { roomId });
    get().closeActive();
    await get().loadRooms().catch(() => undefined);
  },

  queueAddSong: async song => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    if (song.previewOnly) {
      throw new JamServiceError('unknown', 'Preview-only track queue me add nahi hota.');
    }
    const result = await controlRoom('queue_add', {
      roomId,
      trackId: song.id,
      track: songToJamTrack(song),
    });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  queueRemoveItem: async item => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    const result = await controlRoom('queue_remove', { roomId, itemId: item.id });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  queueReorder: async orderedIds => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    const result = await controlRoom('queue_reorder', { roomId, order: orderedIds });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  jamPlay: async positionMs => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    const result = await controlRoom('playback_play', { roomId, positionMs });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  jamPause: async positionMs => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    // local predicted position freeze — server pe baseline ban jata hai
    const localPositionMs = positionMs ?? usePlayer.getState().position;
    const result = await controlRoom('playback_pause', { roomId, positionMs: localPositionMs });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  jamSeek: async positionMs => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    const result = await controlRoom('playback_seek', { roomId, positionMs });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  jamNext: async () => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    const result = await controlRoom('playback_next', { roomId });
    adoptControlVersion(set, result);
    await get().refreshActive();
  },

  muteMember: async (userId, durationMs) => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    await controlRoom('member_mute', { roomId, targetUserId: userId, durationMs });
    await get().refreshActive();
  },

  unmuteMember: async userId => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    await controlRoom('member_unmute', { roomId, targetUserId: userId });
    await get().refreshActive();
  },

  removeMember: async userId => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    await controlRoom('member_remove', { roomId, targetUserId: userId });
    await get().refreshActive();
  },

  assignRole: async (userId, targetRole) => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    await controlRoom('role_assign', { roomId, targetUserId: userId, targetRole });
    await get().refreshActive();
  },

  sendChatMessage: async (body, replyToId) => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    // RLS mute-gate server-side hai (muted_until insert policy check)
    await sendChatMessageService(roomId, body, replyToId);
  },

  sendReaction: async emoji => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    sendEphemeral(roomId, 'reaction', { emoji });
    await sendReactionLogService(roomId, emoji).catch(() => undefined);
  },

  closeRoom: async () => {
    const roomId = get().activeRoom?.id;
    if (!roomId) return;
    await controlRoom('close_room', { roomId });
    await get().refreshActive();
  },
}));

/* ---------- internals ---------- */

type SetFn = (partial: Partial<JamStore>) => void;

/**
 * Central playback apply gate — fresh row (store refresh ya realtime se)
 * → shouldApply decide → apply ho to clock skew capture + player glue.
 * Duplicate/old versions idempotent ignore hote hain.
 */
function applyServerState(set: SetFn, playback: JamPlaybackState | null): void {
  if (!playback) return;
  const state = useJam.getState();
  const incoming = stampFromRow(playback as unknown as { state_version?: number; queue_version?: number });
  if (shouldApply(incoming, state.lastApplied) !== 'apply') return;

  // clock skew first sync pe capture; baad me stable rakhte hain
  const skew = state.clockSkewMs === 0
    ? captureClockSkew(playback.updatedAt, Date.now())
    : state.clockSkewMs;
  set({ lastApplied: incoming, clockSkewMs: skew, serverPlayback: playback });

  // smooth-correction tween timeModel se aata hai; v1 glue = hard follow
  void serverNow(Date.now(), skew);
  followServerPlayback(playback);
}

/** UI convenience re-exports (screens yahin se karein) */
export { can, canModerateMember as canModerate };
export function canControlPlayback(role: RoomRole | null, roomType: JamRoom['type']): boolean {
  if (!role) return false;
  return can(role, 'playback_control', roomType);
}
