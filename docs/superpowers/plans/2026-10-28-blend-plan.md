# Blend (Phase 10) — Implementation Plan

Builds the feature defined in
`docs/superpowers/specs/2026-10-28-blend-design.md`. Order is chosen so each
step is verifiable on its own: pure logic first, then persistence, then
server, then UI, then wiring.

## 1. Feature flag + types

- [ ] Add `blend_enabled` to `DEFAULT_FEATURE_FLAGS` in
  `mobile/core/featureflags/featureFlags.ts` (default `false`).
- [ ] Add `Blend`, `BlendMember`, `BlendItem`, `TasteSnapshot`, `BlendTrack`
  types following `mobile/types/index.ts` conventions.
- [ ] No new env vars: Supabase public config already exists.

## 2. Snapshot builder (`mobile/core/blend/snapshot.ts`)

- [ ] `buildTasteSnapshot(likedSongs: Song[], playlists: Playlist[])` →
  top 40 songs (count desc, id asc), top 15 artists (summed counts).
- [ ] `fnv1a64Hex(sortedSongIds)` for `library_hash`.
- [ ] Deterministic — same inputs, byte-identical output. No RN imports.

## 3. Scoring & selection (`mobile/core/blend/scoring.ts`)

- [ ] `jaccardPercent(aArtists, bArtists)` — lowercase-normalized sets.
- [ ] `scorePooledTracks(memberSnapshots)` — share 0.6 / pref 0.4 formula.
- [ ] `selectBlendItems(pool, exclusions, memberCount, target=30)` —
  per-member quota `floor(30 ÷ members)`, stable sort (score desc,
  `track_id` asc), positions 0..N-1.
- [ ] Shared constants exported and reused by the Edge Function copy.

## 4. Migration (`supabase/migrations/002_blend.sql`)

- [ ] `blends`, `blend_members`, `blend_items`, `blend_snapshots`,
  `blend_exclusions` per spec (idempotent `create table if not exists`).
- [ ] Indexes: `blend_members(user_id)`, `blend_items(blend_id, position)`.
- [ ] `set_updated_at()` triggers reusing the `001` pattern.
- [ ] Helper `fn_shared_blend_member(viewer, owner)` (security definer).
- [ ] Full RLS policy set per spec; grants to `authenticated` only.
- [ ] Enable `pg_cron` + `pg_net` extensions (schedule runbook goes to the
  deploy checklist, keyed off Vault-stored service key — never inline).

## 5. Client services

- [ ] `mobile/services/blendService.ts` — the only Supabase module for
  blends: list/create/delete blend, member join/leave/remove, invite create/
  rotate, snapshot upsert, items read, add/remove track, manual compute
  trigger via `functions.invoke('blend-compute')`. All errors mapped to
  app-level codes; guest-safe no-ops when Supabase unconfigured.
- [ ] Reuse `core/auth/supabaseClient.ts` boundary — no direct client here.

## 6. Realtime (`mobile/services/blendSync.ts`)

- [ ] `postgres_changes` subscriptions filtered by `blend_id` on `blends`,
  `blend_members`, `blend_items`.
- [ ] Focus-recovery poll of `blend_items.updated_at` as fallback.
- [ ] Zero changes to `roomSync.ts` / Apinator code.

## 7. Store (`mobile/stores/blendStore.ts`)

- [ ] List + active blend slices, member match percentages (Jaccard vs owner),
  compute status, subscribe/unsubscribe wiring through `blendService`.

## 8. Screens (`mobile/app/blend/`)

- [ ] `index.tsx`, `create.tsx`, `[id].tsx`, `join.tsx` per spec table.
- [ ] Contributor badge on items; owner menu (edit/rotate/remove member);
  member actions (add song via existing add-song sheet, remove eligible
  track, leave); share text = deep link + raw code; manual code field.
- [ ] Login gate reuses `(auth)` upsell; routes unreachable while
  `blend_enabled` is off.
- [ ] Profile tab gets the Blend entry button.

## 9. Edge Function (`supabase/functions/blend-compute/`)

- [ ] Deno function: JWT verify → action dispatch → v1 algorithm (copied from
  `scoring.ts`, pinned by parity fixtures) → service-role writes.
- [ ] actions: `compute`, `add_track`, `remove_track` per spec; 409 with
  `missingUserIds` when snapshots absent; 10-member cap enforcement;
  `library_hashes` no-op guard; `compute_status` lifecycle.
- [ ] `supabase/config.toml` entry (functions dir), deploy runbook comment:
  `supabase functions deploy blend-compute` — needs Supabase CLI access
  token, a dashboard/CLI action the repo cannot do silently.

## 10. Daily cron schedule (runbook SQL)

- [ ] Guarded SQL snippet scheduling `blend-daily` at 05:00 UTC posting to
  the function URL with Vault-stored service key — applied once per
  project by the deploy runbook, referenced from the repo checklist.

## 11. Headless tests (`test-blend.mjs` at root)

- [ ] Snapshot builder determinism + hash stability; scoring math (known
  fixture numbers); quota/ordering/eligibility; exclusions filter; invite
  code shape; parity fixtures shared for the Edge Function copy.
- [ ] Append to the root `npm test` chain and `mobile/package.json`
  (`test`, and a standalone `test:blend` script).

## 12. Verify and document

- [ ] Gates: `cd mobile && npx tsc --noEmit` → 0 · `npm run lint` → 0 ·
  root `npm test` green (existing suites untouched).
- [ ] Manual/device pass (CHECKLIST entry): create → invite → 2-device join
  → match % + attributed playlist → add/remove → leave → re-invite.
- [ ] Tick verified Phase 10 boxes in `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md`
  and recalculate its Progress Tracker from real checkbox counts.
- [ ] README/QUICKSTART note: Blend requires Supabase + Edge Function deploy
  steps for self-hosters.

## Execution notes

- Steps 2–3 and 11 are pure logic and can land before any Supabase is
  touched; steps 4–10 are server/wiring; 8 is UI. Nothing ships behind the
  default-off flag until step 12's manual pass.
- Two actions need credentials outside the repo: `supabase functions
  deploy` and applying `002_blend.sql` + the cron schedule SQL (Supabase
  dashboard/CLI).
