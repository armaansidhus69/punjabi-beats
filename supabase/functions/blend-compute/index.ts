// supabase/functions/blend-compute/index.ts — Phase 10 Edge Function.
//
// Actions: 'compute' | 'add_track' | 'remove_track'.
// Caller JWT verify (anon client + Authorization header). Service role
// sirf DB writes ke liye — client RLS pe sari re/or reads khud karta hai.
// v1 algorithm: docs/superpowers/specs/2026-10-28-blend-design.md —
// scoring copy _shared/blend-scoring.ts (test-blend.mjs parity guard).
//
// Deploy: supabase functions deploy blend-compute (CLI + access token).
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  BLEND_ALGORITHM_VERSION,
  pooledTrackToBlendItem,
  scorePooledTracks,
  selectBlendItems,
  type PooledTrack,
  type SnapshotMember,
  type TasteSnapshotShape,
} from '../_shared/blend-scoring.ts';

const TARGET_ITEMS = 30;
/* ------------------------------ types ------------------------------ */

interface BlendRow {
  id: string;
  owner_id: string;
  algorithm_version: string;
  compute_status: 'pending' | 'computing' | 'ready' | 'error';
  // userId → library_hash at last successful compute
  library_hashes: Record<string, string> | null;
}

interface MemberRow {
  blend_id: string;
  user_id: string;
  role: 'owner' | 'member';
}

interface SnapshotRow {
  user_id: string;
  snapshot: TasteSnapshotShape;
}

interface ExclusionRow {
  track_id: string;
}

interface ManualItemRow {
  id: string;
  blend_id: string;
  track_id: string;
  source_user_id: string | null;
  score: number;
  position: number;
  track: {
    title: string;
    artistNames: string[];
    artworkUrl: string;
    provider: string;
    durationSec: number;
    playableFull: boolean;
  };
  origin: 'generated' | 'member';
}

interface AddTrackPayload {
  trackId: string;
  title: string;
  artistNames: string[];
  artworkUrl: string;
  provider: string;
  durationSec: number;
  playableFull: boolean;
}

interface ActionBody {
  action?: 'compute' | 'add_track' | 'remove_track';
  blendId?: string;
  trackId?: string;
  track?: AddTrackPayload;
}

interface ActionResult {
  status: 'ok' | 'noop' | 'error';
  error?: string;
  detail?: unknown;
}

/* ------------------------------ clients ------------------------------ */

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const serviceClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------ plumbing ------------------------------ */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface AuthContext {
  userId: string;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id };
}

/* ------------------------------ core compute ------------------------------ */

function loadLibraryHashes(members: SnapshotMember[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const member of members) {
    hashes[member.userId] = member.snapshot.libraryHash;
  }
  return hashes;
}

/** library_hashes unchanged ho to recompute skip (free-tier no-op guard) */
function hashesUnchanged(blend: BlendRow, members: SnapshotMember[]): boolean {
  if (!blend.library_hashes) return false;
  const next = loadLibraryHashes(members);
  const keys = new Set([...Object.keys(blend.library_hashes), ...Object.keys(next)]);
  for (const key of keys) {
    if (blend.library_hashes[key] !== next[key]) return false;
  }
  return true;
}

async function loadBlendContext(
  blendId: string,
): Promise<{ blend: BlendRow; members: SnapshotMember[]; missingUserIds: string[]; memberIds: string[] } | { error: string }> {
  const { data: blend, error: blendError } = await serviceClient
    .from('blends')
    .select('id, owner_id, algorithm_version, compute_status, library_hashes')
    .eq('id', blendId)
    .maybeSingle<BlendRow>();
  if (blendError) return { error: 'blend_read_failed' };
  if (!blend) return { error: 'blend_not_found' };

  const { data: memberRows, error: membersError } = await serviceClient
    .from('blend_members')
    .select('blend_id, user_id, role')
    .eq('blend_id', blendId)
    .order('joined_at', { ascending: true });
  if (membersError) return { error: 'members_read_failed' };
  const memberOrdered = (memberRows ?? []) as MemberRow[];
  if (memberOrdered.length === 0) return { error: 'blend_empty' };

  const { data: snapshotRows, error: snapshotsError } = await serviceClient
    .from('blend_snapshots')
    .select('user_id, snapshot');
  if (snapshotsError) return { error: 'snapshots_read_failed' };

  const snapshotByUser = new Map<string, TasteSnapshotShape>();
  for (const row of (snapshotRows ?? []) as SnapshotRow[]) {
    snapshotByUser.set(row.user_id, row.snapshot);
  }

  // join order me owners pehle (fn_join_blend insert order equivalent)
  const memberIds = memberOrdered.map(row => row.user_id);
  const members: SnapshotMember[] = [];
  const missingUserIds: string[] = [];
  for (const row of memberOrdered) {
    const snapshot = snapshotByUser.get(row.user_id);
    if (snapshot) {
      members.push({ userId: row.user_id, snapshot });
    } else {
      missingUserIds.push(row.user_id);
    }
  }

  return { blend, members, missingUserIds, memberIds };
}

