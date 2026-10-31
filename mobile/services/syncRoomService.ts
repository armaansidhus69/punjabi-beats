/**
 * SyncRoom Service Layer
 * Interacts with Supabase Postgres Realtime, RPCs, and state synchronization.
 */
import { supabase } from '../core/auth/supabaseClient';
import type {
  LiveRoomSnapshot,
  CreateRoomInput,
  AddToQueueInput,
  PlaybackAnchor,
  QueueItem,
  SyncRoomMember,
  RoomState,
} from '../types/syncroom';
import { buildFairOrder } from '../core/syncEngine';

let channel: any = null;

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase client is not configured. Check EXPO_PUBLIC_SUPABASE_URL and keys.');
  }
  return supabase;
}

function mapRoom(row: any): RoomState {
  return {
    roomId: row.id,
    name: row.name,
    privacy: row.privacy,
    queueMode: row.queue_mode,
    hostId: row.host_id,
    cohostIds: row.cohost_ids ?? [],
    maxMembers: row.max_members,
    isLocked: Boolean(row.is_locked),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inviteCode: row.invite_code,
  };
}

export async function createRoom(input: CreateRoomInput): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_sync_room', {
    p_name: input.name,
    p_privacy: input.privacy ?? 'invite_only',
    p_max_members: input.maxMembers ?? 10,
  });
  if (error) throw error;
  return data as string;
}

export async function joinRoom(inviteCode: string): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('join_sync_room', {
    p_invite_code: inviteCode.trim().toUpperCase(),
  });
  if (error) throw error;
  return data as string;
}

export async function fetchSnapshot(roomId: string): Promise<LiveRoomSnapshot> {
  const sb = requireSupabase();
  const [roomRes, membersRes, queueRes, playbackRes] = await Promise.all([
    sb.from('sync_rooms').select('*').eq('id', roomId).single(),
    sb.from('sync_room_members').select('*').eq('room_id', roomId),
    sb.from('sync_room_queue').select('*').eq('room_id', roomId).order('position'),
    sb.from('sync_room_playback').select('*').eq('room_id', roomId).single(),
  ]);

  if (roomRes.error) throw roomRes.error;

  const members: SyncRoomMember[] = (membersRes.data ?? []).map((m: any) => ({
    userId: m.user_id,
    displayName: m.display_name ?? 'User',
    avatarUrl: m.avatar_url ?? null,
    role: m.role,
    status: m.status,
    isReady: Boolean(m.is_ready),
    lastSeenAt: m.last_seen_at,
    deviceId: m.device_id,
  }));

  const queue: QueueItem[] = (queueRes.data ?? []).map((q: any) => ({
    id: q.id,
    trackId: q.track_id,
    title: q.title,
    artist: q.artist,
    albumArt: q.album_art,
    durationMs: q.duration_ms,
    addedBy: q.added_by,
    addedByName: '',
    position: q.position,
    createdAt: q.created_at,
  }));

  const fairQueue = buildFairOrder(queue);

  const pb = playbackRes.data;
  const playback: PlaybackAnchor = {
    trackId: pb?.track_id ?? null,
    status: pb?.status ?? 'paused',
    anchorPositionMs: pb?.anchor_position_ms ?? 0,
    anchorServerTime: pb ? new Date(pb.anchor_server_time).getTime() : Date.now(),
    stateVersion: Number(pb?.state_version ?? 1),
  };

  return {
    room: mapRoom(roomRes.data),
    members,
    queue: fairQueue.length ? fairQueue : queue,
    playback,
    currentItemId: pb?.current_item_id ?? null,
  };
}

export async function addToQueue(roomId: string, input: AddToQueueInput): Promise<void> {
  const sb = requireSupabase();
  const user = (await sb.auth.getUser()).data.user;
  if (!user) throw new Error('User not authenticated');

  const { data: pos } = await sb.rpc('next_fair_queue_position', {
    p_room_id: roomId,
    p_user_id: user.id,
  });

  const { error } = await sb.from('sync_room_queue').insert({
    room_id: roomId,
    track_id: input.trackId,
    title: input.title,
    artist: input.artist,
    album_art: input.albumArt ?? null,
    duration_ms: input.durationMs,
    added_by: user.id,
    position: pos ?? 1,
  });
  if (error) throw error;
}

export async function updatePlayback(roomId: string, anchor: PlaybackAnchor): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('sync_room_playback')
    .update({
      track_id: anchor.trackId,
      status: anchor.status,
      anchor_position_ms: anchor.anchorPositionMs,
      anchor_server_time: new Date(anchor.anchorServerTime).toISOString(),
      state_version: anchor.stateVersion,
    })
    .eq('room_id', roomId);
  if (error) throw error;
}

export async function voteSkip(roomId: string, trackId: string): Promise<void> {
  const sb = requireSupabase();
  const user = (await sb.auth.getUser()).data.user;
  if (!user) throw new Error('User not authenticated');

  await sb.from('sync_room_skip_votes').upsert({
    room_id: roomId,
    track_id: trackId,
    voter_id: user.id,
  });
}

export async function skipToNext(roomId: string): Promise<void> {
  const sb = requireSupabase();
  const snap = await fetchSnapshot(roomId);
  const idx = snap.queue.findIndex((q) => q.id === snap.currentItemId);
  const next = snap.queue[idx + 1] ?? snap.queue[0];
  if (!next) return;

  const anchor = {
    trackId: next.trackId,
    status: 'playing' as const,
    anchorPositionMs: 0,
    anchorServerTime: Date.now(),
    stateVersion: snap.playback.stateVersion + 1,
  };

  await sb
    .from('sync_room_playback')
    .update({
      track_id: next.trackId,
      current_item_id: next.id,
      status: 'playing',
      anchor_position_ms: 0,
      anchor_server_time: new Date().toISOString(),
      state_version: anchor.stateVersion,
    })
    .eq('room_id', roomId);

  await sb.from('sync_room_skip_votes').delete().eq('room_id', roomId);
}

export async function leaveRoom(roomId: string): Promise<void> {
  const sb = requireSupabase();
  const user = (await sb.auth.getUser()).data.user;
  if (!user) return;
  await sb.from('sync_room_members').delete().eq('room_id', roomId).eq('user_id', user.id);
}

export async function endRoom(roomId: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('sync_rooms').delete().eq('id', roomId);
}

export function subscribe(roomId: string, onSnap: (s: LiveRoomSnapshot) => void): void {
  unsubscribe();
  if (!supabase) return;

  channel = supabase
    .channel(`syncroom:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_room_playback', filter: `room_id=eq.${roomId}` },
      async () => {
        try {
          onSnap(await fetchSnapshot(roomId));
        } catch {
          /* ignore transient fetch error */
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_room_queue', filter: `room_id=eq.${roomId}` },
      async () => {
        try {
          onSnap(await fetchSnapshot(roomId));
        } catch {
          /* ignore transient fetch error */
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_room_members', filter: `room_id=eq.${roomId}` },
      async () => {
        try {
          onSnap(await fetchSnapshot(roomId));
        } catch {
          /* ignore transient fetch error */
        }
      }
    )
    .subscribe();
}

export function unsubscribe(): void {
  if (channel && supabase) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

