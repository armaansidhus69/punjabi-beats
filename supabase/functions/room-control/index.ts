// supabase/functions/room-control/index.ts — Phase 11 Jam + Listening Party.
//
// Har authorized mutation yahan se hota hai (client RLS pe sirf reads +
// own chat + self-leave + fn_join_room RPC). Service role writes + version
// bumps. Role matrix mirror: _shared/room-permissions.ts (client copy
// mobile/core/room/permissions.ts — test-jam.mjs drift guard).
//
// Deadline semantics: state_version EVERY playback/queue write pe +1;
// queue-only change pe queue_version bhi +1. Heartbeat: no bump.
//
// Deploy: supabase functions deploy room-control (CLI + access token).
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  can,
  type RoomControlAction,
  type RoomRole,
  type RoomType,
} from '../_shared/room-permissions.ts';

/* ------------------------------ actions ------------------------------ */

type ControlAction =
  | 'join'
  | 'leave'
  | 'queue_add'
  | 'queue_remove'
  | 'queue_reorder'
  | 'playback_play'
  | 'playback_pause'
  | 'playback_seek'
  | 'playback_track_change'
  | 'playback_next'
  | 'member_mute'
  | 'member_unmute'
  | 'member_remove'
  | 'role_assign'
  | 'heartbeat'
  | 'close_room';

interface JamTrackJson {
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: string;
  durationSec: number;
  playableFull: boolean;
}

interface ActionBody {
  action?: ControlAction;
  roomId?: string;
  inviteCode?: string;
  trackId?: string;
  track?: JamTrackJson;
  position?: number; // reorder target / queue item ke liye
  positionMs?: number; // playback seek/play start
  targetUserId?: string;
  targetRole?: Exclude<RoomRole, 'owner' | 'listener'>; // co_host | moderator | participant
  durationMs?: number; // mute duration (default 10min)
  itemId?: string; // queue_remove uuid (ya trackId fallback)
  order?: string[]; // queue_reorder: pending item ids in new order
}

interface RoomRow {
  id: string;
  owner_id: string;
  type: RoomType;
  status: RoomStatus;
  max_participants: number;
}

type RoomStatus = 'active' | 'paused' | 'closed' | 'expired';

interface MemberRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
  joined_at: string;
  muted_until: string | null;
}

interface StateRow {
  room_id: string;
  track_id: string | null;
  track: JamTrackJson | null;
  position_ms: number;
  is_playing: boolean;
  queue_version: number;
  state_version: number;
}

interface QueueItemRow {
  id: string;
  room_id: string;
  track_id: string;
  track: JamTrackJson;
  added_by: string | null;
  position: number;
  played_at: string | null;
}

