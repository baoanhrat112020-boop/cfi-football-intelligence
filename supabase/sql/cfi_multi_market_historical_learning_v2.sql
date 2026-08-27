-- CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1
-- Research-only historical replay storage. No production prediction mutation.

create table if not exists public.cfi_mm_historical_v2_runs (
  run_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'RUNNING',
  contract_version text not null default 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1',
  source_r0_run_id uuid null,
  corpus_count integer not null default 0,
  processed_count integer not null default 0,
  next_offset integer not null default 0,
  chunk_size integer not null default 300,
  result jsonb null,
  error text null,
  research_only boolean not null default true,
  production_mutation boolean not null default false
);

create table if not exists public.cfi_mm_historical_v2_points (
  run_id uuid not null references public.cfi_mm_historical_v2_runs(run_id) on delete cascade,
  fixture_id uuid not null,
  target_date date not null,
  model_type text not null,
  eligible boolean not null,
  strict_prior boolean not null default true,
  max_evidence_date date null,
  evidence_count integer null,
  feature_fallback boolean not null default false,
  champion_brier_mean double precision null,
  top3_ht_hit boolean null,
  top3_ft_hit boolean null,
  one_x_two_ht_brier double precision null,
  one_x_two_ft_brier double precision null,
  one_x_two_ht_logloss double precision null,
  one_x_two_ft_logloss double precision null,
  ou_ht_brier_mean double precision null,
  ou_ft_brier_mean double precision null,
  ah_ht_brier_mean double precision null,
  ah_ft_brier_mean double precision null,
  multi_market_brier double precision null,
  coherence_violations integer null,
  projection_max_abs_error double precision null,
  scoreline_ht_logloss double precision null,
  scoreline_ft_logloss double precision null,
  top3_ht jsonb null,
  top3_ft jsonb null,
  audit jsonb null,
  created_at timestamptz not null default now(),
  primary key (run_id, fixture_id, model_type)
);

alter table public.cfi_mm_historical_v2_runs enable row level security;
alter table public.cfi_mm_historical_v2_points enable row level security;
revoke all on public.cfi_mm_historical_v2_runs from anon, authenticated;
revoke all on public.cfi_mm_historical_v2_points from anon, authenticated;

-- Important: page the small fixture set first, then do indexed point lookups.
-- The legacy implementation aggregated all historical evaluations on every chunk
-- and timed out once OFFSET grew. The R0 source run is explicitly pinned.
drop function if exists public.cfi_mm_historical_v2_targets(uuid,integer,integer);
create function public.cfi_mm_historical_v2_targets(p_r0_run_id uuid, p_offset integer, p_limit integer)
returns setof jsonb
language sql
security invoker
set search_path = public
as $$
with base as (
  select f.*
  from public.fixtures f
  where f.match_date >= date '2016-01-01'
    and f.match_date < date '2026-08-20'
    and f.ht_home is not null and f.ht_away is not null
    and f.ft_home is not null and f.ft_away is not null
  order by f.match_date, f.home_team_id, f.away_team_id
  offset greatest(p_offset,0)
  limit greatest(1,least(p_limit,1000))
)
select jsonb_build_object(
  'fixture_id',b.fixture_id,
  'target_date',b.match_date,
  'home_team_id',b.home_team_id,
  'away_team_id',b.away_team_id,
  'actual_ht_home',b.ht_home,'actual_ht_away',b.ht_away,
  'actual_ft_home',b.ft_home,'actual_ft_away',b.ft_away,
  'home_feature',jsonb_build_object(
    'prior_matches',hf.prior_matches,
    'ht_gf',coalesce(hf.recent20_ht_gf_mean,hf.ht_gf_mean),
    'ht_ga',coalesce(hf.recent20_ht_ga_mean,hf.ht_ga_mean),
    'ft_gf',coalesce(hf.recent20_ft_gf_mean,hf.ft_gf_mean),
    'ft_ga',coalesce(hf.recent20_ft_ga_mean,hf.ft_ga_mean)
  ),
  'away_feature',jsonb_build_object(
    'prior_matches',af.prior_matches,
    'ht_gf',coalesce(af.recent20_ht_gf_mean,af.ht_gf_mean),
    'ht_ga',coalesce(af.recent20_ht_ga_mean,af.ht_ga_mean),
    'ft_gf',coalesce(af.recent20_ft_gf_mean,af.ft_gf_mean),
    'ft_ga',coalesce(af.recent20_ft_ga_mean,af.ft_ga_mean)
  ),
  'models',jsonb_build_object(
    'R0',jsonb_build_object('p3',r0.p_3ht,'p7',r0.p_7ft,'poht',r0.p_other_ht,'poft',r0.p_other_ft,'max_evidence_date',r0.max_evidence_date,'evidence_count',r0.evidence_count),
    'FUTURE_SIX',jsonb_build_object('p3',fs.p_3ht,'p7',fs.p_7ft,'poht',fs.p_other_ht,'poft',fs.p_other_ft,'max_evidence_date',fs.max_evidence_date,'evidence_count',fs.evidence_count),
    'F5',jsonb_build_object('p3',f5.p_3ht,'p7',f5.p_7ft,'poht',f5.p_other_ht,'poft',f5.p_other_ft,'max_evidence_date',f5.max_evidence_date,'evidence_count',f5.evidence_count),
    'F10P',jsonb_build_object('p3',f10p.p_3ht,'p7',f10p.p_7ft,'poht',f10p.p_other_ht,'poft',f10p.p_other_ft,'max_evidence_date',f10p.max_evidence_date,'evidence_count',f10p.evidence_count)
  )
)
from base b
left join public.cfi_research_r0_evaluations r0
  on r0.run_id=p_r0_run_id and r0.fixture_id=b.fixture_id and r0.model_type='FINAL_CFI'
left join public.cfi_research_r0_evaluations fs
  on fs.run_id=p_r0_run_id and fs.fixture_id=b.fixture_id and fs.model_type='FUTURE_SIX_FACTORS'
left join public.cfi_research_challenger_evaluations f5
  on f5.experiment_code='FUSION-F5' and f5.fixture_id=b.fixture_id and f5.model_type='F5_TEMPORAL_CALIBRATION'
left join public.cfi_research_challenger_evaluations f10p
  on f10p.experiment_code='FUSION-F10P' and f10p.fixture_id=b.fixture_id and f10p.model_type='F10_PRUNED_FULL_FUSION'
left join public.cfi_team_strength_feature_store_v1 hf
  on hf.team_id=b.home_team_id and hf.as_of_date=b.match_date and hf.strict_prior=true
left join public.cfi_team_strength_feature_store_v1 af
  on af.team_id=b.away_team_id and af.as_of_date=b.match_date and af.strict_prior=true;
$$;

revoke all on function public.cfi_mm_historical_v2_targets(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.cfi_mm_historical_v2_targets(uuid,integer,integer) to service_role;
