-- 002_blend.sql — Phase 10 Blend (taste-mix shared playlist)
-- blends + blend_members + blend_items + blend_snapshots + blend_exclusions
-- RLS: authentication mandatory; blend_items pe ZERO client writes — sab
-- writes supabase/functions/blend-compute (service role, RLS bypass) se.

-- ============================================================
-- Extensions (periodic recompute ke liye) — vault me service key rakhen
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ============================================================
-- Tables
-- ============================================================
create table if not exists public.blends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  cover_url text,
  visibility text not null default 'members' check (visibility in ('members','public')),
  invite_code text not null unique check (char_length(invite_code) = 8),
  invite_expires_at timestamptz not null default (now() + interval '7 days'),
  algorithm_version text not null default 'v1',
  compute_status text not null default 'pending'
    check (compute_status in ('pending','computing','ready','error')),
  last_computed_at timestamptz,
  library_hashes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blend_members (
  blend_id uuid not null references public.blends (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (blend_id, user_id)
);

create index if not exists blend_members_user_idx on public.blend_members (user_id);

create table if not exists public.blend_items (
  id uuid primary key default gen_random_uuid(),
  blend_id uuid not null references public.blends (id) on delete cascade,
  track_id text not null,
  source_user_id uuid references auth.users (id) on delete set null,
  score numeric not null check (score >= 0 and score <= 1),
  position integer not null check (position >= 0),
  track jsonb not null,
  origin text not null default 'generated' check (origin in ('generated','member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (blend_id, track_id)
);

create index if not exists blend_items_position_idx on public.blend_items (blend_id, position);

create table if not exists public.blend_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snapshot jsonb not null,
  captured_at timestamptz not null default now()
);

create table if not exists public.blend_exclusions (
  id uuid primary key default gen_random_uuid(),
  blend_id uuid not null references public.blends (id) on delete cascade,
  track_id text not null,
  removed_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (blend_id, track_id)
);

-- ============================================================
-- updated_at triggers (001 wala set_updated_at() reuse)
-- ============================================================
drop trigger if exists blends_set_updated_at on public.blends;
create trigger blends_set_updated_at
before update on public.blends
for each row execute function public.set_updated_at();

drop trigger if exists blend_items_set_updated_at on public.blend_items;
create trigger blend_items_set_updated_at
before update on public.blend_items
for each row execute function public.set_updated_at();

-- ============================================================
-- Shared-membership helper (snapshot cross-read ke liye)
-- ============================================================
create or replace function public.fn_shared_blend_member(
  viewer uuid,
  snapshot_owner uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blend_members m_viewer
    join public.blend_members m_owner
      on m_owner.blend_id = m_viewer.blend_id
    where m_viewer.user_id = viewer
      and m_owner.user_id = snapshot_owner
      and viewer <> snapshot_owner
  );
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.blends enable row level security;
alter table public.blend_members enable row level security;
alter table public.blend_items enable row level security;
alter table public.blend_snapshots enable row level security;
alter table public.blend_exclusions enable row level security;

-- helper me security definer queries chalti hain (owner table dekh sake)
grant execute on function public.fn_shared_blend_member(uuid, uuid) to authenticated;

-- ---------- blends ----------
drop policy if exists blends_select_own on public.blends;
create policy blends_select_own
on public.blends for select to authenticated
using (
  exists (
    select 1 from public.blend_members bm
    where bm.blend_id = id and bm.user_id = (select auth.uid())
  )
  or (visibility = 'public')
);

drop policy if exists blends_insert_own on public.blends;
create policy blends_insert_own
on public.blends for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.blend_members bm
    where bm.blend_id = id and bm.user_id = (select auth.uid()) and bm.role = 'owner'
  )
);

drop policy if exists blends_update_owner on public.blends;
create policy blends_update_owner
on public.blends for update to authenticated
using (owner_id = (select auth.uid()));

---------- blend_members ----------
drop policy if exists blend_members_select_blend on public.blend_members;
create policy blend_members_select_blend
on public.blend_members for select to authenticated
using (
  exists (
    select 1 from public.blend_members mine
    where mine.blend_id = blend_id and mine.user_id = (select auth.uid())
  )
);