async function recomputeBlend(
  blendId: string,
  context: { blend: BlendRow; members: SnapshotMember[]; missingUserIds: string[]; memberIds: string[] },
): Promise<ActionResult> {
  const { blend, members, missingUserIds, memberIds } = context;

  if (missingUserIds.length > 0) {
    return { status: 'error', error: 'snapshot_missing', detail: { missingUserIds } };
  }

  // 1. no-op guard
  if (hashesUnchanged(blend, members)) {
    return { status: 'noop', detail: { reason: 'library_hashes_unchanged' } };
  }

  // 2. exclusions + manual rows (unique track_id constraint ke saath dedupe)
  const { data: exclusionRows, error: exclusionError } = await serviceClient
    .from('blend_exclusions')
    .select('track_id')
    .eq('blend_id', blendId);
  if (exclusionError) return { status: 'error', error: 'exclusions_read_failed' };
  const excluded = new Set(((exclusionRows ?? []) as ExclusionRow[]).map(row => row.track_id));

  const { data: manualRows, error: manualError } = await serviceClient
    .from('blend_items')
    .select('id, blend_id, track_id, source_user_id, score, position, track, origin')
    .eq('blend_id', blendId)
    .eq('origin', 'member');
  if (manualError) return { status: 'error', error: 'manual_items_read_failed' };
  const manual = (manualRows ?? []) as ManualItemRow[];
  for (const item of manual) excluded.add(item.track_id);

  // 3. pool + selection (target 30, per-member quota)
  const pooled = scorePooledTracks(members);
  const selection = selectBlendItems(pooled, excluded, memberIds, TARGET_ITEMS);

  // 4. write: generated replace + manual positions append (deterministic)
  const generatedItems = selection.items.map((track, position) => {
    const item = pooledTrackToBlendItem(track, blendId, position);
    return {
      blend_id: item.blendId,
      track_id: item.trackId,
      source_user_id: track.userId,
      score: item.score,
      position: item.position,
      track: item.track,
      origin: 'generated',
    };
  });

  const manualSorted = [...manual].sort((a, b) => b.score - a.score);
  const manualItems = manualSorted.map((item, index) => {
    // manual score = pooled score if available, warna flat 0.5
    const pooledMatch = pooled.find((track: PooledTrack) => track.trackId === item.track_id);
    return {
      id: item.id,
      blend_id: blendId,
      track_id: item.track_id,
      source_user_id: item.source_user_id,
      score: pooledMatch ? pooledMatch.score : item.score,
      position: generatedItems.length + index,
      track: item.track,
      origin: 'member',
    };
  });

  const deleteResult = await serviceClient
    .from('blend_items')
    .delete()
    .eq('blend_id', blendId)
    .eq('origin', 'generated');
  if (deleteResult.error) return { status: 'error', error: 'generated_delete_failed' };

  if (manualItems.length > 0) {
    // upsert (id present ho to update, warna insert)
    const upsertResult = await serviceClient
      .from('blend_items')
      .upsert(manualItems, { onConflict: 'id' });
    if (upsertResult.error) return { status: 'error', error: 'manual_upsert_failed' };
  }

  if (generatedItems.length > 0) {
    const insertResult = await serviceClient.from('blend_items').insert(generatedItems);
    if (insertResult.error) return { status: 'error', error: 'generated_insert_failed' };
  }

  // 5. status + library_hashes bump
  const hashes = loadLibraryHashes(members);
  const finalUpdate = await serviceClient
    .from('blends')
    .update({
      compute_status: 'ready',
      last_computed_at: new Date().toISOString(),
      algorithm_version: BLEND_ALGORITHM_VERSION,
      library_hashes: hashes,
    })
    .eq('id', blendId);
  if (finalUpdate.error) return { status: 'error', error: 'blend_status_update_failed' };

  return {
    status: 'ok',
    detail: {
      generated: generatedItems.length,
      manual: manualItems.length,
      skipped: selection.skipped.length,
    },
  };
}

/* ------------------------------ actions ------------------------------ */

