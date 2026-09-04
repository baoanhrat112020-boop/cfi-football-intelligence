create table if not exists public.cfi_daily_prediction_audit_runs (
  run_id uuid primary key default gen_random_uuid(),
  target_date date not null,
  selected_count integer not null,
  settled_count integer not null,
  pending_count integer not null,
  coverage numeric not null,
  status text not null check (status in ('NO_PREDICTIONS','COMPLETE','PARTIAL','BLOCKED')),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.cfi_daily_prediction_audit_runs enable row level security;
revoke all on public.cfi_daily_prediction_audit_runs from public, anon, authenticated;
grant select, insert on public.cfi_daily_prediction_audit_runs to service_role;

create index if not exists cfi_daily_prediction_audit_runs_date_created_idx
  on public.cfi_daily_prediction_audit_runs(target_date, created_at desc);

create or replace view public.cfi_daily_prediction_audit_latest
with (security_invoker=true) as
select distinct on (target_date)
  run_id,target_date,selected_count,settled_count,pending_count,coverage,status,metrics,created_at
from public.cfi_daily_prediction_audit_runs
order by target_date, created_at desc;
revoke all on public.cfi_daily_prediction_audit_latest from public, anon, authenticated;
grant select on public.cfi_daily_prediction_audit_latest to service_role;

create or replace function public.cfi_capture_daily_prediction_audit(
  p_target_date date default (((now() at time zone 'Asia/Ho_Chi_Minh')::date) - 1)
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_selected integer;
  v_settled integer;
  v_pending integer;
  v_coverage numeric;
  v_status text;
  v_metrics jsonb;
  v_run uuid;
begin
  select
    count(*) filter (where selected_for_match_audit),
    count(*) filter (where selected_for_match_audit and settlement_status='SETTLED'),
    count(*) filter (where selected_for_match_audit and settlement_status='PENDING')
  into v_selected,v_settled,v_pending
  from public.cfi_prediction_evaluation
  where target_date=p_target_date;

  v_selected := coalesce(v_selected,0);
  v_settled := coalesce(v_settled,0);
  v_pending := coalesce(v_pending,0);
  v_coverage := case when v_selected=0 then 1 else v_settled::numeric/v_selected end;
  v_status := case
    when v_selected=0 then 'NO_PREDICTIONS'
    when v_settled=v_selected then 'COMPLETE'
    when v_settled=0 then 'BLOCKED'
    else 'PARTIAL'
  end;

  select jsonb_build_object(
    'marketOutcomes', jsonb_build_object(
      '3+ HT', jsonb_build_object('hit',count(*) filter(where outcome_3plus_ht='HIT'),'miss',count(*) filter(where outcome_3plus_ht='MISS')),
      '7+ FT', jsonb_build_object('hit',count(*) filter(where outcome_7plus_ft='HIT'),'miss',count(*) filter(where outcome_7plus_ft='MISS')),
      'Other HT', jsonb_build_object('hit',count(*) filter(where outcome_other_ht='HIT'),'miss',count(*) filter(where outcome_other_ht='MISS')),
      'Other FT', jsonb_build_object('hit',count(*) filter(where outcome_other_ft='HIT'),'miss',count(*) filter(where outcome_other_ft='MISS'))
    ),
    'meanBrier', avg(mean_brier),
    'top1HT', jsonb_build_object('hit',count(*) filter(where top1_ht_hit is true),'miss',count(*) filter(where top1_ht_hit is false)),
    'top1FT', jsonb_build_object('hit',count(*) filter(where top1_ft_hit is true),'miss',count(*) filter(where top1_ft_hit is false)),
    'top3HT', jsonb_build_object('hit',count(*) filter(where top3_ht_hit is true),'miss',count(*) filter(where top3_ht_hit is false)),
    'top3FT', jsonb_build_object('hit',count(*) filter(where top3_ft_hit is true),'miss',count(*) filter(where top3_ft_hit is false)),
    'strongSignals', count(*) filter(where verdict='STRONG_SIGNAL'),
    'settledRows', count(*)
  ) into v_metrics
  from public.cfi_prediction_evaluation
  where target_date=p_target_date
    and selected_for_match_audit=true
    and settlement_status='SETTLED';

  insert into public.cfi_daily_prediction_audit_runs(target_date,selected_count,settled_count,pending_count,coverage,status,metrics)
  values(p_target_date,v_selected,v_settled,v_pending,v_coverage,v_status,coalesce(v_metrics,'{}'::jsonb))
  returning run_id into v_run;

  return jsonb_build_object('status','OK','runId',v_run,'targetDate',p_target_date,'selected',v_selected,'settled',v_settled,'pending',v_pending,'coverage',v_coverage,'auditStatus',v_status,'metrics',v_metrics);
end;
$$;
revoke execute on function public.cfi_capture_daily_prediction_audit(date) from public, anon, authenticated;
grant execute on function public.cfi_capture_daily_prediction_audit(date) to service_role;

insert into public.cfi_scheduler_tokens(token_name,token)
select 'calibration_learning', gen_random_uuid()::text || gen_random_uuid()::text
where not exists (select 1 from public.cfi_scheduler_tokens where token_name='calibration_learning');

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='cfi-prediction-daily-audit-hourly' loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;
select cron.schedule(
  'cfi-prediction-daily-audit-hourly',
  '16 * * * *',
  $cron$select public.cfi_capture_daily_prediction_audit((((now() at time zone 'Asia/Ho_Chi_Minh')::date)-1));$cron$
);

do $$
declare r record;
begin
  for r in select jobid,command from cron.job where jobname='cfi-prediction-settlement-hourly' loop
    perform cron.alter_job(
      r.jobid,
      schedule => '11,31,51 * * * *',
      command => replace(r.command,'timeout_milliseconds := 60000','timeout_milliseconds := 120000')
    );
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='cfi-calibration-live-feedback-hourly' loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;
select cron.schedule(
  'cfi-calibration-live-feedback-hourly',
  '37 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-calibration-learn',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cfi-scheduler-token',(select token from public.cfi_scheduler_tokens where token_name='calibration_learning')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
