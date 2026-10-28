# Punjabi Beats — Blend (Phase 10)

## Status

Design approved in chat on October 28, 2026. This document defines the Blend
feature (social taste-mix playlist) before implementation begins. Phase 11
(Jam / listening rooms) is a separate follow-up spec.

## Goal

Two or more logged-in members merge their music taste into a shared,
periodically-refreshed playlist with per-member attribution and a pair-level
taste-match percentage. Members join via shareable invite links, see songs
from each person explicitly attributed, and can add/remove eligible tracks.

## Non-goals for this slice

- Play-history signals as taste input (Phase 13 data foundation).
- Cross-provider track-id matching (JioSaavn ids treated as canonical).
- https/universal invite links (scheme link + manual code only; no web host).
- Story-card image generation (share text/link only for v1).
- Firebase-style notifications (Phase 16).
- Realtime reconnection protocol rework (belongs to Phase 11).

## Existing constraints (carried over)

- Expo SDK 51 / React Native / Expo Router / Zustand / AsyncStorage.
- Supabase auth foundation exists (`mobile/core/auth/`, `app/(auth)/`).
  Guests have no auth session; every blend surface requires login and shows
  the existing login upsell otherwise.
- Supabase RLS pattern and migration style come from
  `supabase/migrations/001_profiles_devices.sql`.
- Screens render only; logic lives in `stores/` or `services/`.
  Comments in Hinglish. TypeScript strict, no `any`.
- Root-level Node tests are headless (no network, no native deps) and run
  against `mobile/**/*.ts` via Node type stripping.
- Supabase service-role credentials never ship in the client bundle.

## Architecture decisions

1. **Compute runs in a Supabase Edge Function** (`blend-compute`), not on the
   client or Vercel. Data, auth, and compute live on one platform; scoring
   consistency is versioned server-side.
2. **Snapshot pool pattern**: each member's device uploads a compact taste
   snapshot; the Edge Function pools members' snapshots to compute scores and
   the shared playlist. Track metadata is denormalized into `blend_items`
   (`track jsonb`) so the playlist renders and resolves playback without
   fresh provider calls.
3. **Realtime via Supabase Realtime `postgres_changes`** on the blend tables.
   Apinator stays dedicated to room sync (Phase 11 domain).
4. **Zero client writes to `blend_items`**: all item writes go through the
   Edge Function (service role). RLS grants members read-only.
5. **Periodic updates**: daily pg_cron recompute + event recompute on
   membership change or manual add/remove, with a `library_hash` no-op guard.

## Data model (`supabase/migrations/002_blend.sql`)

```text
blends
  id uuid pk default gen_random_uuid()
  owner_id uuid not null references auth.users(id) on delete cascade
  name text not null
  cover_url text
  visibility text not null default 'members'   -- 'members' | 'public'
  invite_code text unique not null             -- 8 chars, crypto-random
  invite_expires_at timestamptz not null       -- +7d on create/rotate
  algorithm_version text not null default 'v1'
  compute_status text not null default 'pending'  -- pending|computing|ready|error
  last_computed_at timestamptz
  library_hashes jsonb               -- per-user library_hash at last compute
  created_at / updated_at timestamptz not null default now()

blend_members
  blend_id uuid -> blends(id) on delete cascade
  user_id uuid -> auth.users(id) on delete cascade
  role text not null default 'member'          -- 'owner' | 'member'
  joined_at timestamptz not null default now()
  pk (blend_id, user_id)

blend_items
  id uuid pk default gen_random_uuid()
  blend_id uuid -> blends(id) on delete cascade
  track_id text not null                       -- provider song id (canonical)
  source_user_id uuid references auth.users(id) on delete set null
  score numeric not null
  position integer not null
  track jsonb not null  -- { title, artistNames[], artworkUrl, provider,
                        --   durationSec, playableFull bool }
  origin text not null default 'generated'     -- 'generated' | 'member'
  created_at / updated_at
  unique (blend_id, track_id)

blend_snapshots
  user_id uuid pk references auth.users(id) on delete cascade
  snapshot jsonb not null
  captured_at timestamptz not null default now()

blend_exclusions                                -- removal tombstones
  id uuid pk default gen_random_uuid()
  blend_id uuid -> blends(id) on delete cascade
  track_id text not null
  removed_by_user_id uuid references auth.users(id) on delete set null
  created_at timestamptz not null default now()
  unique (blend_id, track_id)
```

