/**
 * SyncRoom Types (Fair-Turns Realtime Group Listening)
 */

export type SyncStatus =
  | 'connecting'
  | 'preparing'
  | 'ready'
  | 'synced'
  | 'catching_up'
  | 'paused_for_you'
  | 'reconnecting'
  | 'cannot_play'
  | 'left';

export type PlaybackStatus = 'playing' | 'paused' | 'ended';

export type RoomPrivacy = 'invite_only' | 'approval_required';

export type QueueMode = 'fair_turns'; // MVP: fair_turns; later: 'open' | 'voting'

export interface SyncRoomMember {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'host' | 'cohost' | 'member';
  status: SyncStatus;
  isReady: boolean;
  lastSeenAt: string; // ISO
  deviceId?: string;
}

export interface QueueItem {
  id: string; // uuid
  trackId: string; // catalog id or external
  title: string;
  artist: string;
  albumArt?: string | null;
  durationMs: number;
  addedBy: string; // userId
  addedByName: string;
  position: number; // fair-turn order
  createdAt: string;
}

export interface RoomState {
  roomId: string;
  name: string;
  privacy: RoomPrivacy;
  queueMode: QueueMode;
  hostId: string;
  cohostIds: string[];
  maxMembers: number; // 2..32
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  inviteCode?: string;
}

export interface PlaybackAnchor {
  trackId: string | null;
  status: PlaybackStatus;
  /** Position in ms at the moment of anchorServerTime */
  anchorPositionMs: number;
  /** Server epoch ms — clients compute current pos from this */
  anchorServerTime: number;
  stateVersion: number; // monotonic, for idempotency
}

export interface LiveRoomSnapshot {
  room: RoomState;
  members: SyncRoomMember[];
  queue: QueueItem[];
  playback: PlaybackAnchor;
  currentItemId: string | null; // queue item currently playing
}

export interface PersonalState {
  isPausedForMe: boolean;
  volume: number; // 0–1
  localStatus: SyncStatus;
  lastResyncAt?: number;
}

/** Wire payloads (realtime + API) */
export type SyncRoomEvent =
  | { type: 'ROOM_UPDATED'; payload: Partial<RoomState>; version: number }
  | { type: 'MEMBERS_UPDATED'; payload: SyncRoomMember[] }
  | { type: 'QUEUE_UPDATED'; payload: QueueItem[]; revision: number }
  | { type: 'PLAYBACK_UPDATED'; payload: PlaybackAnchor }
  | { type: 'MEMBER_STATUS'; payload: { userId: string; status: SyncStatus } }
  | { type: 'SKIP_VOTE'; payload: { trackId: string; voterId: string; votes: number; needed: number } }
  | { type: 'HOST_HANDOVER'; payload: { newHostId: string; previousHostId: string } }
  | { type: 'ERROR'; payload: { code: string; message: string } };

export interface CreateRoomInput {
  name: string;
  privacy?: RoomPrivacy;
  maxMembers?: number;
  initialTrackIds?: string[];
}

export interface AddToQueueInput {
  trackId: string;
  title: string;
  artist: string;
  albumArt?: string;
  durationMs: number;
}

