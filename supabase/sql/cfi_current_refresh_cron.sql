-- CFI v2.0C scheduler template.
-- One-time prerequisite in Supabase Vault (do NOT commit real values):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/cfi-current-refresh', 'CFI_CURRENT_REFRESH_URL');
--   select vault.create_secret('<CFI_ACTION_KEY>', 'CFI_ACTION_KEY');
--
-- The schedule below runs every 6 hours at minute 17. Re-running this file
-- replaces the named schedule without changing canonical/upsert semantics.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('cfi-current-season-refresh');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'cfi-current-season-refresh',
  '17 */6 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'CFI_CURRENT_REFRESH_URL'
      limit 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cfi-key', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CFI_ACTION_KEY'
        limit 1
      )
    ),
    body := '{"concurrency":3}'::jsonb
  );
  $cron$
);
