-- 004_moderation.sql — Phase 9/2 slice: reports + blocks (+ account deletion RPC)
-- Free-forever app: koi billing table NAHI (ROADMAP Phase 14 out of scope).
-- Design: local-first client (moderationService) reports ko local queue me
-- rakhta hai AUR is table me best-effort push karta hai — table na ho to bhi
-- app chalta hai. RLS: koi sirf APNE reports dekh sakta hai; blocks self-only.

-- ============================================================
-- reports — user-submitted moderation queue (chat message/user/room/song)
-- ============================================================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('message', 'user', 'room', 'song')),
  target_id text not null,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  detail text,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists reports_open_idx on public.reports (status, created_at);

alter table public.reports enable row level security;

-- apne reports — insert + read (moderation dashboard service-role se dekhega)
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- ============================================================
-- user_blocks — local blocklist ka server mirror (DM phase ke liye ready)
-- ============================================================
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "blocks_select_own" on public.user_blocks;
create policy "blocks_select_own" on public.user_blocks
  for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "blocks_insert_own" on public.user_blocks;
create policy "blocks_insert_own" on public.user_blocks
  for insert to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists "blocks_delete_own" on public.user_blocks;
create policy "blocks_delete_own" on public.user_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

-- ============================================================
-- Account deletion (Phase 1 completion) — RPC jo PII clear + status set kare.
-- auth.users row delete ADMIN-only hai (client nahi kar sakta) — isliye
-- profile anonymize karte hain: status 'deleted', PII null, timestamp. App
-- signOut ke baad guest mode me chala jata hai.
-- ============================================================
create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set display_name = null,
         username = null,
         avatar_url = null,
         status = 'deleted',
         updated_at = now()
   where id = auth.uid();

  if not found then
    raise exception 'profile not found for deletion';
  end if;
end;
$$;

-- sirf authenticated caller, sirf apna account
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