/* ------------------------------ clients ------------------------------ */

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------ plumbing ------------------------------ */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function authenticate(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

interface RoomContext {
  room: RoomRow;
  members: MemberRow[];
  callerRole: RoomRole;
  state: StateRow | null;
}

async function loadContext(roomId: string, caller: string): Promise<RoomContext | { error: string }> {
  const { data: room, error: roomError } = await service
    .from('rooms')
    .select('id, owner_id, type, status, max_participants')
    .eq('id', roomId)
    .maybeSingle<RoomRow>();
  if (roomError) return { error: 'room_read_failed' };
  if (!room) return { error: 'room_not_found' };

  const { data: memberRows, error: membersError } = await service
    .from('room_members')
    .select('room_id, user_id, role, joined_at, muted_until')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (membersError) return { error: 'members_read_failed' };
  const members = (memberRows ?? []) as MemberRow[];

  const callerMember = members.find(member => member.user_id === caller);
  // owner_id account-bound hai — member row missing ho to bhi caller owner
  // hosakta hai (re-join recovery); warna role nahi milta
  const callerRole: RoomRole = room.owner_id === caller ? 'owner' : callerMember?.role ?? 'listener';

  const { data: stateRow } = await service
    .from('room_playback_state')
    .select('room_id, track_id, track, position_ms, is_playing, queue_version, state_version')
    .eq('room_id', roomId)
    .maybeSingle<StateRow>();

  return { room, members, callerRole, state: stateRow ?? null };
}

function deny(action: RoomControlAction, ctx: RoomContext, roomType: RoomType, isOwn = false): Response | null {
  const allowed = can(ctx.callerRole, action, roomType);
  if (allowed) return null;
  // queue_remove: participant apna item room_type-appropriate hide karta hai
  if (action === 'queue_remove' && isOwn && can(ctx.callerRole, 'queue_remove_own', roomType)) {
    return null;
  }
  return json(403, { error: 'not_permitted', action });
}

/** Version bump writes — state_version ALWAYS +1; queueFlag pe queue_version +1 */
async function bumpState(
  roomId: string,
  patch: Partial<StateRow> & { track?: JamTrackJson | null },
  queueFlag: boolean,
  updatedBy: string,
): Promise<StateRow | { error: string }> {
  const current = (await service
    .from('room_playback_state')
    .select('state_version, queue_version')
    .eq('room_id', roomId)
    .maybeSingle<{ state_version: number; queue_version: number }>()).data;

  const nextVersion = (current?.state_version ?? 0) + 1;
  const nextQueue = queueFlag ? (current?.queue_version ?? 0) + 1 : (current?.queue_version ?? 0);

  const write = {
    ...patch,
    state_version: nextVersion,
    queue_version: nextQueue,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await service
    .from('room_playback_state')
    .upsert({ room_id: roomId, ...write }, { onConflict: 'room_id' })
    .select('*')
    .single<StateRow>();
  if (error) return { error: 'state_write_failed' };
  return data as StateRow;
}

/* ------------------------------ actions ------------------------------ */

async function handleJoin(caller: string, inviteCode: string): Promise<Response> {
  // Ek hi implementation: fn_join_room RPC (atomic cap + validity + role
  // default). Function door client reconnect flows ke liye bhi.
  const { data, error } = await service.rpc('fn_join_room', { p_invite_code: inviteCode });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('room_member_cap_reached')) return json(409, { error: 'room_member_cap_reached' });
    if (msg.includes('room_invalid_or_closed')) return json(404, { error: 'room_invalid_or_closed' });
    return json(500, { error: 'join_failed' });
  }
  const roomId = data as string;
  // state row ensure (khali room me pehla touch)
  await service.from('room_playback_state').upsert(
    { room_id: roomId, state_version: 1, queue_version: 0 },
    { onConflict: 'room_id' },
  );
  const { data: member } = await service
    .from('room_members')
    .select('role')
    .eq('room_id', roomId)
    .eq('user_id', caller)
    .maybeSingle<{ role: RoomRole }>();
  return json(200, { status: 'ok', roomId, role: member?.role ?? 'listener' });
}

async function handleLeave(ctx: RoomContext, caller: string): Promise<Response> {
  // Owner leave → promotion (earliest-joined co_host) ya cascade delete
  if (ctx.room.owner_id === caller) {
    const coHost = ctx.members.find(member => member.role === 'co_host');
    if (coHost) {
      await service.from('rooms').update({ owner_id: coHost.user_id }).eq('id', ctx.room.id);
      await service.from('room_members').update({ role: 'owner' }).eq('room_id', ctx.room.id).eq('user_id', coHost.user_id);
      await service.from('room_members').delete().eq('room_id', ctx.room.id).eq('user_id', caller);
      return json(200, { status: 'left', promoted: coHost.user_id });
    }
    // koi co_host nahi — room cascade (schema on-delete-cascade sab wipe)
    await service.from('rooms').delete().eq('id', ctx.room.id);
    return json(200, { status: 'left', closed: true });
  }
  await service.from('room_members').delete().eq('room_id', ctx.room.id).eq('user_id', caller);
  return json(200, { status: 'left' });
}

async function handleQueueAdd(
  ctx: RoomContext,
  caller: string,
  trackId: string | undefined,
  track: JamTrackJson | undefined,
): Promise<Response> {
  if (!trackId || !track || !track.playableFull) {
    return json(400, { error: 'track_invalid' });
  }

  // Pending-duplicate invariant (server-side enforce — table pe no unique):
  // same track_id already pending ho to reject (spec).
  const { data: existingPending } = await service
    .from('room_queue_items')
    .select('id')
    .eq('room_id', ctx.room.id)
    .eq('track_id', trackId)
    .is('played_at', null)
    .maybeSingle<{ id: string }>();
  if (existingPending) return json(409, { error: 'duplicate_pending' });

  // position = current max pending position + 1 (gaps allowed)
  const { data: pending } = await service
    .from('room_queue_items')
    .select('position')
    .eq('room_id', ctx.room.id)
    .is('played_at', null)
    .order('position', { ascending: false })
    .limit(1);
  const nextPosition = (((pending ?? []) as { position: number }[])[0]?.position ?? -1) + 1;

  const { data: inserted, error } = await service
    .from('room_queue_items')
    .insert({
      room_id: ctx.room.id,
      track_id: trackId,
      track,
      added_by: caller,
      position: nextPosition,
    })
    .select('*')
    .single<QueueItemRow>();
  if (error || !inserted) return json(500, { error: 'queue_insert_failed' });

  // state bump: state row absent (pehla add) → track set karke create;
  // present + empty track → track set; warna queue_version-only bump
  const result = await bumpState(
    ctx.room.id,
    ctx.state?.track_id
      ? {}
      : { track_id: inserted.track_id, track: inserted.track, position_ms: 0, is_playing: false },
    true,
    caller,
  );
  if ('error' in result && result.error !== 'state_write_failed') {
    return json(500, { error: result.error });
  }
  return json(200, { status: 'ok', item: inserted });
}

