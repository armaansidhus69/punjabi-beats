/**
 * Blend service (Phase 10) — Supabase-boundary for blends.
 * ALL direct Supabase calls for blends is module me hain — UI/store isko
 * use karte hain, client kabhi Saddhi bland tables pe query nahi karta.
 *
 * Honest limits (spec):
 *  - Guest-safe: Supabase unconfigured ho to sab calls `not_configured`
 *    error dete hain, feature flag + login upsell pehle hi rok dete hain.
 *  - blend_items pe client writes nahi — add/remove/compute Edge Function
 *    se hote hain (service role RLS bypass karta hai).
 */

import type {
  Blend,
  BlendComputeStatus,
  BlendItem,
  BlendMember,
  BlendMemberRole,
  BlendTrack,
  BlendVisibility,
  Song,
  TasteSnapshot,
} from '../types';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { getCurrentUser } from '../core/auth/authService';
import { isSupabaseConfigured, supabase } from '../core/auth/supabaseClient';
import { BLEND_ALGORITHM_VERSION } from '../core/blend/scoring';

export const BLEND_MEMBER_CAP = 10;
export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // I/L/0/1 skip (confusion-proof)

export type BlendErrorCode =
  | 'not_configured'
  | 'feature_disabled'
  | 'not_authenticated'
  | 'not_found'
  | 'member_cap_reached'
  | 'invite_invalid_or_expired'
  | 'snapshots_pending'
  | 'invalid_input'
  | 'unknown';

export class BlendServiceError extends Error {
  readonly code: BlendErrorCode;
  readonly detail?: unknown;

  constructor(code: BlendErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'BlendServiceError';
    this.code = code;
    this.detail = detail;
  }
}

/* ---------- DB row shapes (snake_case, Supabase REST) ---------- */

interface BlendRow {
  id: string;
  owner_id: string;
  name: string;
  cover_url: string | null;
  visibility: BlendVisibility;
  invite_code: string;
  invite_expires_at: string;
  algorithm_version: string;
  compute_status: BlendComputeStatus;
  last_computed_at: string | null;
  library_hashes: unknown;
  created_at: string;
  updated_at: string;
}

interface BlendMemberRow {
  blend_id: string;
  user_id: string;
  role: BlendMemberRole;
  joined_at: string;
}

interface BlendItemRow {
  id: string;
  blend_id: string;
  track_id: string;
  source_user_id: string | null;
  score: number;
  position: number;
  track: BlendTrack;
  origin: 'generated' | 'member';
  created_at: string;
}

/* ---------- mappers (camelCase app types jaise types/index.ts me hain) ---------- */

function mapBlend(row: BlendRow): Blend {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    coverUrl: row.cover_url,
    visibility: row.visibility,
    inviteCode: row.invite_code,
    inviteExpiresAt: row.invite_expires_at,
    algorithmVersion: row.algorithm_version,
    computeStatus: row.compute_status,
    lastComputedAt: row.last_computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: BlendMemberRow, displayName: string | null, avatarUrl: string | null): BlendMember {
  return {
    blendId: row.blend_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    displayName,
    avatarUrl,
  };
}

function mapItem(row: BlendItemRow): BlendItem {
  return {
    id: row.id,
    blendId: row.blend_id,
    trackId: row.track_id,
    sourceUserId: row.source_user_id,
    score: Number(row.score),
    position: row.position,
    track: row.track,
    origin: row.origin,
    createdAt: row.created_at,
  };
}

/* ---------- guards ---------- */

function requireEnabled(): void {
  if (!isFeatureEnabled('blend_enabled')) {
    throw new BlendServiceError('feature_disabled', 'Blend feature is disabled.');
  }
}

function requireClient() {
  requireEnabled();
  if (!supabase || !isSupabaseConfigured()) {
    throw new BlendServiceError('not_configured', 'Supabase is not configured (guest mode).');
  }
  return supabase;
}

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) {
    throw new BlendServiceError('not_authenticated', 'Blend requires a signed-in account.');
  }
  return user.id;
}

/** Postgres-side errors ko app codes me map karo (fn_join_blend ka contract) */
function mapPgError(err: { message?: string; code?: string }): BlendErrorCode {
  const msg = err?.message ?? '';
  if (msg.includes('blend_member_cap_reached')) return 'member_cap_reached';
  if (msg.includes('invite_invalid_or_expired')) return 'invite_invalid_or_expired';
  if (msg.includes('not_authenticated')) return 'not_authenticated';
  if (err?.code === 'PGRST116' || msg.includes('No rows')) return 'not_found';
  return 'unknown';
}

/* ---------- invite code ---------- */

/**
 * 8-char code, confusion-proof alphabet. Math.random (crypto-strength
 * nahi chahiye — brute-force already: 31^8 space + cap + owner rotate).
 */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export function inviteExpiresDaysFromNow(): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + INVITE_EXPIRY_DAYS);
  return expiry.toISOString();
}

/* ---------- API ---------- */

