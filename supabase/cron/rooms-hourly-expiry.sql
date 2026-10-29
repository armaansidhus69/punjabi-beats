-- Runbook: Room hourly expiry (APPLY ONCE, manual — Supabase SQL editor)
-- Spec: rooms `status='active'` jinke kisi member ka last_seen_at 2h+
-- purana hai → 'expired'. Room data history ke liye RLS ke through
-- members read kar sakte hain (closure ke baad bhi).
--
-- Steps:
--   1. Service key Vault me:
--        select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'rooms_cron_service_key');
--   2. Niche snippet (project-ref replace karo).
--
-- Krux: petabytes of presence writes nahi — sirf status flip. Straight SQL
-- ho sakta hai bina function ke; pg_net + Edge Function NOT required yahan.
-- Simplest + robust = pure SQL (room-control function se alag rakhna bhi theek
-- hai — auth gate bypass hota hai via definer table update).
--
-- ---------- 1) Expired stale rooms (hourly) ----------
select cron.schedule(
  'rooms-hourly-expiry',
  '0 * * * *',
  $$
  update public.rooms r
  set status = 'expired', updated_at = now()
  where r.status = 'active'
    and not exists (
      select 1 from public.room_members m
      where m.room_id = r.id
        and m.last_seen_at > now() - interval '2 hours'
    );
  $$
);

-- ---------- 2) Optional: playback state reset for expired rooms ----------
-- (natural-degree cleanup — chahiye to uncomment; v1 me skip, history-safe)
-- select cron.schedule(
--   'rooms-hourly-expiry-cleanup',
--   '5 * * * *',
--   $$
--   update public.room_playback_state p
--   set is_playing = false
--   from public.rooms r
--   where p.room_id = r.id and r.status in ('expired','closed') and p.is_playing;
--   $$
-- );

-- ---------- 3) Teardown ----------
-- select cron.unschedule('rooms-hourly-expiry');