async function handleQueueRemove(
  ctx: RoomContext,
  caller: string,
  itemId: string | undefined,
  trackId: string | undefined,
): Promise<Response> {
  let target: QueueItemRow | null = null;
  if (itemId) {
    const { data } = await service
      .from('room_queue_items')
      .select('*')
      .eq('room_id', ctx.room.id)
      .eq('id', itemId)
      .maybeSingle<QueueItemRow>();
    target = data ?? null;
  } else if (trackId) {
    const { data } = await service
      .from('room_queue_items')
      .select('*')
      .eq('room_id', ctx.room.id)
      .eq('track_id', trackId)
      .is('played_at', null)
      .maybeSingle<QueueItemRow>();
    target = data ?? null;
  }
  if (!target) return json(404, { error: 'queue_item_not_found' });

  // own-item removal: participant (jam) bhi allowed — caller match check
  const isOwn = target.added_by === caller;
  if (!can(ctx.callerRole, 'queue_remove_any', ctx.room.type) && !isOwn) {
    return json(403, { error: 'not_permitted' });
  }

  const { error } = await service.from('room_queue_items').delete().eq('id', target.id);
  if (error) return json(500, { error: 'queue_delete_failed' });
  await bumpState(ctx.room.id, {}, true, caller);
  return json(200, { status: 'ok' });
}

async function handleQueueReorder(
  ctx: RoomContext,
  caller: string,
  order: string[] | undefined,
): Promise<Response> {
  if (!order || order.length === 0) return json(400, { error: 'order_required' });

  // pending items ko sequential positions 0..N-1 do (order array gapped items
  // ko compact karta hai — spec: gaps allowed, removals se bante hain)
  let position = 0;
  for (const itemId of order) {
    const { error } = await service
      .from('room_queue_items')
      .update({ position: position++ })
      .eq('id', itemId)
      .eq('room_id', ctx.room.id)
      .is('played_at', null);
    if (error) return json(500, { error: 'queue_reorder_failed' });
  }
  await bumpState(ctx.room.id, {}, true, caller);
  return json(200, { status: 'ok' });
}

/** Queue advance helper — next pending item (lowest position) consume karo */
async function advanceQueue(ctx: RoomContext, caller: string, force = false): Promise<Response> {
  const { data: pendingRows } = await service
    .from('room_queue_items')
    .select('*')
    .eq('room_id', ctx.room.id)
    .is('played_at', null)
    .order('position', { ascending: true })
    .limit(1);
  const pending = ((pendingRows ?? []) as QueueItemRow[])[0] ?? null;

  if (!pending) {
    // queue khaali — playback stop + default state
    await bumpState(ctx.room.id, { track_id: null, track: null, position_ms: 0, is_playing: false }, true, caller);
    return json(200, { status: 'ok', queueEmpty: true });
  }

  const { error: consumeError } = await service
    .from('room_queue_items')
    .update({ played_at: new Date().toISOString() })
    .eq('id', pending.id);
  if (consumeError) return json(500, { error: 'queue_consume_failed' });

  await bumpState(
    ctx.room.id,
    { track_id: pending.track_id, track: pending.track, position_ms: 0, is_playing: true },
    true,
    caller,
  );
  return json(200, { status: 'ok', trackId: pending.track_id });
}

