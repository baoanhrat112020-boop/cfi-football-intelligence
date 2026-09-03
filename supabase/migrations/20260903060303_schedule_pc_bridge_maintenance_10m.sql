do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='cfi-pc-bridge-maintenance-10m' loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'cfi-pc-bridge-maintenance-10m',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-pc-bridge-maintenance',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cfi-forward-token',(select token from public.cfi_forward_automation_auth where singleton=true)
    ),
    body := '{"maxPending":30}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
