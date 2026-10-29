/**
 * Jam service (Phase 11) — Supabase boundary for Jam + Listening Party.
 * Har control mutation `room-control` Edge Function se hota hai
 * (server-authoritative). Client direct writes sirf: fn_join_room RPC,
 * self-leave via function, own chat insert. Apinator/roomSync ko HAATH nahi.
 */

import type {
  JamMember,
  JamMessage,
  JamPlaybackState,
  JamQueueItem,
  JamRoom,
  JamTrack,
  RoomRole,
  RoomStatus,
  RoomType,
  Song,
} from '../types';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { getCurrentUser } from '../core/auth/authService';
import { isSupabaseConfigured, supabase } from '../core/auth/supabaseClient';

export const JAM_MEMBER_CAP_JAM = 8;
export const JAM_MEMBER_CAP_PARTY = 100;
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type JamErrorCode =
  | 'not_configured'
  | 'feature_disabled'
  | 'not_authenticated'
  | 'not_found'
  | 'room_full'
  | 'room_invalid_or_closed'
  | 'duplicate_pending'
  | 'not_permitted'
  | 'unknown';

export class JamServiceError extends Error {
  readonly code: JamErrorCode;
  readonly detail?: unknown;

  constructor(code: JamErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'JamServiceError';
    this.code = code;
    this.detail = detail;
  }
}

/* ---------- row shapes (snake_case REST) ---------- */

interface RoomRow {
  id: string;
  owner_id: string;
  type: RoomType;
  title: string;
  cover_url: string | null;
  visibility: 'private_invite' | 'public';
  invite_code: string;
  max_participants: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: RoomStatus;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
  joined_at: string;
  last_seen_at: string;
  muted_until: string | null;
}

interface StateRow {
  room_id: string;
  track_id: string | null;
  track: JamTrack | null;
  position_ms: number;
  is_playing: boolean;
  queue_version: number;
  state_version: number;
  updated_by: string | null;
  updated_at: string;
}

interface QueueRow {
  id: string;
  room_id: string;
  track_id: string;
  track: JamTrack;
  added_by: string | null;
  position: number;
  played_at: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  room_id: string;
  user_id: string | null;
  kind: 'chat' | 'reaction_log' | 'system';
  body: string;
  track_id: string | null;
  reply_to_id: string | null;
  created_at: string;
}

/* ---------- mappers ---------- */

function mapRoom(row: RoomRow): JamRoom {
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    title: row.title,
    coverUrl: row.cover_url,
    visibility: row.visibility,
    inviteCode: row.invite_code,
    maxParticipants: row.max_participants,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow, displayName: string | null, avatarUrl: string | null): JamMember {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    mutedUntil: row.muted_until,
    displayName,
    avatarUrl,
  };
}

function mapState(row: StateRow): JamPlaybackState {
  return {
    roomId: row.room_id,
    trackId: row.track_id,
    track: row.track,
    positionMs: row.position_ms,
    isPlaying: row.is_playing,
    queueVersion: row.queue_version,
    stateVersion: row.state_version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapQueueItem(row: QueueRow): JamQueueItem {
  return {
    id: row.id,
    roomId: row.room_id,
    trackId: row.track_id,
    track: row.track,
    addedBy: row.added_by,
    position: row.position,
    playedAt: row.played_at,
    createdAt: row.created_at,
  };
}

function mapMessage(row: MessageRow): JamMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    kind: row.kind,
    body: row.body,
    trackId: row.track_id,
    replyToId: row.reply_to_id,
    createdAt: row.created_at,
  };
}

/* ---------- guards ---------- */

function requireEnabled(): void {
  if (!isFeatureEnabled('jam_enabled')) {
    throw new JamServiceError('feature_disabled', 'Jam feature is disabled.');
  }
}

function requireClient() {
  requireEnabled();
  if (!supabase || !isSupabaseConfigured()) {
    throw new JamServiceError('not_configured', 'Supabase is not configured (guest mode).');
  }
  return supabase;
}

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new JamServiceError('not_authenticated', 'Jam requires a signed-in account.');
  return user.id;
}

function mapPgError(error: { message?: string }): JamErrorCode {
  const msg = error?.message ?? '';
  if (msg.includes('room_member_cap_reached')) return 'room_full';
  if (msg.includes('room_invalid_or_closed')) return 'room_invalid_or_closed';
  if (msg.includes('not_authenticated')) return 'not_authenticated';
  return 'unknown';
}

function mapToServiceError(error: { message?: string }, context: string): JamServiceError {
  return new JamServiceError('unknown', `${context}: failed`, error);
}