async function handlePlayback(
  action: ControlAction,
  ctx: RoomContext,
  caller: string,
  body: ActionBody,
): Promise<Response> {
  const current = ctx.state ?? { track_id: null, track: null, position_ms: 0, is_playing: false };
  const positionMs = body.positionMs;

  switch (action) {
    case 'playback_play': {
      const start = Math.max(0, positionMs ?? current.position_ms);
      const result = await bumpState(
        ctx.room.id,
        { position_ms: start, is_playing: true },
        false,
        caller,
      );
      if ('error' in result) return json(500, { error: result.error });
      return json(200, { status: 'ok', state: result });
    }
    case 'playback_pause': {
      // pause pe aaj ki predicted position freeze hoti hai (caller estimate)
      const frozen = Math.max(0, positionMs ?? current.position_ms);
      const result = await bumpState(
        ctx.room.id,
        { position_ms: frozen, is_playing: false },
        false,
        caller,
      );
      if ('error' in result) return json(500, { error: result.error });
      return json(200, { status: 'ok', state: result });
    }
    case 'playback_seek': {
      const seekTo = Math.max(0, positionMs ?? 0);
      const result = await bumpState(ctx.room.id, { position_ms: seekTo }, false, caller);
      if ('error' in result) return json(500, { error: result.error });
      return json(200, { status: 'ok', state: result });
    }
    case 'playback_track_change': {
      // direct track pick (queue consume NAHI hota — manual override)
      if (!body.trackId || !body.track) return json(400, { error: 'track_required' });
      const result = await bumpState(
        ctx.room.id,
        {
          track_id: body.trackId,
          track: body.track,
          position_ms: Math.max(0, positionMs ?? 0),
          is_playing: true,
        },
        false,
        caller,
      );
      if ('error' in result) return json(500, { error: result.error });
      return json(200, { status: 'ok', state: result });
    }
    case 'playback_next':
      return advanceQueue(ctx, caller);
    default:
      return json(400, { error: 'unknown_playback_action' });
  }
}

async function handleMemberModeration(
  action: ControlAction,
  ctx: RoomContext,
  caller: string,
  targetUserId: string | undefined,
  durationMs: number | undefined,
): Promise<Response> {
  if (!targetUserId) return json(400, { error: 'targetUserId_required' });
  const target = ctx.members.find(member => member.user_id === targetUserId);
  if (!target) return json(404, { error: 'member_not_found' });
  if (target.user_id === ctx.room.owner_id) {
    return json(403, { error: 'owner_immutable' });
  }

  if (action === 'member_mute') {
    const duration = Math.max(10_000, durationMs ?? 600_000); // min 10s, default 10min
    const { error } = await service
      .from('room_members')
      .update({ muted_until: new Date(Date.now() + duration).toISOString() })
      .eq('room_id', ctx.room.id)
      .eq('user_id', targetUserId);
    if (error) return json(500, { error: 'mute_write_failed' });
    return json(200, { status: 'ok' });
  }

  if (action === 'member_unmute') {
    const { error } = await service
      .from('room_members')
      .update({ muted_until: null })
      .eq('room_id', ctx.room.id)
      .eq('user_id', targetUserId);
    if (error) return json(500, { error: 'unmute_write_failed' });
    return json(200, { status: 'ok' });
  }

  // member_remove
  if (caller === targetUserId) return json(400, { error: 'self_remove_use_leave' });
  const { error } = await service
    .from('room_members')
    .delete()
    .eq('room_id', ctx.room.id)
    .eq('user_id', targetUserId);
  if (error) return json(500, { error: 'remove_write_failed' });
  return json(200, { status: 'ok' });
}

async function handleRoleAssign(
  ctx: RoomContext,
  targetUserId: string | undefined,
  targetRole: RoomRole | undefined,
): Promise<Response> {
  if (!targetUserId || !targetRole) return json(400, { error: 'target_required' });
  if (targetRole === 'owner') return json(403, { error: 'owner_transfer_not_supported' });
  // owner khud ko demote nahi kar sakta (room orphan nahi ban sakta)
  if (targetUserId === ctx.room.owner_id) return json(403, { error: 'owner_immutable' });

  const { error } = await service
    .from('room_members')
    .update({ role: targetRole })
    .eq('room_id', ctx.room.id)
    .eq('user_id', targetUserId);
  if (error) return json(500, { error: 'role_write_failed' });
  return json(200, { status: 'ok' });
}

async function handleHeartbeat(ctx: RoomContext, caller: string): Promise<Response> {
  const { error } = await service
    .from('room_members')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('room_id', ctx.room.id)
    .eq('user_id', caller);
  if (error) return json(500, { error: 'heartbeat_write_failed' });
  return json(200, { status: 'ok' });
}

