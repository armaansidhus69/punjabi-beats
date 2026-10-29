# Punjabi Beats — Jam + Listening Party (Phase 11)

## Status

Design approved in chat (sections 1–6) on October 28–29, 2026. This document
defines the account-based room system (Jam + Listening Party) before
implementation. Live Event (scheduled start/end, event page, tickets/access,
artist hosting) is a separate later cycle overlapping Phases 14/15.

## Goal

Convert group listening into a proper room system with server-authoritative
playback state, role-based control, DB-backed membership/history, and a real
reconnection protocol — for logged-in users, in two room types:

- **Jam** — small private group (cap 8), everyone can add songs, playback
  controlled by owner/co-host, chat + reactions.
- **Listening Party** — host-controlled session (cap 100): only owner/co-host/
  moderator control playback and queue; audience listens, chats, reacts.

The **existing guest 6-digit Apinator rooms remain untouched** — new system
replaces them for logged-in users at a later, deprecation-gated phase.

## Platform decision (approved)

Supabase-only for the new room system: tables (of record) + Edge Function
(`room-control`) for every authorized mutation + Realtime (`postgres_changes`
for durable data, ephemeral **broadcast** for reactions/typing). Apinator is
not bridged. Rationale: one platform for auth (RLS), state authority (DB + version
counters), realtime, and role enforcement; reconnection = row read + version
compare; chat gets history reactions via tables for free.

## Data model (`supabase/migrations/003_rooms.sql`)

```text
rooms
  id uuid pk default gen_random_uuid()
  owner_id uuid not null -> auth.users on delete cascade
  type text not null check in ('jam','listening_party')
  title text not null
  cover_url text
  visibility text not null default 'private_invite' check in ('private_invite','public')
  invite_code text unique not null          -- 8-char (same alphabet rule as blends)
  max_participants integer not null         -- jam 8, party 100
  scheduled_start / scheduled_end timestamptz   -- null in v1 (live_event later)
    check (scheduled_end is null or scheduled_end > scheduled_start)
  status text not null default 'active'
    check in ('active','paused','closed','expired')
  created_at / updated_at

room_members
  room_id uuid -> rooms(id) on delete cascade
  user_id uuid -> auth.users(id) on delete cascade
  role text not null default 'participant'
    check in ('owner','co_host','moderator','participant','listener')
  joined_at timestamptz not null default now()
  last_seen_at timestamptz not null default now()
  muted_until timestamptz                   -- chat moderation
  pk (room_id, user_id)

room_playback_state                         -- ONE row per room (upserted)
  room_id uuid pk -> rooms(id) on delete cascade
  track_id text not null
  track jsonb not null                      -- denormalized { title, artistNames,
                                            --   artworkUrl, provider, durationSec,
                                            --   playableFull } (Blend pattern)
  position_ms integer not null default 0 check (position_ms >= 0)
  is_playing boolean not null default false
  queue_version integer not null default 0
  state_version integer not null default 0
  updated_by uuid -> auth.users(id) on delete set null
  updated_at timestamptz not null default now()

room_queue_items
  id uuid pk default gen_random_uuid()
  room_id uuid -> rooms(id) on delete cascade
  track_id text not null
  track jsonb not null
  added_by uuid -> auth.users(id) on delete set null
  position integer not null
  played_at timestamptz                     -- null = pending; set = consumed
  created_at timestamptz not null default now()
  -- no UNIQUE constraints: positions have gaps after removals, and a track
  -- may re-enter once consumed. Pending-duplicate invariant (same track_id
  -- already pending at same room) is enforced server-side in room-control.

room_messages
  id uuid pk default gen_random_uuid()
  room_id uuid -> rooms(id) on delete cascade
  user_id uuid -> auth.users(id) on delete set null
  kind text not null default 'chat' check in ('chat','reaction_log','system')
  body text not null check (char_length(body) between 1 and 500)
  track_id text                             -- optional "track message" attachment
  reply_to_id uuid -> room_messages(id) on delete set null
  created_at timestamptz not null default now() -- server-side history cap: UI reads
                                               -- newest 200 per room (v1 policy)
```

