-- CFI v5.1 — automatic settlement scheduler.
-- Requires cfi_v5_1_prediction_audit.sql to be applied first.
-- Runs hourly and only settles immutable predictions when an exact canonical
-- fixture with complete HT/FT exists for the same date/home/away identity.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('cfi-prediction-settlement');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'cfi-prediction-settlement',
  '11 * * * *',
  $cron$
    select public.cfi_settle_prediction_snapshots();
  $cron$
);