export async function listMyBlends(): Promise<Blend[]> {
  const client = requireClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from('blends')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw mapToServiceError(error, 'blends list');

  const rows = (data ?? []) as BlendRow[];
  const memberRows = await listMyBlendMemberships(userId);
  const memberBlendIds = new Set(memberRows.map(row => row.blend_id));
  // RLS hi sirf member blends dega; double-check ownership anyway (safe)
  return rows.filter(row => memberBlendIds.has(row.id) || row.visibility === 'public').map(mapBlend);
}

async function listMyBlendMemberships(userId: string): Promise<BlendMemberRow[]> {
  const client = requireClient();
  const { data, error } = await client.from('blend_members').select('*').eq('user_id', userId);
  if (error) throw mapToServiceError(error, 'memberships list');
  return (data ?? []) as BlendMemberRow[];
}

export interface CreateBlendInput {
  name: string;
  visibility: BlendVisibility;
  coverUrl?: string | null;
}

export async function createBlend(input: CreateBlendInput): Promise<Blend> {
  const client = requireClient();
  const userId = await requireUserId();
  const name = input.name.trim();
  if (name.length === 0 || name.length > 60) {
    throw new BlendServiceError('invalid_input', 'Blend name 1–60 chars hona chahiye.');
  }

  let created: Blend | null = null;
  // invite_code unique hai — collision retry (3 attempts enough)
  for (let attempt = 0; attempt < 3 && created === null; attempt++) {
    const inviteCode = generateInviteCode();
    const { data, error } = await client
      .from('blends')
      .insert({
        owner_id: userId,
        name,
        cover_url: input.coverUrl ?? null,
        visibility: input.visibility,
        invite_code: inviteCode,
        invite_expires_at: inviteExpiresDaysFromNow(),
        algorithm_version: BLEND_ALGORITHM_VERSION,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') continue; // duplicate invite_code → retry
      throw mapToServiceError(error, 'blend create');
    }
    created = mapBlend(data as BlendRow);
  }
  if (!created) throw new BlendServiceError('invalid_input', 'Invite code collision (retry).');

  const { error: memberError } = await client.from('blend_members').insert({
    blend_id: created.id,
    user_id: userId,
    role: 'owner',
  });
  if (memberError) throw mapToServiceError(memberError, 'owner member insert');
  return created;
}

export async function getBlend(blendId: string): Promise<{ blend: Blend; members: BlendMember[]; items: BlendItem[] }> {
  const client = requireClient();
  await requireUserId();

  const [{ data: blendRow, error: blendError }, { data: memberRows, error: memberError }, { data: itemRows, error: itemError }] =
    await Promise.all([
      client.from('blends').select('*').eq('id', blendId).maybeSingle(),
      client
        .from('blend_members')
        .select('*')
        .eq('blend_id', blendId)
        .order('joined_at', { ascending: true }),
      client.from('blend_items').select('*').eq('blend_id', blendId).order('position', { ascending: true }),
    ]);

  if (blendError) throw mapToServiceError(blendError, 'blend read');
  if (!blendRow) throw new BlendServiceError('not_found', 'Blend not found.');
  if (memberError) throw mapToServiceError(memberError, 'members read');
  if (itemError) throw mapToServiceError(itemError, 'items read');

  // profiles embed cross-schema FK se nahi hota — plain in() query
  const rawMembers = (memberRows ?? []) as BlendMemberRow[];
  const memberUserIds = rawMembers.map(row => row.user_id);
  const profileRows = memberUserIds.length
    ? await client.from('profiles').select('id, display_name, avatar_url').in('id', memberUserIds)
    : { data: [], error: null };
  if (profileRows.error) throw mapToServiceError(profileRows.error, 'profiles read');
  const profilesById = new Map(
    ((profileRows.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map(profile => [
      profile.id,
      profile,
    ]),
  );

  const members = rawMembers.map(row =>
    mapMember(
      row,
      profilesById.get(row.user_id)?.display_name ?? null,
      profilesById.get(row.user_id)?.avatar_url ?? null,
    ),
  );
  return {
    blend: mapBlend(blendRow as BlendRow),
    members,
    items: ((itemRows ?? []) as BlendItemRow[]).map(mapItem),
  };
}

export async function updateBlend(blendId: string, patch: { name?: string; visibility?: BlendVisibility; coverUrl?: string | null }): Promise<void> {
  const client = requireClient();
  await requireUserId();
  const update: Record<string, string | null> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0 || name.length > 60) throw new BlendServiceError('invalid_input', 'Blend name 1–60 chars.');
    update.name = name;
  }
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.coverUrl !== undefined) update.cover_url = patch.coverUrl;
  if (Object.keys(update).length === 0) return;

  const { error } = await client.from('blends').update(update).eq('id', blendId);
  if (error) throw mapToServiceError(error, 'blend update');
}

export async function rotateInvite(blendId: string): Promise<string> {
  const client = requireClient();
  await requireUserId();
  const inviteCode = generateInviteCode();
  const { error } = await client
    .from('blends')
    .update({ invite_code: inviteCode, invite_expires_at: inviteExpiresDaysFromNow() })
    .eq('id', blendId);
  if (error) throw mapToServiceError(error, 'invite rotate');
  return inviteCode;
}