async function handleCompute(blendId: string, caller: string): Promise<{ http: number; body: unknown }> {
  const context = await loadBlendContext(blendId);
  if ('error' in context) return { http: 404, body: { error: context.error } };
  if (!context.memberIds.includes(caller)) {
    return { http: 403, body: { error: 'not_a_member' } };
  }
  if (context.missingUserIds.length > 0) {
    return { http: 409, body: { error: 'snapshot_missing', missingUserIds: context.missingUserIds } };
  }

  await serviceClient.from('blends').update({ compute_status: 'computing' }).eq('id', blendId);
  const result = await recomputeBlend(blendId, context);
  const http = result.status === 'ok' ? 200 : result.status === 'noop' ? 200 : 500;
  return { http, body: result };
}

async function handleAddTrack(
  blendId: string,
  caller: string,
  track: AddTrackPayload,
): Promise<{ http: number; body: unknown }> {
  const context = await loadBlendContext(blendId);
  if ('error' in context) return { http: 404, body: { error: context.error } };
  if (!context.memberIds.includes(caller)) return { http: 403, body: { error: 'not_a_member' } };

  if (!track.playableFull || track.trackId.length === 0) {
    return { http: 400, body: { error: 'track_not_eligible' } };
  }

  const { error } = await serviceClient.from('blend_items').upsert(
    {
      blend_id: blendId,
      track_id: track.trackId,
      source_user_id: caller,
      score: 0.5, // recompute me pooled score hota hai
      position: 0,
      track: {
        title: track.title,
        artistNames: track.artistNames,
        artworkUrl: track.artworkUrl,
        provider: track.provider,
        durationSec: track.durationSec,
        playableFull: track.playableFull,
      },
      origin: 'member',
    },
    { onConflict: 'blend_id,track_id' },
  );
  if (error) return { http: 500, body: { error: 'add_failed', detail: error.message } };

  const recompute = await recomputeBlend(blendId, context);
  return { http: recompute.status === 'error' && recompute.error !== 'noop' ? 500 : 200, body: recompute };
}

async function handleRemoveTrack(
  blendId: string,
  caller: string,
  trackId: string,
): Promise<{ http: number; body: unknown }> {
  const context = await loadBlendContext(blendId);
  if ('error' in context) return { http: 404, body: { error: context.error } };
  if (!context.memberIds.includes(caller)) return { http: 403, body: { error: 'not_a_member' } };

  // tombstone DONO origins pe — UI promise: removed track recompute me
  // wapas nahi aayega (even agar kisi snapshot me abhi bhi hai)
  const { error: exclusionError } = await serviceClient.from('blend_exclusions').upsert(
    { blend_id: blendId, track_id: trackId, removed_by_user_id: caller },
    { onConflict: 'blend_id,track_id' },
  );
  if (exclusionError) return { http: 500, body: { error: 'exclusion_write_failed' } };

  const { error: deleteError } = await serviceClient
    .from('blend_items')
    .delete()
    .eq('blend_id', blendId)
    .eq('track_id', trackId);
  if (deleteError) return { http: 500, body: { error: 'remove_failed' } };

  // compute guard guard-mode me skip na ho — hash parity can differ
  // (items changed without library change), isliye compute_status
  // 'computing' pehle set hota hai; recomputeBind fresh data likhega.
  await serviceClient.from('blends').update({ compute_status: 'computing' }).eq('id', blendId);
  const recompute = await recomputeBlend(blendId, context);
  const http = recompute.status === 'error' ? 500 : 200;
  return { http, body: recompute };
}

/* ------------------------------ entry ------------------------------ */

Deno.serve(async req => {
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders });
  }

  let auth: AuthContext | null = null;
  try {
    auth = await authenticate(req);
  } catch {
    auth = null;
  }
  if (!auth) return json(401, { error: 'not_authenticated' });

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const blendId = body.blendId;
  if (!blendId || typeof blendId !== 'string') return json(400, { error: 'blendId_required' });

  try {
    if (body.action === 'compute') {
      const result = await handleCompute(blendId, auth.userId);
      return json(result.http, result.body);
    }
    if (body.action === 'add_track') {
      if (!body.track) return json(400, { error: 'track_required' });
      const result = await handleAddTrack(blendId, auth.userId, body.track);
      return json(result.http, result.body);
    }
    if (body.action === 'remove_track') {
      if (!body.trackId) return json(400, { error: 'trackId_required' });
      const result = await handleRemoveTrack(blendId, auth.userId, body.trackId);
      return json(result.http, result.body);
    }
    return json(400, { error: 'unknown_action' });
  } catch (err) {
    console.error('blend-compute unexpected error:', err);
    // fail-open last state — status error mark karo, purane items waise hi rehte hain
    await serviceClient.from('blends').update({ compute_status: 'error' }).eq('id', blendId);
    return json(500, { error: 'unexpected', detail: err instanceof Error ? err.message : 'unknown' });
  }
});