/* ---------- helpers ---------- */

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Song → denormalized JamTrack (playable-only pre-check caller karta hai) */
export function songToJamTrack(song: Song): JamTrack {
  return {
    title: song.title,
    artistNames: song.artist.split(',').map(part => part.trim()).filter(Boolean),
    artworkUrl: song.cover,
    provider: song.source ?? 'jiosaavn',
    durationSec: Math.round(song.duration / 1000),
    playableFull: !song.previewOnly,
  };
}

/* ---------- API ---------- */

export interface CreateRoomInput {
  title: string;
  type: RoomType;
  visibility: 'private_invite' | 'public';
  coverUrl?: string | null;
}

export async function createRoom(input: CreateRoomInput): Promise<JamRoom> {
  const client = requireClient();
  const userId = await requireUserId();
  const title = input.title.trim();
  if (title.length === 0 || title.length > 80) {
    throw new JamServiceError('unknown', 'Room title 1–80 chars hona chahiye.');
  }

  const maxParticipants = input.type === 'jam' ? JAM_MEMBER_CAP_JAM : JAM_MEMBER_CAP_PARTY;

  let created: RoomRow | null = null;
  for (let attempt = 0; attempt < 3 && created === null; attempt++) {
    const { data, error } = await client
      .from('rooms')
      .insert({
        owner_id: userId,
        type: input.type,
        title,
        cover_url: input.coverUrl ?? null,
        visibility: input.visibility,
        invite_code: generateInviteCode(),
        max_participants: maxParticipants,
      })
      .select('*')
      .single<RoomRow>();
    if (error) {
      if (error.code === '23505') continue; // invite_code collision → retry
      throw mapToServiceError(error, 'room create');
    }
    created = data;
  }
  if (!created) throw new JamServiceError('unknown', 'Invite code collision (retry).');

  // owner member row + initial playback state row (state authority seed)
  const [memberResult, stateResult] = await Promise.all([
    client.from('room_members').insert({
      room_id: created.id,
      user_id: userId,
      role: 'owner',
    }),
    client.from('room_playback_state').upsert(
      { room_id: created.id, state_version: 1, queue_version: 0 },
      { onConflict: 'room_id' },
    ),
  ]);
  if (memberResult.error) throw mapToServiceError(memberResult.error, 'owner member insert');
  if (stateResult.error) throw mapToServiceError(stateResult.error, 'playback state seed');

  return mapRoom(created);
}

export interface JamRoomDetail {
  room: JamRoom;
  members: JamMember[];
  playback: JamPlaybackState | null;
  queue: JamQueueItem[];
  messages: JamMessage[];
}