Notes:

- `blend_exclusions` exists because recompute without tombstones would
  resurrect every removed track daily.
- Member cap (10) is enforced by the Edge Function at join and recompute.
- `blend_members.role` stays in sync: the blend creator gets `'owner'`.
- All tables have RLS enabled; only `authenticated` gets grants.

### RLS summary

- `blend_snapshots`: users select/update/insert **their own row only**.
  Co-members of a blend can read a member's snapshot via a `security definer`
  helper `fn_shared_blend_member(viewer uuid, snapshot_owner uuid)`
  returning true iff both are active members of some blend. Strangers cannot
  read taste data even with a known UUID.
- `blend_items`: members of the blend can select; **no client-side insert/update/delete**
  (Edge Function uses the service role, which bypasses RLS).
- `blend_exclusions`: members can select; insert allowed for their own
  removals; delete by blend members (so items can be re-allowed later).
- `blends`: members (or public visibility blends) can select; only the owner
  can update name/cover/visibility/invite fields.
- `blend_members`: blend members can select; a user can insert themselves
  only (guard: valid, unexpired invite code, no owner-role forging, caller
  not already at the 10-member cap); delete self or owner-deletes-others.

## Snapshot format (v1)

Built on-device from `likedSongsStore` + `playlistStore` (no play history):

```jsonc
{
  "version": 1,
  "library_hash": "fnv1a-64 hex over the sorted song-id list",
  "songs": [            // top 40, deterministic: count desc, then id asc
    {
      "id": "jiosaavn-canonical-song-id",
      "title": "…",
      "artistNames": ["…"],
      "artworkUrl": "https://…",
      "provider": "saavn",
      "durationSec": 213,
      "playableFull": true,
      "count": 3        // occurrences across likes + playlists
    }
  ],
  "artists": [          // top 15 by summed song counts, name-normalized
    { "name": "diljit dosanjh", "count": 9 }
  ]
}
```

Devices upsert their own row directly (`blend_snapshots` RLS covers it);
no dedicated Edge Function needed for upload. The same snapshot serves all
the user's blends.

## Edge Function (`supabase/functions/blend-compute/`)

Invoked with `supabase.functions.invoke('blend-compute', { body })`. Caller
JWT is verified; actions are authorized per blend membership. Writes use the
service role internally.

### Actions

- `{ type: "compute", blendId }` — member-triggerable; also invoked by cron.
- `{ type: "add_track", blendId, track }` — validates resolvable playable
  track, writes `origin='member'`, `source_user_id = caller`, then recompute.
- `{ type: "remove_track", blendId, trackId }` — generated item → insert
  `blend_exclusions` row; `origin='member'` item → delete the row directly
  (manual adds are never regenerated). Then recompute.

### Recompute algorithm `v1`

1. Load blend, active members (cap 10), each member's snapshot. Any member
   missing a snapshot → 409 with `{ missingUserIds: [...] }`; their clients
   show "waiting for taste sync". Status stays non-`ready`.
2. Pairwise match % = Jaccard similarity of artist-name sets
   (lowercase-normalized): `|A∩B| / |A∪B|`, rounded to whole percent.
   Displayed per member vs the blend owner.
3. Pool = all snapshot songs collapsed by canonical `track_id`. For track t:
   - `share(t)` = members having t ÷ member count
   - `pref(t)` = mean over members having t of
     `count_m(t) ÷ maxCount_m(m)` (per-member normalized strength)
   - `score(t) = 0.6 × share(t) + 0.4 × pref(t)`
4. Eligible = `playableFull` true and not in `blend_exclusions`.
5. Target 30 items. **Per-member quota**: each member gets at least
   `floor(30 ÷ memberCount)` slots as top contributor (highest count among
   members having that track). Remaining slots fill by score desc.
   Ordering is deterministic: score desc, tie-break `track_id` asc.
   Positions are 0..N-1.
6. Writes: replace generated items atomically (delete all `origin='generated'`
   rows, insert new pool), keep `origin='member'` rows with recalculated
   position/score fields where applicable, bump `last_computed_at`, set
   `compute_status='ready'`.
7. **No-op guard**: if every member's snapshot `library_hash` matches what
   produced the current `blend_items` (stored as `library_hashes jsonb` on
   `blends` at each successful compute), a `compute` action is skipped.