drop policy if exists blend_members_insert_self on public.blend_members;
-- No client insert policy: joins go through public.fn_join_blend() below —
-- atomic validation (invite valid + unexpired + cap 10) happens there.

drop policy if exists blend_members_delete_mine on public.blend_members;
create policy blend_members_delete_mine
on public.blend_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.blends b
    where b.id = blend_id and b.owner_id = (select auth.uid())
  )
);

---- blend_items (read-only for members) ----
drop policy if exists blend_items_select_blend on public.blend_items;
create policy blend_items_select_blend
on public.blend_items for select to authenticated
using (
  exists (
    select 1 from public.blend_members mine
    where mine.blend_id = blend_id and mine.user_id = (select auth.uid())
  )
);

---- no insert/update/delete policies = RLS deny-all for clients

---- blend_snapshots ----
drop policy if exists blend_snapshots_select_own on public.blend_snapshots;
create policy blend_snapshots_select_own
on public.blend_snapshots for select to authenticated
using (
  user_id = (select auth.uid())
  or public.fn_shared_blend_member((select auth.uid()), user_id)
);

drop policy if exists blend_snapshots_insert_own on public.blend_snapshots;
create policy blend_snapshots_insert_own
on public.blend_snapshots for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists blend_snapshots_update_own on public.blend_snapshots;
create policy blend_snapshots_update_own
on public.blend_snapshots for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

---- blend_exclusions (members read + insert own removals + detele) ----
drop policy if exists blend_exclusions_select_blend on public.blend_exclusions;
create policy blend_exclusions_select_blend
on public.blend_exclusions for select to authenticated
using (
  exists (
    select 1 from public.blend_members mine
    where mine.blend_id = blend_id and mine.user_id = (select auth.uid())
  )
);

drop policy if exists blend_exclusions_insert_mine on public.blend_exclusions;
create policy blend_exclusions_insert_mine
on public.blend_exclusions for insert to authenticated
with check (
  removed_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.blend_members mine
    where mine.blend_id = blend_id and mine.user_id = (select auth.uid())
  )
);

drop policy if exists blend_exclusions_delete_blend on public.blend_exclusions;
create policy blend_exclusions_delete_blend
on public.blend_exclusions for delete to authenticated
using (
  exists (
    select 1 from public.blend_members mine
    where mine.blend_id = blend_id and mine.user_id = (select auth.uid())
  )
);

-- ============================================================
-- Join via invite (security definer RPC — atomic validation)
-- supabase.rpc('fn_join_blend', { p_invite_code: 'XXXXXXXX' })
-- ============================================================
create or replace function public.fn_join_blend(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_blend public.blends;
  v_count int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_blend
  from public.blends
  where upper(invite_code) = upper(coalesce(p_invite_code, ''))
    and invite_expires_at > now()
  limit 1;

  if v_blend is null then
    raise exception 'invite_invalid_or_expired';
  end if;

  select count(*) into v_count from public.blend_members where blend_id = v_blend.id;
  if v_count >= 10 then
    raise exception 'blend_member_cap_reached';
  end if;

  insert into public.blend_members (blend_id, user_id, role)
  values (v_blend.id, v_user, 'member')
  on conflict (blend_id, user_id) do nothing;

  return v_blend.id;
end;
$$;

grant execute on function public.fn_join_blend(text) to authenticated;

-- Invite codes are UPPER alnum only — client generator is the source.
-- (Honest limit: brute-force stops at DB-level uniqueness checks, codes
-- are 8 chars over a 31-char alphabet — ~850B search space, do not rely
-- on this alone for capture prevention.)

-- ============================================================
-- Grants (Data API exposure explicit — 001 jaisa hi)
-- ============================================================
grant select, insert, update, delete on public.blends to authenticated;
grant select, insert, update, delete on public.blend_members to authenticated;
grant select on public.blend_items to authenticated;
grant select, insert, update on public.blend_snapshots to authenticated;
grant select, insert, delete on public.blend_exclusions to authenticated;