/** Join via invite-code RPC (RLS insert policy deliberately nahi hai) */
export async function joinByInviteCode(inviteCode: string): Promise<string> {
  const client = requireClient();
  await requireUserId();
  const code = inviteCode.trim();
  if (!/^[A-Z2-9]{8}$/i.test(code)) {
    throw new BlendServiceError('invite_invalid_or_expired', 'Code format galat hai.');
  }
  const { data, error } = await client.rpc('fn_join_blend', { p_invite_code: code });
  if (error) throw new BlendServiceError(mapPgError(error), 'Join failed.', error);
  return data as string;
}

export async function leaveBlend(blendId: string): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client.from('blend_members').delete().eq('blend_id', blendId).eq('user_id', userId);
  if (error) throw mapToServiceError(error, 'blend leave');
}

export async function removeMember(blendId: string, targetUserId: string): Promise<void> {
  const client = requireClient();
  await requireUserId(); // owner-only — RLS reject karega warna
  const { error } = await client.from('blend_members').delete().eq('blend_id', blendId).eq('user_id', targetUserId);
  if (error) throw mapToServiceError(error, 'member remove');
}

export async function uploadSnapshot(snapshot: TasteSnapshot): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client.from('blend_snapshots').upsert(
    { user_id: userId, snapshot, captured_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw mapToServiceError(error, 'snapshot upsert');
}

export interface SnapshotEntry {
  userId: string;
  snapshot: TasteSnapshot;
}

/** Compute se pehle members ke snapshots (co-members read — RLS helper allows) */
export async function listMemberSnapshots(blendId: string): Promise<SnapshotEntry[]> {
  const client = requireClient();
  await requireUserId();

  const { data: memberRows, error: memberError } = await client
    .from('blend_members')
    .select('user_id')
    .eq('blend_id', blendId);
  if (memberError) throw mapToServiceError(memberError, 'members read');

  const memberUserIds = ((memberRows ?? []) as { user_id: string }[]).map(row => row.user_id);
  if (memberUserIds.length === 0) return [];

  // FK path (blend_members ↔ blend_snapshots through auth.users) PostgREST me
  // nahi hota — plain in() query; RLS cross-read fn_shared_blend_member se.
  const { data: snapshotRows, error: snapshotError } = await client
    .from('blend_snapshots')
    .select('user_id, snapshot')
    .in('user_id', memberUserIds);
  if (snapshotError) throw mapToServiceError(snapshotError, 'snapshots read');
  return ((snapshotRows ?? []) as { user_id: string; snapshot: TasteSnapshot }[]).map(row => ({
    userId: row.user_id,
    snapshot: row.snapshot,
  }));
}

/* ---------- Edge Function bridge ---------- */

export type ComputeAction = 'compute' | 'add_track' | 'remove_track';

function mapToServiceError(error: { message?: string; code?: string }, context: string): BlendServiceError {
  if (error?.code === 'PGRST116' || error?.message?.includes('No rows')) {
    return new BlendServiceError('not_found', `${context}: not found`, error);
  }
  return new BlendServiceError('unknown', `${context}: failed`, error);
}

export async function invokeBlendFunction(blendId: string, action: ComputeAction, payload: Record<string, unknown> = {}): Promise<unknown> {
  const client = requireClient();
  await requireUserId();
  const { data, error } = await client.functions.invoke('blend-compute', {
    body: { action, blendId, ...payload },
  });
  if (error) {
    const fnError = error as { message?: string };
    const msg = fnError?.message ?? '';
    if (msg.includes('snapshot_missing')) {
      throw new BlendServiceError('snapshots_pending', 'Kuch members ke taste snapshots abhi upload nahi hue.', error);
    }
    throw new BlendServiceError('unknown', 'Blend compute failed.', error);
  }
  return data;
}

/**
 * Manual add — client se track eligibility pre-check (playable full song),
 * final validation Edge Function karta hai.
 */
export async function addTrackToBlend(blendId: string, song: Song): Promise<void> {
  if (song.previewOnly) {
    throw new BlendServiceError('invalid_input', 'Sirf full playable tracks eligible hain.');
  }
  await invokeBlendFunction(blendId, 'add_track', {
    track: {
      trackId: song.id,
      title: song.title,
      artistNames: song.artist.split(',').map(part => part.trim()).filter(Boolean),
      artworkUrl: song.cover,
      provider: song.source ?? 'jiosaavn',
      durationSec: Math.round(song.duration / 1000),
      playableFull: true,
    },
  });
}

export async function removeTrackFromBlend(blendId: string, trackId: string): Promise<void> {
  await invokeBlendFunction(blendId, 'remove_track', { trackId });
}

export async function triggerCompute(blendId: string): Promise<void> {
  await invokeBlendFunction(blendId, 'compute');
}

/** Share helpers — deep link + raw code (messenger-safe) */
export function blendInviteDeepLink(inviteCode: string): string {
  return `punjabi-beats://blend/join?code=${inviteCode}`;
}

export function blendShareText(blendName: string, inviteCode: string): string {
  return `${blendName} — Punjabi Beats Blend join karo! 🎵 Code: ${inviteCode} ya link kholo: ${blendInviteDeepLink(inviteCode)}`;
}
