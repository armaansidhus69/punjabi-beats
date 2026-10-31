-- supabase/migrations/20261031_syncroom.sql
-- SyncRoom tables + RLS + basic RPCs
-- Assumes you already have auth.users and profiles

create extension if not exists "pgcrypto";

-- Rooms
create table if not exists public.sync_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  privacy text not null default 'invite_only' check (privacy in ('invite_only', 'approval_required')),
  queue_mode text not null default 'fair_turns',
  host_id uuid not null references auth.users(id) on delete cascade,
  cohost_ids uuid[] not null default '{}',
  max_members int not null default 10 check (max_members between 2 and 32),
  is_locked boolean not null default false,
  invite_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sync_rooms_host_idx on public.sync_rooms(host_id);
create index if not exists sync_rooms_invite_code_idx on public.sync_rooms(invite_code);

-- Members (presence)
create table if not exists public.sync_room_members (
  room_id uuid not null references public.sync_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('host', 'cohost', 'member')),
  status text not null default 'connecting',
  is_ready boolean not null default false,
  device_id text,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists sync_room_members_user_idx on public.sync_room_members(user_id);

-- Fair queue
create table if not exists public.sync_room_queue (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.sync_rooms(id) on delete cascade,
  track_id text not null,
  title text not null,
  artist text not null,
  album_art text,
  duration_ms int not null check (duration_ms > 0),
  added_by uuid not null references auth.users(id),
  position int not null,          -- fair-turn ordering
  created_at timestamptz not null default now(),
  unique (room_id, position)
);

create index if not exists sync_room_queue_room_pos_idx on public.sync_room_queue(room_id, position);

-- Playback anchor (single row per room)
create table if not exists public.sync_room_playback (
  room_id uuid primary key references public.sync_rooms(id) on delete cascade,
  track_id text,
  current_item_id uuid references public.sync_room_queue(id) on delete set null,
  status text not null default 'paused' check (status in ('playing', 'paused', 'ended')),
  anchor_position_ms int not null default 0,
  anchor_server_time timestamptz not null default now(),
  state_version bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Skip votes (ephemeral, cleaned on track change)
create table if not exists public.sync_room_skip_votes (
  room_id uuid not null references public.sync_rooms(id) on delete cascade,
  track_id text not null,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, track_id, voter_id)
);

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_rooms_updated_at on public.sync_rooms;
create trigger sync_rooms_updated_at
  before update on public.sync_rooms
  for each row execute function public.set_updated_at();

drop trigger if exists sync_room_playback_updated_at on public.sync_room_playback;
create trigger sync_room_playback_updated_at
  before update on public.sync_room_playback
  for each row execute function public.set_updated_at();

-- RLS
alter table public.sync_rooms enable row level security;
alter table public.sync_room_members enable row level security;
alter table public.sync_room_queue enable row level security;
alter table public.sync_room_playback enable row level security;
alter table public.sync_room_skip_votes enable row level security;

-- Policies
drop policy if exists "members can read rooms they belong to" on public.sync_rooms;
create policy "members can read rooms they belong to"
  on public.sync_rooms for select
  using (
    exists (
      select 1 from public.sync_room_members m
      where m.room_id = id and m.user_id = auth.uid()
    )
  );

drop policy if exists "host can update room" on public.sync_rooms;
create policy "host can update room"
  on public.sync_rooms for update
  using (host_id = auth.uid() or auth.uid() = any(cohost_ids));

drop policy if exists "authenticated can create room" on public.sync_rooms;
create policy "authenticated can create room"
  on public.sync_rooms for insert
  with check (auth.uid() = host_id);

drop policy if exists "members read members" on public.sync_room_members;
create policy "members read members"
  on public.sync_room_members for select
  using (
    exists (
      select 1 from public.sync_room_members m
      where m.room_id = sync_room_members.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "user can update own member row" on public.sync_room_members;
create policy "user can update own member row"
  on public.sync_room_members for update
  using (user_id = auth.uid());

drop policy if exists "members read queue" on public.sync_room_queue;
create policy "members read queue"
  on public.sync_room_queue for select
  using (
    exists (
      select 1 from public.sync_room_members m
      where m.room_id = sync_room_queue.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "members insert queue" on public.sync_room_queue;
create policy "members insert queue"
  on public.sync_room_queue for insert
  with check (
    exists (
      select 1 from public.sync_room_members m
      where m.room_id = room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "members read playback" on public.sync_room_playback;
create policy "members read playback"
  on public.sync_room_playback for select
  using (
    exists (
      select 1 from public.sync_room_members m
      where m.room_id = sync_room_playback.room_id and m.user_id = auth.uid()
    )
  );

-- RPC: create room + host member + empty playback
create or replace function public.create_sync_room(
  p_name text,
  p_privacy text default 'invite_only',
  p_max_members int default 10
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  insert into public.sync_rooms (name, privacy, host_id, max_members, invite_code)
  values (p_name, p_privacy, auth.uid(), p_max_members, v_code)
  returning id into v_room_id;

  insert into public.sync_room_members (room_id, user_id, role, status, is_ready)
  values (v_room_id, auth.uid(), 'host', 'ready', true);

  insert into public.sync_room_playback (room_id, status)
  values (v_room_id, 'paused');

  return v_room_id;
end;
$$;

-- RPC: join by invite code
create or replace function public.join_sync_room(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.sync_rooms%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_room from public.sync_rooms
  where invite_code = upper(p_invite_code) and not is_locked;

  if not found then
    raise exception 'room not found or locked';
  end if;

  select count(*) into v_count from public.sync_room_members where room_id = v_room.id;
  if v_count >= v_room.max_members then
    raise exception 'room full';
  end if;

  insert into public.sync_room_members (room_id, user_id, role, status)
  values (v_room.id, auth.uid(), 'member', 'connecting')
  on conflict (room_id, user_id) do update set last_seen_at = now();

  return v_room.id;
end;
$$;

-- Helper: next fair position (round-robin style)
create or replace function public.next_fair_queue_position(p_room_id uuid, p_user_id uuid)
returns int
language plpgsql
as $$
declare
  v_pos int;
begin
  select coalesce(max(position), 0) + 1 into v_pos
  from public.sync_room_queue where room_id = p_room_id;
  return v_pos;
end;
$$;

