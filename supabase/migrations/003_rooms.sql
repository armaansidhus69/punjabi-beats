-- 003_rooms.sql — Phase 11 Jam + Listening Party (server-authoritative rooms)
-- rooms + room_members + room_playback_state + room_queue_items + room_messages
-- Trust model: playback/queue/rooms NO client writes — sab mutations
-- supabase/functions/room-control (service role, version bumps) se.
-- Client writes sirf: fn_join_room RPC (join), self-leave delete, own chat insert.
-- pg_cron/pg_net/pgcrypto pehle se on (002) — kuch naya enable nahi.

-- ============================================================
-- Tables
-- ============================================================
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('jam','listening_party')),
  title text not null check (char_length(title) between 1 and 80),
  cover_url text,
  visibility text not null default 'private_invite'
    check (visibility in ('private_invite','public')),
  invite_code text not null unique check (char_length(invite_code) = 8),
  max_participants integer not null default 8
    check (max_participants between 2 and 100),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  status text not null default 'active'
    check (status in ('active','paused','closed','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_window_valid
    check (scheduled_end is null or scheduled_start is null
           or scheduled_end > scheduled_start)
);

create index if not exists rooms_owner_idx on public.rooms (owner_id);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'participant'
    check (role in ('owner','co_host','moderator','participant','listener')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  muted_until timestamptz,
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);
create index if not exists room_members_seen_idx on public.room_members (room_id, last_seen_at);

-- ONE row per room (upserted by room-control) — state authority
create table if not exists public.room_playback_state (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  track_id text,
  track jsonb,
  position_ms integer not null default 0 check (position_ms >= 0),
  is_playing boolean not null default false,
  queue_version integer not null default 0,
  state_version integer not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  track_id text not null,
  track jsonb not null,
  added_by uuid references auth.users (id) on delete set null,
  position integer not null check (position >= 0),
  -- null = pending; set = consumed (track may re-enter later — no unique)
  played_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists room_queue_room_pos_idx on public.room_queue_items (room_id, position);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null default 'chat' check (kind in ('chat','reaction_log','system')),
  body text not null check (char_length(body) between 1 and 500),
  track_id text,
  reply_to_id uuid references public.room_messages (id) on delete set null,
  -- server-side history cap: UI reads newest 200 per room (v1 read policy)
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room_time_idx on public.room_messages (room_id, created_at desc);

-- ============================================================
-- updated_at triggers (001/002 wala set_updated_at() reuse)
-- ============================================================
drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

-- ============================================================
-- Join via invite (security definer RPC — atomic validation; mirrors
-- fn_join_blend). Party participants 'listener' bante hain v1 me.
-- ============================================================
create or replace function public.fn_join_room(p_invite_code text, p_room_type_hint text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_count int;
  v_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_room
  from public.rooms
  where upper(invite_code) = upper(coalesce(p_invite_code, ''))
    and status = 'active'
  limit 1;

  if v_room is null then
    raise exception 'room_invalid_or_closed';
  end if;

  select count(*) into v_count from public.room_members where room_id = v_room.id;
  if v_count >= v_room.max_participants then
    raise exception 'room_member_cap_reached';
  end if;

  -- role default: jam → participant; party → listener (v1 rule)
  v_role := case when v_room.type = 'jam' then 'participant' else 'listener' end;
  -- (p_room_type_hint intentionally unused in v1 — keep for future BYOR games)

  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, v_user, v_role)
  on conflict (room_id, user_id) do nothing;

  return v_room.id;
end;
$$;

grant execute on function public.fn_join_room(text, text) to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_playback_state enable row level security;
alter table public.room_queue_items enable row level security;
alter table public.room_messages enable row level security;

-- ---------- rooms: members + one-line public preview ----------
drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member
on public.rooms for select to authenticated
using (
  exists (
    select 1 from public.room_members m
    where m.room_id = id and m.user_id = (select auth.uid())
  )
  or visibility = 'public'
);

-- update: NO client policy — status/role changes via room-control only.

-- ---------- room_members: member read, self-join RPC only, self-leave delete ----------
drop policy if exists room_members_select_member on public.room_members;
create policy room_members_select_member
on public.room_members for select to authenticated
using (
  exists (
    select 1 from public.room_members mine
    where mine.room_id = room_id and mine.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.rooms r
    where r.id = room_id and r.visibility = 'public'
  )
);

-- No client INSERT policy — fn_join_room (definer) hi insert karta hai.

drop policy if exists room_members_delete_self on public.room_members;
create policy room_members_delete_self
on public.room_members for delete to authenticated
using (user_id = (select auth.uid()));

-- No UPDATE policy — heartbeat/roles/mutes via room-control only.

-- ---------- room_playback_state: member read-only ----------
drop policy if exists room_playback_select_member on public.room_playback_state;
create policy room_playback_select_member
on public.room_playback_state for select to authenticated
using (
  exists (
    select 1 from public.room_members mine
    where mine.room_id = room_id and mine.user_id = (select auth.uid())
  )
);

-- No INSERT/UPDATE/DELETE client policies — room-control (service role) only.

-- ---------- room_queue_items: member read-only ----------
drop policy if exists room_queue_select_member on public.room_queue_items;
create policy room_queue_select_member
on public.room_queue_items for select to authenticated
using (
  exists (
    select 1 from public.room_members mine
    where mine.room_id = room_id and mine.user_id = (select auth.uid())
  )
);

-- No write policies — room-control only.

-- ---------- room_messages: member read + own chat insert (fast path) ----------
drop policy if exists room_messages_select_member on public.room_messages;
create policy room_messages_select_member
on public.room_messages for select to authenticated
using (
  exists (
    select 1 from public.room_members mine
    where mine.room_id = room_id and mine.user_id = (select auth.uid())
  )
);

drop policy if exists room_messages_insert_own_chat on public.room_messages;
create policy room_messages_insert_own_chat
on public.room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and kind in ('chat','reaction_log')
  and exists (
    select 1 from public.room_members mine
    where mine.room_id = room_id and mine.user_id = (select auth.uid())
    -- mute gate: muted_until null ya past ho tabhi insert
    and (mine.muted_until is null or mine.muted_until <= now())
  )
);

-- delete/update: moderation path only (no client policy).

-- ============================================================
-- Grants (Data API exposure explicit — 002 jaisa hi)
-- ============================================================
grant select on public.rooms to authenticated;
grant select, delete on public.room_members to authenticated;
grant select on public.room_playback_state to authenticated;
grant select on public.room_queue_items to authenticated;
grant select, insert on public.room_messages to authenticated;

-- Invite alphabet note (reuse): codes UPPER `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
-- se client generation hoti hai (I/L/0/1 skip) — blendService jaisa hi.