export async function getRoom(roomId: string): Promise<JamRoomDetail> {
  const client = requireClient();
  await requireUserId();

  const [roomRes, memberRes, stateRes, queueRes, messageRes] = await Promise.all([
    client.from('rooms').select('*').eq('id', roomId).maybeSingle<RoomRow>(),
    client
      .from('room_members')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true }),
    client.from('room_playback_state').select('*').eq('room_id', roomId).maybeSingle<StateRow>(),
    client
      .from('room_queue_items')
      .select('*')
      .eq('room_id', roomId)
      .is('played_at', null)
      .order('position', { ascending: true }),
    client
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (roomRes.error) throw mapToServiceError(roomRes.error, 'room read');
  if (!roomRes.data) throw new JamServiceError('not_found', 'Room not found.');
  if (memberRes.error) throw mapToServiceError(memberRes.error, 'members read');
  if (stateRes.error) throw mapToServiceError(stateRes.error, 'state read');
  if (queueRes.error) throw mapToServiceError(queueRes.error, 'queue read');
  if (messageRes.error) throw mapToServiceError(messageRes.error, 'messages read');

  const rawMembers = (memberRes.data ?? []) as MemberRow[];
  const memberUserIds = rawMembers.map(row => row.user_id);

  // profiles postgrest cross-embed nahi hota — plain in() query (Blend pattern)
  const profileRes = memberUserIds.length
    ? await client.from('profiles').select('id, display_name, avatar_url').in('id', memberUserIds)
    : { data: [], error: null as { message?: string } | null };
  if (profileRes.error) throw mapToServiceError(profileRes.error, 'profiles read');

  const profilesById = new Map(
    ((profileRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map(p => [p.id, p]),
  );

  return {
    room: mapRoom(roomRes.data as RoomRow),
    members: rawMembers.map(row =>
      mapMember(row, profilesById.get(row.user_id)?.display_name ?? null, profilesById.get(row.user_id)?.avatar_url ?? null),
    ),
    playback: stateRes.data ? mapState(stateRes.data as StateRow) : null,
    queue: ((queueRes.data ?? []) as QueueRow[]).map(mapQueueItem),
    messages: ((messageRes.data ?? []) as MessageRow[]).map(mapMessage).reverse(), // oldest→newest render
  };
}

/** Join via fn_join_room RPC (atomic cap + validity, migration me) */
export async function joinByInviteCode(inviteCode: string): Promise<string> {
  const client = requireClient();
  await requireUserId();
  const code = inviteCode.trim();
  if (!/^[A-Z2-9]{8}$/i.test(code)) {
    throw new JamServiceError('room_invalid_or_closed', 'Code format galat hai.');
  }
  const { data, error } = await client.rpc('fn_join_room', { p_invite_code: code });
  if (error) throw new JamServiceError(mapPgError(error), 'Join failed.', error);
  return data as string;
}

export async function listMyRooms(): Promise<JamRoom[]> {
  const client = requireClient();
  const userId = await requireUserId();
  const { data: membershipRows, error: membershipError } = await client
    .from('room_members')
    .select('room_id')
    .eq('user_id', userId);
  if (membershipError) throw mapToServiceError(membershipError, 'memberships read');
  const roomIds = ((membershipRows ?? []) as { room_id: string }[]).map(row => row.room_id);
  if (roomIds.length === 0) return [];
  const { data: roomRows, error: roomError } = await client
    .from('rooms')
    .select('*')
    .in('id', roomIds)
    .order('updated_at', { ascending: false });
  if (roomError) throw mapToServiceError(roomError, 'rooms read');
  return ((roomRows ?? []) as RoomRow[]).map(mapRoom);
}

/* ---------- room-control bridge ---------- */

export interface ControlPayload {
  roomId: string;
  inviteCode?: string;
  trackId?: string;
  track?: JamTrack;
  itemId?: string;
  order?: string[];
  positionMs?: number;
  targetUserId?: string;
  targetRole?: Exclude<RoomRole, 'owner' | 'listener'>;
  durationMs?: number;
}

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

export interface ControlResult {
  stateVersion?: number;
  queueVersion?: number;
  promoted?: string;
  closed?: boolean;
  role?: RoomRole;
}

/** room-control invoke — error messages ko app codes me translate karo */
export async function controlRoom(action: ControlAction, payload: ControlPayload): Promise<ControlResult> {
  const client = requireClient();
  await requireUserId();
  const { data, error } = await client.functions.invoke('room-control', {
    body: { action, ...payload },
  });
  if (error) {
    const fnError = error as { message?: string };
    const msg = fnError?.message ?? '';
    if (msg.includes('not_permitted')) throw new JamServiceError('not_permitted', 'Ish action ke liye role nahi hai.', error);
    if (msg.includes('duplicate_pending')) throw new JamServiceError('duplicate_pending', 'Track pehle se queue me hai.', error);
    if (msg.includes('room_member_cap_reached')) throw new JamServiceError('room_full', 'Room full hai.', error);
    throw new JamServiceError('unknown', `room-control ${action} failed.`, error);
  }
  return (data ?? {}) as ControlResult;
}

export async function rotateInvite(roomId: string, _unused?: never): Promise<string> {
  void _unused; void roomId;
  // v1: room invites expire NAHI hote (spec me invite_expiry sirf blends ke
  // liye tha) — rotation = naya code same room pe later add karenge.
  // rooms UPDATE client policy nahi hai (owner bhi nahi likh sakta direct)
  // — isliye ye later room-control action banega; abhi honest failure:
  throw new JamServiceError('unknown', 'Invite rotation v1 me support nahi hai.');
}

/* ---------- chat (client fast path — RLS inserts allow) ---------- */

export async function sendChatMessage(roomId: string, body: string, replyToId?: string): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const text = body.trim();
  if (text.length === 0 || text.length > 500) {
    throw new JamServiceError('unknown', 'Message 1–500 chars hona chahiye.');
  }
  const { error } = await client.from('room_messages').insert({
    room_id: roomId,
    user_id: userId,
    kind: 'chat',
    body: text,
    reply_to_id: replyToId ?? null,
  });
  if (error) throw mapToServiceError(error, 'chat send');
}

export async function sendReactionLog(roomId: string, emoji: string): Promise<void> {
  // reaction_log DB me history ke liye; ephemeral broadcast jamRealtime me
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client.from('room_messages').insert({
    room_id: roomId,
    user_id: userId,
    kind: 'reaction_log',
    body: emoji.slice(0, 500),
  });
  if (error) throw mapToServiceError(error, 'reaction send');
}

/* ---------- share helpers (messenger-safe, Blend jaisa) ---------- */

export function jamInviteDeepLink(inviteCode: string): string {
  return `punjabi-beats://jam/join?code=${inviteCode}`;
}

export function jamShareText(roomTitle: string, inviteCode: string, type: RoomType): string {
  const label = type === 'jam' ? 'Jam' : 'Listening Party';
  return `${roomTitle} — Punjabi Beats ${label} party shuru! 🎧 Code: ${inviteCode} ya link: ${jamInviteDeepLink(inviteCode)}`;
}
