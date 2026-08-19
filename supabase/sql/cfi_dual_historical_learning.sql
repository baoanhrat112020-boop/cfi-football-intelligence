-- CFI dual-model historical learning.
-- Append-only evaluation evidence. Canonical fixtures and prediction snapshots are never updated.

create table if not exists public.cfi_historical_replay_runs (
  run_id uuid primary key default gen_random_uuid(),
  replay_version text not null,
  source text not null default 'CANONICAL_FIXTURES',
  strict_prior boolean not null check (strict_prior),
  canonical_fixture_mutations integer not null default 0 check (canonical_fixture_mutations = 0),
  eligible_fixtures integer not null check (eligible_fixtures >= 0),
  evaluation_rows integer not null check (evaluation_rows >= 0),
  corpus_cursor jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cfi_historical_model_evaluations (
  fixture_id uuid not null references public.fixtures(fixture_id) on delete restrict,
  model_type text not null check (model_type in ('HISTORICAL_PRODUCTION','FUTURE_SIX_FACTORS')),
  model_version text not null,
  replay_version text not null,
  target_date date not null,
  competition_id text,
  segment text not null,
  home_team text not null,
  away_team text not null,
  market_evaluations jsonb not null,
  top3_ht jsonb not null,
  top3_ft jsonb not null,
  factor_diagnostics jsonb,
  created_at timestamptz not null default now(),
  primary key (fixture_id, model_type, model_version, replay_version),
  constraint cfi_future_six_top3_not_copied check (
    model_type <> 'FUTURE_SIX_FACTORS'
    or (
      top3_ht->>'status' = 'NOT_YET_MODELED'
      and top3_ft->>'status' = 'NOT_YET_MODELED'
    )
  )
);

create index if not exists cfi_historical_evaluation_date_cursor_idx
  on public.cfi_historical_model_evaluations(target_date, fixture_id);
create index if not exists cfi_historical_evaluation_scope_idx
  on public.cfi_historical_model_evaluations(model_type, segment, competition_id, target_date desc);

alter table public.cfi_historical_replay_runs enable row level security;
alter table public.cfi_historical_model_evaluations enable row level security;

revoke all on public.cfi_historical_replay_runs from anon, authenticated;
revoke all on public.cfi_historical_model_evaluations from anon, authenticated;
grant select, insert on public.cfi_historical_replay_runs to service_role;
grant select, insert on public.cfi_historical_model_evaluations to service_role;

comment on table public.cfi_historical_model_evaluations is
  'Immutable strict-prior Model A/B evaluation evidence. Rows are append-only and never reconstruct prediction snapshots.';
comment on constraint cfi_future_six_top3_not_copied on public.cfi_historical_model_evaluations is
  'Future Six Top-3 stays NOT_YET_MODELED until it has an independent scoreline generator.';

create or replace function public.cfi_append_historical_model_evaluation(
  p_fixture_id uuid,
  p_model_type text,
  p_model_version text,
  p_replay_version text,
  p_target_date date,
  p_competition_id text,
  p_segment text,
  p_home_team text,
  p_away_team text,
  p_market_evaluations jsonb,
  p_top3_ht jsonb,
  p_top3_ft jsonb,
  p_factor_diagnostics jsonb default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.cfi_historical_model_evaluations(
    fixture_id, model_type, model_version, replay_version, target_date,
    competition_id, segment, home_team, away_team, market_evaluations,
    top3_ht, top3_ft, factor_diagnostics
  ) values (
    p_fixture_id, p_model_type, p_model_version, p_replay_version, p_target_date,
    p_competition_id, p_segment, p_home_team, p_away_team, p_market_evaluations,
    p_top3_ht, p_top3_ft, p_factor_diagnostics
  )
  on conflict (fixture_id, model_type, model_version, replay_version) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.cfi_append_historical_model_evaluation(
  uuid,text,text,text,date,text,text,text,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.cfi_append_historical_model_evaluation(
  uuid,text,text,text,date,text,text,text,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

