# Jam + Listening Party (Phase 11) — Implementation Plan

Builds the feature defined in
`docs/superpowers/specs/2026-10-29-jam-rooms-design.md`. Same sequence
discipline as the Blend plan: pure logic → persistence → server → UI →
wiring, each step verifiable on its own.

## 1. Types + feature flag

- [ ] Add `jam_enabled` wiring touch-up if needed (already defaults off in
  `DEFAULT_FEATURE_FLAGS` — verify only).
- [ ] Add types: `RoomType`, `RoomStatus`, `RoomRole`, `JamRoom`,
  `JamMember` (with `lastSeenAt`, `mutedUntil`), `JamPlaybackState`,
  `JamQueueItem`, `JamMessage` following `mobile/types/index.ts` styles.

## 2. Pure logic (`mobile/core/room/`)

- [ ] `timeModel.ts` — `captureDeviceSkew(serverUpdatedAt, deviceNow)`,
  `predictPosition(state, serverNow)`, correction policy constants
  (SMOOTH_MAX_MS = 2000, DRIFT_RATE_MS_PER_MIN = 30000/60*0.5).
- [ ] `permissions.ts` — role→action matrix (queue/playback/moderation/
  roles/close) as pure predicate `can(role, action, roomType)`.
- [ ] `versioning.ts` — `shouldApply(incoming, lastApplied)` gate incl.
  idempotent duplicate case.
- [ ] Headless-testable: no RN/supabase imports.

## 3. Migration `supabase/migrations/003_rooms.sql`

- [ ] `rooms`, `room_members`, `room_playback_state`, `room_queue_items`,
  `room_messages` per spec (idempotent).
- [ ] Indexes + updated_at triggers + grants (authenticated only).
- [ ] RLS: member-scoped selects; client writes BIGA: self-join via
  `fn_join_room` RPC only, self-leave delete, chat insert own (500-char
  body, members only); no client writes to playback/queue/rooms.
- [ ] `fn_join_room(p_invite_code)` security definer (cap + validity +
  role default: jam→participant, party→listener).
- [ ] Enable nothing new (pg_cron/pg_net already on from 002).

## 4. Edge function `supabase/functions/room-control/`

- [ ] Deno, JWT verify (anon client + Bearer), service-role writes.
- [ ] Actions per spec: join/leave/queue_add|remove|reorder/playback_* /
  member_mute|unmute|remove/role_assign/heartbeat/close_room.
- [ ] Role matrix check server-side (mirror `permissions.ts` — versioned
  note in code, drift-aware comment).
- [ ] Monotonic `state_version` / `queue_version` increment in same write.
- [ ] Pending-duplicate queue invariant enforced.
- [ ] `supabase/config.toml`-aware deploy runbook comment (CLI action).

## 5. Cron runbook `supabase/cron/rooms-hourly-expiry.sql`

- [ ] Hourly expire: `status='active'` + no `last_seen_at` within 2h →
  `expired`. Vault-keyed pattern like the blend runbook; guarded CREATE.

## 6. Service + realtime

- [ ] `mobile/services/jamService.ts` — create room, list mine, getRoom
  (room + members + state + queue + recent messages), `fn_join_room` via
  rpc, invite rotate, control invokes (`room-control`), share helpers
  (`punjabi-beats://jam/join?code=…` + raw code text).
- [ ] `mobile/services/jamRealtime.ts` — postgres_changes on `room_members`,
  `room_playback_state`, `room_queue_items`, `room_messages` + ephemeral
  broadcast channel (reactions, typing). Reconnect → full-row refresh +
  version-gated apply. Heartbeat loop wired here.

## 7. Store `mobile/stores/jamStore.ts`

- [ ] zustand: rooms list, active room (members/queue/playback/messages),
  `applyServerState(gate)` through `versioning.ts`, optimistic control with
  version reconcile, connection state mirror.

## 8. Screens + components

- [ ] `mobile/app/jam/index.tsx` (my rooms + create CTA), `create.tsx`
  (type: jam/party + title + visibility), `[id].tsx` (queue, playback
  controls by role, chat sheet, reactions, member chips + role badges,
  owner menu: role assign/remove/mute/close/invite rotate), `join.tsx`
  (code + login gate).
- [ ] Gate component `JamGate` (reuses BlendGate pattern; `jam_enabled`).
- [ ] Library tab: Jam entry card (below Blend).
- [ ] Host controls visible per `can(role, …)`; Party listeners get
  "host controls playback" banner.

## 9. Player integration

- [ ] `jamStore` ↔ `playerStore` glue: when in a room, local
  play/pause/seek/track actions call `room-control` and reconcile with
  server version; remote state drives local playback via existing
  `resolveSongPlaybackUrl` pipeline. NO changes to Apinator roomSync paths.

## 10. Headless tests `test-jam.mjs` (root)

- [ ] timeModel: skew capture, predicted position, policy boundaries
  (exactly 2s → smooth, >2s → seek), drift tween bounds.
- [ ] permissions: full matrix incl. jam-vs-party participant asymmetry.
- [ ] versioning: old/equal-duplicate/new cases.
- [ ] Queue helper: pending-duplicate reject, reorder, removal gaps.
- [ ] Wire into root `npm test` + `mobile/package.json` (`test`, `test:jam`).

## 11. Verify and document

- [ ] Gates: `tsc --noEmit` 0 · `eslint` 0 · root `npm test` green
  (existing suites untouched).
- [ ] Manual/device checks written into CHECKLIST (2-device sync,
  reconnect, host enforcement, promotion, expiry).
- [ ] Roadmap Phase 11 boxes `[~]` with status note (mirrored from Blend
  story); dashboard/CLI steps highlighted for the user.

## Execution notes

- Steps 2 + 10 land before any Supabase surface; migration/function/cron
  need dashboard or CLI (`supabase functions deploy room-control`, run
  `003_rooms.sql`, cron SQL).
- Existing Apinator guest rooms + `roomSync` are read-only zones — no edits.