async function handleClose(ctx: RoomContext, caller: string): Promise<Response> {
  const { error } = await service
    .from('rooms')
    .update({ status: 'closed' })
    .eq('id', ctx.room.id);
  if (error) return json(500, { error: 'close_write_failed' });
  return json(200, { status: 'closed' });
}

/* ------------------------------ entry ------------------------------ */

Deno.serve(async req => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

  const caller = await authenticate(req);
  if (!caller) return json(401, { error: 'not_authenticated' });

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const action = body.action;
  if (!action) return json(400, { error: 'action_required' });

  // join invite-code se hota hai (roomId optional)
  if (action === 'join') {
    if (!body.inviteCode) return json(400, { error: 'inviteCode_required' });
    try {
      return await handleJoin(caller, body.inviteCode);
    } catch (err) {
      console.error('room-control join error:', err);
      return json(500, { error: 'unexpected' });
    }
  }

  const roomId = body.roomId;
  if (!roomId) return json(400, { error: 'roomId_required' });

  try {
    const context = await loadContext(roomId, caller);
    if ('error' in context) return json(404, { error: context.error });
    const ctx = context;

    // membership gate (owner_id account-bound; members me hona chahiye)
    const isMember = ctx.members.some(member => member.user_id === caller) || ctx.room.owner_id === caller;
    if (!isMember) return json(403, { error: 'not_a_member' });

    // active-room gate (heartbeat/leave bhi closed room me allow hai —
    // cleanup/ban/removal flows)
    const requiresActive = action !== 'heartbeat' && action !== 'leave' && action !== 'close_room';
    if (requiresActive && ctx.room.status !== 'active') {
      return json(409, { error: 'room_not_active' });
    }

    // RBAC: action → RoomControlAction mapping
    let permissionAction: RoomControlAction | null = null;
    switch (action) {
      case 'leave':
      case 'heartbeat':
      case 'playback_play':
      case 'playback_pause':
      case 'playback_seek':
      case 'playback_track_change':
      case 'playback_next':
        permissionAction = action === 'leave' || action === 'heartbeat' ? null : 'playback_control';
        break;
      case 'queue_add':
        permissionAction = 'queue_add';
        break;
      case 'queue_remove':
        permissionAction = 'queue_remove'; // own-item nuance handler me
        break;
      case 'queue_reorder':
        permissionAction = 'queue_reorder';
        break;
      case 'member_mute':
      case 'member_unmute':
        permissionAction = 'member_mute';
        break;
      case 'member_remove':
        permissionAction = 'member_remove';
        break;
      case 'role_assign':
        permissionAction = 'role_assign';
        break;
      case 'close_room':
        permissionAction = 'close_room';
        break;
      default:
        return json(400, { error: 'unknown_action' });
    }

    if (permissionAction !== null && action !== 'queue_remove') {
      // queue_remove ka own-item nuance handler ke andar check hota hai
      const gateDenied = deny(permissionAction, ctx, ctx.room.type);
      if (gateDenied) return gateDenied;
    }

    switch (action) {
      case 'leave':
        return await handleLeave(ctx, caller);
      case 'queue_add':
        return await handleQueueAdd(ctx, caller, body.trackId, body.track);
      case 'queue_remove':
        return await handleQueueRemove(ctx, caller, body.itemId, body.trackId);
      case 'queue_reorder':
        return await handleQueueReorder(ctx, caller, body.order);
      case 'playback_play':
      case 'playback_pause':
      case 'playback_seek':
        return await handlePlayback(action, ctx, caller, body);
      case 'playback_track_change':
        return await handlePlayback(action, ctx, caller, body);
      case 'playback_next':
        return await handlePlayback('playback_next', ctx, caller, body);
      case 'member_mute':
        return await handleMemberModeration('member_mute', ctx, caller, body.targetUserId, body.durationMs);
      case 'member_unmute':
        return await handleMemberModeration('member_unmute', ctx, caller, body.targetUserId, undefined);
      case 'member_remove':
        return await handleMemberModeration('member_remove', ctx, caller, body.targetUserId, undefined);
      case 'role_assign':
        return await handleRoleAssign(ctx, body.targetUserId, body.targetRole);
      case 'heartbeat':
        return await handleHeartbeat(ctx, caller);
      case 'close_room':
        return await handleClose(ctx, caller);
      default:
        return json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('room-control unexpected error:', err);
    return json(500, { error: 'unexpected', detail: err instanceof Error ? err.message : 'unknown' });
  }
});
