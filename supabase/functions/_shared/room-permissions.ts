/**
 * Room permission matrix (Phase 11 Jam) — spec ka single source.
 * UI (controls hide/show) aur Edge Function (server-side enforcement)
 * DONO isi shape ka mirror use karte hain. Edge copy:
 * supabase/functions/_shared/room-permissions.ts — drift guard
 * test-jam.mjs me hai; change karo to dono update karo.
 *
 * Pure logic — koi import nahi.
 */

/* Local role/type literals — self-contained (Deno copy supabase/functions/
 * _shared/room-permissions.ts supposed EXACT same hai; types/index.ts ka
 * RoomRole/RoomType in union types se assignable hai). */

export type RoomRole =
  | 'owner'
  | 'co_host'
  | 'moderator'
  | 'participant'
  | 'listener';

export type RoomType = 'jam' | 'listening_party';

export type RoomControlAction =
  /** queue me track add (participant sirf jam me) */
  | 'queue_add'
  /** apna pending item remove (participant sirf jam me) */
  | 'queue_remove_own'
  /** kisi bhi member ka item remove (moderation) */
  | 'queue_remove_any'
  | 'queue_reorder'
  /** play/pause/seek/next/track_change — sirf owner + co_host */
  | 'playback_control'
  /** chat mute/unmute */
  | 'member_mute'
  | 'member_remove'
  /** co_host/moderator assign — owner only */
  | 'role_assign'
  | 'close_room'
  | 'chat_send';

const ALWAYS_ALLOWED: RoomRole[] = ['owner', 'co_host', 'moderator', 'participant', 'listener'];
const PLAYBACK_ROLES: RoomRole[] = ['owner', 'co_host'];
const MODERATION_ROLES: RoomRole[] = ['owner', 'co_host', 'moderator'];
const QUEUE_ROLES: RoomRole[] = ['owner', 'co_host', 'moderator'];

/**
 * Spec matrix:
 *
 * | action           | owner | co_host | moderator | participant | listener |
 * |------------------|-------|---------|-----------|-------------|----------|
 * | queue add/own    |  ✓    |    ✓    |     ✓     |  jam ✓/✗    |    ✗     |
 * | queue remove any |  ✓    |    ✓    |     ✓     |      ✗      |    ✗     |
 * | playback control |  ✓    |    ✓    |     ✗     |      ✗      |    ✗     |
 * | mute member      |  ✓    |    ✓    |     ✓     |      ✗      |    ✗     |
 * | remove member    |  ✓    |    ✓    |  jam only |      ✗      |    ✗     |
 * | role assign      |  ✓    |    ✗    |     ✗     |      ✗      |    ✗     |
 * | close room       |  ✓    |    ✗    |     ✗     |      ✗      |    ✗     |
 * | chat send        |  ✓    |    ✓    |     ✓     |      ✓      |    ✓     |
 * | queue reorder    |  ✓    |    ✓    |     ✓     |      ✗      |    ✗     |
 */
export function can(role: RoomRole, action: RoomControlAction, roomType: RoomType): boolean {
  if (!ALWAYS_ALLOWED.includes(role)) return false;

  switch (action) {
    case 'queue_add':
    case 'queue_remove_own':
      if (QUEUE_ROLES.includes(role)) return true;
      // participant: sirf jam me apna queue manage kar sakta hai
      return role === 'participant' && roomType === 'jam';

    case 'queue_remove_any':
      return QUEUE_ROLES.includes(role);

    case 'queue_reorder':
      return QUEUE_ROLES.includes(role);

    case 'playback_control':
      return PLAYBACK_ROLES.includes(role);

    case 'member_mute':
      return MODERATION_ROLES.includes(role);

    case 'member_remove':
      if (role === 'owner' || role === 'co_host') return true;
      // moderator sirf jam me remove kar sakta hai (party me audience role hai)
      return role === 'moderator' && roomType === 'jam';

    case 'role_assign':
    case 'close_room':
      return role === 'owner';

    case 'chat_send':
      return true; // muted check call-site karta hai (muted_until)

    default:
      return false;
  }
}

/** UI convenience — member khud ko moderate nahi kar sakta */
export function canModerateMember(
  actorRole: RoomRole,
  targetRole: RoomRole,
  action: 'member_mute' | 'member_remove',
  roomType: RoomType,
): boolean {
  if (actorRole === targetRole) return false; // khud pe nahi
  return can(actorRole, action, roomType);
}
