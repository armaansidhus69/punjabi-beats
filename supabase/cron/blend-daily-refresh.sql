-- Runbook: Blend daily recompute schedule (APPLY ONCE, manual_)
-- 002_blend.sql pg_cron+pg_net enable karta hai; yahan sirf schedule.
--
-- Steps (Supabase SQL editor):
--   1. Service key kis archana? Vault me rakho:
--        select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'blend_cron_service_key');
--   2. Phir niche ke snippets. URL me project-ref replace karo.
--
-- Honest notes:
--  - Function URL khud ka anon key header chahiye (Edge Function anon role).
--  - pg_net call headers me service_role DIRECT na rakhna zarur na ho to
--    vault se read via vault.decrypted_secrets — niche straightforward inline
--    variant bhi hai (sirf private projects ke liye recommended).

-- ---------- 1) Schedule (vault variant, recommended) ----------
do $$
declare
  v_secret text;
begin
  -- agar secret abhi create nahi hua, yahan error aayega — pehle create karo
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'blend_cron_service_key';

  if not exists (select 1 from cron.job where jobname = 'blend-daily-refresh') then
    perform cron.schedule(
      'blend-daily-refresh',
      '0 5 * * *',
      $cron$
      select net.http_post(
        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/blend-compute',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'blend_cron_service_key'),
          'apiKey', (select decrypted_secret from vault.decrypted_secrets where name = 'blend_cron_service_key')
        ),
        body := jsonb_build_object('action', 'compute')
      );
      $cron$
    );
  end if;
end $$;

-- ---------- 2) Teardown (agar ke restart karna ho) ----------
-- select cron.unschedule('blend-daily-refresh');