Indexes: `room_members(user_id)`, `room_members(room_id, last_seen_at)`,
`room_queue_items(room_id, position)`,
`room_messages(room_id, created_at desc)`.

### Version + idempotency contract (state authority)

- `state_version` — incremented server-side (Edge Function) on every change
  to the playback row or queue list. `queue_version` mirrors it for queue-only
  changes.
- Client applies event iff `state_version > lastApplied`; equal-or-lower →
  ignore; equal version + identical content → idempotent no-op (dupes).
- Client actions NEVER write playback/queue rows directly — all through
  `room-control` (service role). Client RLS: read-only on room tables.

### RLS summary

- `rooms`/`room_members`/`room_playback_state`/`room_queue_items`/
  `room_messages`: authenticated select for **active members only** (public
  rooms list join preview: `rooms.visibility='public'` readable without
  membership — join still requires invite for `private_invite`, public rooms
  allow direct `fn_join_room`).
- `rooms` update: **no client policy** (owner actions via `room-control`).
- `room_members`: client may insert **own row via `fn_join_room` RPC only**
  (atomic cap + validity checks, mirrors `fn_join_blend`); delete own row
  (leave) or owner/co_host-delete-others via function only — keep a client
  policy for self-delete only.
- `room_messages` insert: members may insert own chat rows client-side (fast
  path; RLS: `user_id = auth.uid()` and count cap check via function for rate
  limiting in v1 is deferred — noted honestly); delete only via moderation
  path (no direct client delete).
- `room_playback_state` / `room_queue_items`: **no client write policies**.
- Service-role tables grant policy: grants to `authenticated` per Def of
  exposure; functions use service role to bypass.

### Role permission matrix (single source: `mobile/core/room/permissions.ts`
mirrored into `room-control`)

| Action | owner | co_host | moderator | participant | listener |
|---|---|---|---|---|---|
| queue add/remove own | ✓ | ✓ | ✓ | jam ✓ / party ✗ | ✗ |
| play/pause/seek/next/skip | ✓ | ✓ | ✗ | ✗ | ✗ |
| mute member chat | ✓ | ✓ | ✓ | ✗ | ✗ |
| remove member | ✓ | ✓ | (jam only) | ✗ | ✗ |
| assign co_host/moderator | ✓ | ✗ | ✗ | ✗ | ✗ |
| close room | ✓ | ✗ | ✗ | ✗ | ✗ |
| add reaction/chat | ✓ | ✓ | ✓ | ✓ | ✓ |

## Edge function `supabase/functions/room-control/`

One Deno function, action-dispatch; verifies caller JWT; loads room + members;
checks the role matrix; writes via service role; bumps version counters;
returns `{ stateVersion, queueVersion }`.

Actions:
- `join` (same semantics as `fn_join_room`; party participants join as
  `listener` unless capacity allows more control roles — v1: always listener)
- `leave`
- `queue_add` / `queue_remove` / `queue_reorder`
- `playback_play` / `playback_pause` / `playback_seek` /
  `playback_track_change` / `playback_next`
- `member_mute` / `member_unmute` / `member_remove`
- `role_assign` (owner only: co_host/moderator)
- `heartbeat` (presence touch, no version bump)
- `close_room` (owner sets `status='closed'`)

Client never calls raw Supabase REST for enqueue/control — actions write
through the function, receive the canonical version, and reconcile local
state.

## Playback sync math

- server row: `{ track_id, position_ms, is_playing, updated_at, state_version }`
- client predicted position:
  `is_playing ? position_ms + (now,server-adjusted − updated_at) : position_ms`
- **skew capture**: on sync, `deviceSkew = serverUpdatedAt − deviceClock`
  recorded once per session; all math in server-adjusted time
