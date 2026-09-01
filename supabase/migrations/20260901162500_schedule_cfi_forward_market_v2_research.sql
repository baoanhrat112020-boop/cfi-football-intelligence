-- Research-only forward market V2 scheduler.
-- Reads auth at runtime; no secret is committed. Does not call V1 or canonical upsert.
create or replace function public.cfi_run_forward_market_v2_automation()
returns bigint
language plpgsql
security definer
set search_path to 'public','net','pg_temp'
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select token::text into v_token
  from public.cfi_forward_automation_auth
  where singleton=true;
  if v_token is null then
    raise exception 'CFI_FORWARD_AUTOMATION_TOKEN_MISSING';
  end if;
  select net.http_post(
    url := 'https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-forward-market-v2',
    headers := jsonb_build_object('content-type','application/json','x-cfi-forward-token',v_token),
    body := '{"action":"RUN"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;
  return v_request_id;
end;
$$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cfi-forward-market-v2-research-4h';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'cfi-forward-market-v2-research-4h',
    '41 */4 * * *',
    'select public.cfi_run_forward_market_v2_automation();'
  );
end;
$$;