Manual adds affect the member count math only via memberCount quotas; they
are appended with `score` computed as their best quota-fit estimate and get
positions after the next recompute finishes.

### Cron

Enable `pg_cron` + `pg_net` extensions in `002_blend.sql`. Schedule once (SQL
runbook, guarded with `if not exists` semantics via a check of
`cron.job`), daily at 05:00 UTC POST to the function URL with the service
key + `service_role` JWT. Key is stored via Supabase Vault, not inline SQL.

## Client architecture

### Layout

- `mobile/core/blend/snapshot.ts` — build stable snapshot from liked+playlist
  stores; deterministic ordering; `library_hash` via FNV-1a 64.
- `mobile/core/blend/scoring.ts` — TS mirror of the v1 algorithm (Jaccard,
  pool scoring, quota selection) used by headless parity tests; the Edge
  Function keeps an identical copy — **parity fixtures in `test-blend.mjs`
  are the contract** (`algorithm_version` must bump when either copy changes).
- `mobile/services/blendService.ts` — only Supabase-touching module for
  blends: CRUD via `core/auth/supabaseClient.ts`, `functions.invoke`,
  invite-code generation/validation helpers.
- `mobile/services/blendSync.ts` — Realtime subscription manager
  (`postgres_changes` on `blends`/`blend_members`/`blend_items` filtered by
  blend id), so `roomSync.ts` remains untouched.
- `mobile/stores/blendStore.ts` — zustand: blends list, active blend,
  members + match %, items, `computeStatus`, subscribe/unsubscribe actions.

### Screens (Expo Router, entry button on the Profile tab)

| Route | Purpose |
|---|---|
| `app/blend/index.tsx` | My Blends list + Create CTA |
| `app/blend/create.tsx` | Name + visibility + submit → create blend → snapshot upload → first compute |
| `app/blend/[id].tsx` | Detail: member chips with match %, shared playlist with per-song contributor badge, owner menu (edit name/cover modal, rotate invite, remove member), member actions (add track via existing add-song search sheet, remove eligible track, leave), share |
| `app/blend/join.tsx` | Deep-link target (`punjabi-beats://blend/join?code=XXXXXXXX`); blend preview + join; manual code field; login gate routes to existing `(auth)` flow first |

### Sync & refresh UX

- Realtime events drive the store; membership changes and manual add/remove
  trigger `blend-compute`.
- `compute_status` surfaces as "updating your blend…" / error + retry.
- Fallback: poll `blend_items.updated_at` on app focus when the Realtime
  channel is unhealthy.
- Invite share text = deep link + raw 8-char code (messenger-safe).

## Gating & edge cases

| Case | Behavior |
|---|---|
| Guest opens any blend route | Login upsell panel; `blend_enabled` feature flag (default off in prod) gates routing |
| Member has no snapshot yet | Join succeeds; blend stays non-`ready` with "waiting for X's taste sync" |
| Owner leaves blend | Blend cascades away (owner is last member case: rows delete) |
| Owner removes a member | Their exclusions remain; their items drop at next recompute |
| Thin library | Low match %, UI nudge to like/play more music; blend still generates |
| Invite expired | Join screen shows expired state; owner sees "regenerate invite" |
| Compute error | Last good items remain visible + retry |
| Solo blend (1 member) | Match % vs owner shown as 100%; playlist = own top tracks |

## Testing & verification

- `test-blend.mjs` (root, in `npm test` chain + `mobile/package.json`):
  snapshot determinism + `library_hash` stability, Jaccard/scoring math,
  quota selection, exclusion filtering, invite-code shape, ordering/tie-breaks
  — all pure, fixture-driven, headless. Parity fixtures pin the Edge
  Function copy's behavior.
- Migration `002_blend.sql` applied via Supabase (runbook snippet in plan).
- Manual/device tests (tracked in CHECKLIST): create → invite → 2-device
  join → match % + cross-member playlist visible → manual add/remove →
  leave → re-invite.
- Gates: `cd mobile && npx tsc --noEmit` 0 errors · `npm run lint` 0 warnings
  · root `npm test` green (per AGENTS.md).
- After implementation: tick Phase 10 boxes in
  `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` and recalculate its
  Progress Tracker from actual checkbox counts.