- **correction policy**: `|predicted − server| ≤ 2s` → smooth drift correction
  (≤ 0.5s/min tween); else hard seek. New track_id (same state_version-bumped
  event) → full queue load + play.
- queue advance is client-local when a song ends naturally AND server state
  says `is_playing` on the last item → client calls `playback_next` and
  reconciles; other clients follow via finished state_version.

## Reconnection / recovery protocol

- Client keeps in-memory `lastApplied { stateVersion, queueVersion }`
  (not persisted; fresh app open = full sync anyway).
- On channel re-SUBSCRIBED → fetch room + playback + queue + members rows →
  server state wins → apply via version gates; stale-state banner until first
  sync completes.
- Heartbeat: every 30s via `room-controller` `heartbeat` action writes
  `last_seen_at` (no-op when session idle).
- Offline-join (join without active channel): row reads still possible; UI
  shows connection banner + action buttons disabled until re-subscribed.

## Host-disconnect semantics (approved divergence)

- Ownership is account-bound (owner_id row), so a *disconnected* owner does
  not evict them. Control does not promote on disconnect — spec's
  co-host-promotion-on-disconnect applies to session hosts, which account
  rooms do not need.
- Promotion happens when an owner **explicitly leaves**: co_host → promoted
  (earliest-joined co_host first); if no co_host, room cascades away.
- Owner can close room regardless.

## Empty-room expiry

`pg_cron` hourly (vault-keyed URL/sql — mirror `blend-daily-refresh`
runbook): rooms `status='active'` where no `room_members.last_seen_at` in
2h → `status='expired'`. Cascade-free: chat/queue rows remain read-only via
RLS (members only) for history until room closure.

## Client architecture

- `mobile/core/room/` pure logic:
  - `timeModel.ts` — skew capture, predicted position, correction policy
  - `permissions.ts` — role matrix (single source; FX + UI share)
  - `versioning.ts` — apply/no-op/ignore gate
- `mobile/services/jamService.ts` — Supabase boundary: create room, `fn_join_room`
  RPC, list my rooms, getRoom, control invoke helpers, invite rotate.
- `mobile/services/jamRealtime.ts` — Realtime subscription manager
  (`postgres_changes` on 4 tables + `broadcast` ephemeral).
- `mobile/stores/jamStore.ts` — zustand: rooms list, active room
  (members+roles, queue, playback, chat), subscribe wiring.
- Screens `mobile/app/jam/{index,create,[id],join}.tsx` + chat sheet +
  reaction bar + host-controls components. Library tab gets a second card
  (below Blend). Guest gate: same BlendGate-shaped component
  (`JamGate`, `blend_enabled`-style flag `jam_enabled`, default off).

## Edge cases

| Case | Behavior |
|---|---|
| Empty room inactivity | hourly cron → `status='expired'` |
| Owner leaves | co_host promoted, else cascade-delete room |
| Member removed / muted | row delete / `muted_until` server-enforced |
| Room closed | realtime status → toast → kicked to list |
| Room full | `fn_join_room` raises `room_member_cap_reached` → 409 |
| Participant mute violation | function rejects (403 `not_permitted`) |
| Track unresolvable | reuse existing player fallback chain locally |
| Guest taps Jam | login gate + flag gate (same as Blend) |
| Version conflict | server state wins, UI re-reconciles |

## Testing & verification

- `test-jam.mjs` (root, `npm test` chain + `mobile/package.json` script):
  skew capture, predicted-position math, correction boundaries, version-gate
  cases (old/equal-duplicate/new), permission matrix, queue ordering — pure,
  headless, fixture-driven.
- Migration + function deploy + cron runbook (dashboard/CLI actions).
- Manual/device: 2-device jam sync (`postgres_changes` latency), reconnect
  (airplane-mode), party host control + listener enforcement, mute/remove,
  owner-leave promotion, expiry cron checks, round-trip chat.
- Gates: `tsc --noEmit` 0 · `eslint` 0 · root `npm test` green; roadmap
  Phase 11 boxes `~` until dashboard deploy + device verification.
