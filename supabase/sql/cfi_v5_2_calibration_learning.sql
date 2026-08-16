-- CFI-7: immutable calibration evidence + challenger registry.
-- Historical replay never mutates prediction snapshots. Promotion remains gated.

create table if not exists public.cfi_calibration_runs (
  run_id uuid primary key default gen_random_uuid(),
  learner_version text not null,
  engine_version text not null,
  source text not null check (source in ('HISTORICAL_REPLAY','SETTLED_PRODUCTION')),
  strict_prior boolean not null default true,
  fixture_count integer not null check (fixture_count >= 0),
  replay_count integer not null check (replay_count >= 0),
  metrics jsonb not null,
  promotion_eligible boolean not null default false,
  promotion_reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists cfi_calibration_runs_created_at_idx
  on public.cfi_calibration_runs(created_at desc);

create table if not exists public.cfi_calibration_versions (
  calibration_version text primary key,
  learner_version text not null,
  engine_version text not null,
  parameters jsonb not null,
  evidence_run_id uuid not null references public.cfi_calibration_runs(run_id),
  status text not null check (status in ('CHALLENGER','ACTIVE','RETIRED')) default 'CHALLENGER',
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists cfi_one_active_calibration_idx
  on public.cfi_calibration_versions ((status)) where status='ACTIVE';

comment on table public.cfi_calibration_runs is
  'Immutable CFI-7 calibration evidence. Historical replay and settled-production evidence remain auditable and strict-prior.';
comment on table public.cfi_calibration_versions is
  'Versioned calibration parameters. New learners enter as CHALLENGER; ACTIVE promotion requires historical and settled-production gates.';

-- Schedule learner two minutes after hourly settlement. The existing anon JWT is
-- reused server-side from the already-configured current-season refresh job; no
-- credential is committed to source control.
do $$
declare
  v_token text;
  v_command text;
begin
  select (regexp_match(command, '''Authorization'',''Bearer ([^'']+)'''))[1]
    into v_token
  from cron.job
  where jobname = 'cfi-current-season-refresh'
  limit 1;

  if v_token is null then
    raise exception 'CFI_CALIBRATION_SCHEDULER_TOKEN_NOT_FOUND';
  end if;

  v_command := format($cmd$
select net.http_post(
  url := 'https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-calibration-learn',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer %s',
    'apikey','%s'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$cmd$, v_token, v_token);

  perform cron.schedule('cfi-calibration-learning-hourly', '13 * * * *', v_command);
end $$;
