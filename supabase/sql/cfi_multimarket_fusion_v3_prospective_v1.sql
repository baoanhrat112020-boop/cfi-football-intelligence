-- CFI Multi-Market Fusion V3 prospective shadow trial.
-- Research-only: never mutates canonical fixtures, prediction snapshots, or settlement actuals.

create table if not exists public.cfi_mm_fusion_v3_prospective_trials (
  trial_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null check (status in ('PREPARED','COLLECTING','READY_FOR_EVALUATION','BLOCKED','COMPLETE')),
  fusion_version text not null,
  fusion_architecture text not null,
  baseline_run_id uuid not null references public.cfi_mm_baseline_v22_runs(run_id),
  baseline_fingerprint text not null,
  baseline_snapshot_id uuid not null,
  source_commit text,
  worker_build_id text,
  worker_version_id text,
  start_at timestamptz,
  min_settled_samples integer not null default 200 check (min_settled_samples >= 200),
  eligible_snapshot_count integer not null default 0,
  settled_sample_count integer not null default 0,
  research_only boolean not null default true,
  decision_use boolean not null default false,
  production_mutation boolean not null default false,
  canonical_mutation boolean not null default false,
  protocol jsonb not null default jsonb_build_object(
    'prospectiveOnly',true,
    'sameCohortPromotionAllowed',false,
    'noReconstruction',true,
    'strictPriorRequired',true,
    'bigDbRequired',true,
    'k048TrajectoryRequired',true,
    'fullMultiMarketV22Required',true,
    'preMatchScoreGridTelemetryRequired',true,
    'minSettledSamples',200
  ),
  result jsonb,
  error text
);

create table if not exists public.cfi_mm_fusion_v3_prospective_samples (
  trial_id uuid not null references public.cfi_mm_fusion_v3_prospective_trials(trial_id) on delete cascade,
  snapshot_id uuid not null references public.cfi_prediction_snapshots(snapshot_id),
  created_at timestamptz not null default now(),
  target_date date not null,
  home_team text not null,
  away_team text not null,
  telemetry_sha256 text not null,
  fusion_fingerprint text not null,
  settled boolean not null default false,
  settlement_id uuid,
  eligibility_audit jsonb not null,
  evaluation jsonb,
  primary key (trial_id,snapshot_id)
);

create unique index if not exists cfi_mm_fusion_v3_one_collecting_trial_idx
  on public.cfi_mm_fusion_v3_prospective_trials(status)
  where status='COLLECTING';

alter table public.cfi_mm_fusion_v3_prospective_trials enable row level security;
alter table public.cfi_mm_fusion_v3_prospective_samples enable row level security;

revoke all on public.cfi_mm_fusion_v3_prospective_trials from anon, authenticated;
revoke all on public.cfi_mm_fusion_v3_prospective_samples from anon, authenticated;
grant select,insert,update,delete on public.cfi_mm_fusion_v3_prospective_trials to service_role;
grant select,insert,update,delete on public.cfi_mm_fusion_v3_prospective_samples to service_role;

create or replace function public.cfi_mm_fusion_v3_full_sample_evaluation(p_snapshot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  pred jsonb;
  tele jsonb;
  sa jsonb;
  hh integer; ha integer; fh integer; fa integer;
  base jsonb;
  v3 jsonb;
  inc jsonb; v1 jsonb; v2 jsonb;
begin
  select s.prediction,st.audit,st.actual_ht_home,st.actual_ht_away,st.actual_ft_home,st.actual_ft_away
    into pred,sa,hh,ha,fh,fa
  from public.cfi_prediction_snapshots s
  join public.cfi_prediction_settlements st using(snapshot_id)
  where s.snapshot_id=p_snapshot_id;

  if pred is null or hh is null or ha is null or fh is null or fa is null then return null; end if;

  tele:=pred#>'{researchTelemetry,prospectiveV22}';
  if tele->>'version'<>'CFI_PROSPECTIVE_V22_SCORE_GRIDS_V1'
     or tele->>'status'<>'READY'
     or coalesce((tele->>'capturedPreMatch')::boolean,false) is distinct from true
     or coalesce((tele->>'reconstructed')::boolean,true) is distinct from false
     or coalesce((tele->>'decisionUse')::boolean,true) is distinct from false
  then return null; end if;

  if pred#>>'{multiMarketFusionV3,version}'<>'CFI_MULTI_MARKET_FUSION_V3'
     or pred#>>'{multiMarketFusionV3,status}'<>'SHADOW_READY'
     or coalesce((pred#>>'{multiMarketFusionV3,researchOnly}')::boolean,false) is distinct from true
     or coalesce((pred#>>'{multiMarketFusionV3,decisionUse}')::boolean,true) is distinct from false
     or coalesce((pred#>>'{multiMarketFusionV3,productionEligible}')::boolean,true) is distinct from false
     or coalesce((pred#>>'{multiMarketFusionV3,strictPrior,verified}')::boolean,false) is distinct from true
     or coalesce((pred#>>'{multiMarketFusionV3,bigDb,used}')::boolean,false) is distinct from true
     or coalesce((pred#>>'{multiMarketFusionV3,bigDb,temporalVerified}')::boolean,false) is distinct from true
     or pred#>>'{multiMarketFusionV3,trajectory,status}'<>'PASS'
     or pred#>>'{multiMarketFusionV3,coherence,status}'<>'PASS'
  then return null; end if;

  if tele#>>'{fusionV3,version}'<>'CFI_MULTI_MARKET_FUSION_V3'
     or coalesce((tele#>>'{fusionV3,captured}')::boolean,false) is distinct from true
     or tele#>>'{fusionV3,status}'<>'SHADOW_READY'
     or tele#>>'{fusionV3,trajectoryStatus}'<>'PASS'
     or coalesce((tele#>>'{fusionV3,bigDbUsed}')::boolean,false) is distinct from true
     or coalesce((tele#>>'{fusionV3,decisionUse}')::boolean,true) is distinct from false
     or nullif(tele#>>'{fusionV3,fingerprint}','') is null
     or jsonb_array_length(coalesce(tele#>'{scoreGrids,fusionV3,ht,cells}','[]'::jsonb))=0
     or jsonb_array_length(coalesce(tele#>'{scoreGrids,fusionV3,ft,cells}','[]'::jsonb))=0
  then return null; end if;

  if sa#>>'{multiMarketFusionV3Pair,version}'<>'CFI_MULTI_MARKET_FUSION_V3_SETTLEMENT_V1_TOP1'
     or sa#>>'{multiMarketFusionV3Pair,prospectiveOnly}'<>'true'
     or sa#>>'{multiMarketFusionV3Pair,reconstructed}'<>'false'
     or sa#>>'{multiMarketFusionV3Pair,strictPrior}'<>'true'
  then return null; end if;

  base:=public.cfi_mm_fusion_v2_full_sample_evaluation(p_snapshot_id);
  if base is null then return null; end if;
  inc:=base->'incumbent'; v1:=base->'fusionV1'; v2:=base->'challengerV2';

  v3:=public.cfi_mm_v22_node_metrics(
    pred#>'{multiMarketFusionV3,fusionMarket,thresholds}',
    pred#>'{multiMarketFusionV3,fusionMarket,top1HT}',
    pred#>'{multiMarketFusionV3,fusionMarket,top1FT}',
    tele#>'{scoreGrids,fusionV3,ht,cells}',
    tele#>'{scoreGrids,fusionV3,ft,cells}',
    sa->'multiMarketFusionV3Evaluation',
    pred#>'{multiMarketFusionV3,uncertainty}',
    pred#>>'{multiMarketFusionV3,coherence,status}',
    hh,ha,fh,fa
  );
  if inc is null or v1 is null or v2 is null or v3 is null then return null; end if;

  return jsonb_build_object(
    'version','CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1',
    'snapshotId',p_snapshot_id,
    'strictPrior',true,'prospectiveOnly',true,'reconstructed',false,'decisionUse',false,
    'actual',jsonb_build_object('ht',jsonb_build_array(hh,ha),'ft',jsonb_build_array(fh,fa)),
    'incumbent',inc,'fusionV1',v1,'challengerV2',v2,'fusionV3',v3,
    'telemetrySha256',tele->>'sha256',
    'fusionFingerprint',tele#>>'{fusionV3,fingerprint}',
    'bigDbUsed',true,
    'trajectoryStatus','PASS',
    'paired',jsonb_build_object(
      'v3MinusIncumbentAggregateBrier',(v3->>'aggregateBrier')::double precision-(inc->>'aggregateBrier')::double precision,
      'v3MinusV1AggregateBrier',(v3->>'aggregateBrier')::double precision-(v1->>'aggregateBrier')::double precision,
      'v3MinusV2AggregateBrier',(v3->>'aggregateBrier')::double precision-(v2->>'aggregateBrier')::double precision,
      'v3MinusIncumbentAggregateLogLoss',(v3->>'aggregateLogLoss')::double precision-(inc->>'aggregateLogLoss')::double precision,
      'v3MinusV1AggregateLogLoss',(v3->>'aggregateLogLoss')::double precision-(v1->>'aggregateLogLoss')::double precision,
      'v3MinusV2AggregateLogLoss',(v3->>'aggregateLogLoss')::double precision-(v2->>'aggregateLogLoss')::double precision,
      'lowerIsBetter',true
    )
  );
end
$$;

create or replace function public.cfi_mm_fusion_v3_register_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  t public.cfi_mm_fusion_v3_prospective_trials%rowtype;
  tele jsonb;
  sha text;
  fp text;
  audit jsonb;
begin
  select * into t
  from public.cfi_mm_fusion_v3_prospective_trials
  where status='COLLECTING'
  order by created_at desc
  limit 1;

  if not found or t.start_at is null or new.created_at<t.start_at then return new; end if;
  if coalesce(t.protocol->'excludedPreResetSnapshots','[]'::jsonb) ? new.snapshot_id::text then return new; end if;

  tele:=new.prediction#>'{researchTelemetry,prospectiveV22}';
  sha:=tele->>'sha256';
  fp:=tele#>>'{fusionV3,fingerprint}';

  if new.strict_prior is distinct from true then return new; end if;
  if new.prediction->>'engine' is distinct from (t.protocol->>'requiredEngine') then return new; end if;
  if new.prediction->>'baseEngine' is distinct from (t.protocol->>'requiredEngine') then return new; end if;
  if coalesce((new.prediction#>>'{strictPriorAudit,verified}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((new.prediction#>>'{temporalEvidenceAudit,verified}')::boolean,false) is distinct from true then return new; end if;

  if new.prediction#>>'{multiMarketFusionV3,version}' is distinct from t.fusion_version then return new; end if;
  if new.prediction#>>'{multiMarketFusionV3,status}' is distinct from 'SHADOW_READY' then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,researchOnly}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,decisionUse}')::boolean,true) is distinct from false then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,productionEligible}')::boolean,true) is distinct from false then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,strictPrior,verified}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,bigDb,used}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((new.prediction#>>'{multiMarketFusionV3,bigDb,temporalVerified}')::boolean,false) is distinct from true then return new; end if;
  if new.prediction#>>'{multiMarketFusionV3,trajectory,status}' is distinct from 'PASS' then return new; end if;
  if new.prediction#>>'{multiMarketFusionV3,coherence,status}' is distinct from 'PASS' then return new; end if;

  if tele->>'version' is distinct from (t.protocol->>'requiredTelemetryVersion') then return new; end if;
  if tele->>'status' is distinct from 'READY' then return new; end if;
  if coalesce((tele->>'capturedPreMatch')::boolean,false) is distinct from true then return new; end if;
  if coalesce((tele->>'reconstructed')::boolean,true) is distinct from false then return new; end if;
  if coalesce((tele->>'decisionUse')::boolean,true) is distinct from false then return new; end if;
  if tele#>>'{fusionV3,version}' is distinct from t.fusion_version then return new; end if;
  if coalesce((tele#>>'{fusionV3,captured}')::boolean,false) is distinct from true then return new; end if;
  if tele#>>'{fusionV3,status}' is distinct from 'SHADOW_READY' then return new; end if;
  if tele#>>'{fusionV3,trajectoryStatus}' is distinct from 'PASS' then return new; end if;
  if coalesce((tele#>>'{fusionV3,bigDbUsed}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((tele#>>'{fusionV3,decisionUse}')::boolean,true) is distinct from false then return new; end if;
  if sha is null or sha !~ '^[0-9a-f]{64}$' then return new; end if;
  if fp is null or fp !~ '^[0-9a-f]{8}$' then return new; end if;
  if jsonb_array_length(coalesce(tele#>'{scoreGrids,fusionV3,ht,cells}','[]'::jsonb))=0 then return new; end if;
  if jsonb_array_length(coalesce(tele#>'{scoreGrids,fusionV3,ft,cells}','[]'::jsonb))=0 then return new; end if;

  audit:=jsonb_build_object(
    'status','ELIGIBLE_PROSPECTIVE_FUSION_V3',
    'snapshotCreatedAt',new.created_at,
    'trialStartAt',t.start_at,
    'engine',new.prediction->>'engine',
    'strictPrior',true,
    'bigDbUsed',true,
    'trajectoryStatus','PASS',
    'telemetryVersion',tele->>'version',
    'telemetrySha256',sha,
    'fusionFingerprint',fp,
    'reconstructed',false,
    'decisionUse',false,
    'productionMutation',false,
    'canonicalMutation',false
  );

  insert into public.cfi_mm_fusion_v3_prospective_samples(
    trial_id,snapshot_id,target_date,home_team,away_team,telemetry_sha256,fusion_fingerprint,eligibility_audit
  )
  values(t.trial_id,new.snapshot_id,new.target_date,new.home_team,new.away_team,sha,fp,audit)
  on conflict do nothing;

  update public.cfi_mm_fusion_v3_prospective_trials x
  set eligible_snapshot_count=(
    select count(*) from public.cfi_mm_fusion_v3_prospective_samples s where s.trial_id=x.trial_id
  ),updated_at=now()
  where x.trial_id=t.trial_id;
  return new;
end
$$;

create or replace function public.cfi_mm_fusion_v3_mark_settled()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  tid uuid;
  ev jsonb;
  ready_count integer;
begin
  if new.actual_ht_home is null or new.actual_ht_away is null or new.actual_ft_home is null or new.actual_ft_away is null then return new; end if;
  if new.audit#>>'{multiMarketFusionV3Pair,version}'<>'CFI_MULTI_MARKET_FUSION_V3_SETTLEMENT_V1_TOP1' then return new; end if;
  if coalesce((new.audit#>>'{multiMarketFusionV3Pair,prospectiveOnly}')::boolean,false) is distinct from true then return new; end if;
  if coalesce((new.audit#>>'{multiMarketFusionV3Pair,reconstructed}')::boolean,true) is distinct from false then return new; end if;
  if coalesce((new.audit#>>'{multiMarketFusionV3Pair,strictPrior}')::boolean,false) is distinct from true then return new; end if;

  ev:=public.cfi_mm_fusion_v3_full_sample_evaluation(new.snapshot_id);
  if ev is null or ev->>'version'<>'CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1' then return new; end if;

  if coalesce((ev#>>'{fusionV3,sampleCoverage,CHAMPION_6}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,SCORELINE_HT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,SCORELINE_FT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,1X2_HT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,1X2_FT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,OU_HT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,OU_FT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,AH_HT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,AH_FT}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,CALIBRATION_UNCERTAINTY_ABSTENTION}')::boolean,false) is distinct from true
     or coalesce((ev#>>'{fusionV3,sampleCoverage,COHERENCE}')::boolean,false) is distinct from true
  then return new; end if;

  for tid in
    select trial_id from public.cfi_mm_fusion_v3_prospective_samples where snapshot_id=new.snapshot_id
  loop
    update public.cfi_mm_fusion_v3_prospective_samples
      set settled=true,settlement_id=new.snapshot_id,evaluation=ev
      where trial_id=tid and snapshot_id=new.snapshot_id;

    select count(*) into ready_count
    from public.cfi_mm_fusion_v3_prospective_samples s
    where s.trial_id=tid
      and s.settled=true
      and s.evaluation->>'version'='CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1';

    update public.cfi_mm_fusion_v3_prospective_trials x
      set settled_sample_count=ready_count,
          updated_at=now(),
          status=case when ready_count>=x.min_settled_samples then 'READY_FOR_EVALUATION' else x.status end
      where x.trial_id=tid;
  end loop;
  return new;
end
$$;

create or replace function public.cfi_mm_fusion_v3_trial_ece(p_trial_id uuid,p_node text)
returns double precision
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare out_ece double precision;
begin
  if p_node not in ('incumbent','fusionV1','challengerV2','fusionV3') then return null; end if;
  with events as (
    select greatest(0.0,least(1.0,(e->>'p')::double precision)) as p,
           (e->>'y')::double precision as y
    from public.cfi_mm_fusion_v3_prospective_samples s
    cross join lateral jsonb_array_elements(coalesce((s.evaluation->p_node)->'calibrationEvents','[]'::jsonb)) e
    where s.trial_id=p_trial_id and s.settled=true
      and s.evaluation->>'version'='CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1'
  ), bins as (
    select least(9,floor(least(0.999999999,p)*10)::integer) as bin,
           count(*)::double precision as n,
           avg(p) as avg_p,
           avg(y) as avg_y
    from events
    group by 1
  ), total as (
    select sum(n) n from bins
  )
  select case when total.n>0 then sum((bins.n/total.n)*abs(bins.avg_p-bins.avg_y)) else null end
  into out_ece
  from bins cross join total
  group by total.n;
  return out_ece;
end
$$;

create or replace function public.cfi_mm_fusion_v3_trial_evaluation(p_trial_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  t public.cfi_mm_fusion_v3_prospective_trials%rowtype;
  n integer;
  inc_b double precision; inc_l double precision;
  v1_b double precision; v1_l double precision;
  v2_b double precision; v2_l double precision;
  v3_b double precision; v3_l double precision;
  inc_ece double precision; v3_ece double precision;
  groups jsonb;
  segment_worst double precision;
begin
  select * into t from public.cfi_mm_fusion_v3_prospective_trials where trial_id=p_trial_id;
  if not found then return null; end if;

  select count(*),
         avg((evaluation#>>'{incumbent,aggregateBrier}')::double precision),
         avg((evaluation#>>'{incumbent,aggregateLogLoss}')::double precision),
         avg((evaluation#>>'{fusionV1,aggregateBrier}')::double precision),
         avg((evaluation#>>'{fusionV1,aggregateLogLoss}')::double precision),
         avg((evaluation#>>'{challengerV2,aggregateBrier}')::double precision),
         avg((evaluation#>>'{challengerV2,aggregateLogLoss}')::double precision),
         avg((evaluation#>>'{fusionV3,aggregateBrier}')::double precision),
         avg((evaluation#>>'{fusionV3,aggregateLogLoss}')::double precision)
  into n,inc_b,inc_l,v1_b,v1_l,v2_b,v2_l,v3_b,v3_l
  from public.cfi_mm_fusion_v3_prospective_samples
  where trial_id=p_trial_id and settled=true
    and evaluation->>'version'='CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1';

  inc_ece:=public.cfi_mm_fusion_v3_trial_ece(p_trial_id,'incumbent');
  v3_ece:=public.cfi_mm_fusion_v3_trial_ece(p_trial_id,'fusionV3');

  with mapping(group_name,node_key) as (
    values
      ('HT_1X2','1X2_HT'),('FT_1X2','1X2_FT'),
      ('HT_OU','OU_HT'),('FT_OU','OU_FT'),
      ('HT_AH','AH_HT'),('FT_AH','AH_FT'),
      ('EXTREME_THRESHOLDS','CHAMPION_6')
  ), agg as (
    select m.group_name,
           count(*) as sample_n,
           avg((s.evaluation#>>array['fusionV3','groupMetrics',m.node_key,'brier'])::double precision)
             -avg((s.evaluation#>>array['incumbent','groupMetrics',m.node_key,'brier'])::double precision) as brier_delta,
           avg((s.evaluation#>>array['fusionV3','groupMetrics',m.node_key,'logLoss'])::double precision)
             -avg((s.evaluation#>>array['incumbent','groupMetrics',m.node_key,'logLoss'])::double precision) as logloss_delta
    from mapping m
    cross join public.cfi_mm_fusion_v3_prospective_samples s
    where s.trial_id=p_trial_id and s.settled=true
      and s.evaluation->>'version'='CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1'
    group by m.group_name
  )
  select coalesce(jsonb_object_agg(group_name,jsonb_build_object('n',sample_n,'brierDelta',brier_delta,'logLossDelta',logloss_delta)),'{}'::jsonb)
  into groups from agg;

  with monthly as (
    select date_trunc('month',target_date)::date as segment,
           count(*) segment_n,
           avg((evaluation#>>'{fusionV3,aggregateBrier}')::double precision)
             -avg((evaluation#>>'{incumbent,aggregateBrier}')::double precision) as delta
    from public.cfi_mm_fusion_v3_prospective_samples
    where trial_id=p_trial_id and settled=true
      and evaluation->>'version'='CFI_PROSPECTIVE_MULTI_MARKET_FUSION_V3_SAMPLE_EVAL_V1'
    group by 1
  )
  select max(delta) into segment_worst from monthly where segment_n>=10;

  return jsonb_build_object(
    'version','CFI_MULTI_MARKET_FUSION_V3_PROSPECTIVE_TRIAL_EVAL_V1',
    'trialId',p_trial_id,
    'status',case when n>=t.min_settled_samples then 'READY_FOR_PROMOTION_GATE' else 'COLLECTING' end,
    'strictPrior',true,'prospectiveReset',true,'lockedOosPass',n>=t.min_settled_samples,
    'reconstructed',false,'predictionHistoryReplay',false,'decisionUse',false,
    'n',n,
    'metrics',jsonb_build_object(
      'n',n,
      'candidate',jsonb_build_object('brier',v3_b,'logLoss',v3_l,'ece',v3_ece),
      'baseline',jsonb_build_object('brier',inc_b,'logLoss',inc_l,'ece',inc_ece),
      'fusionV1',jsonb_build_object('brier',v1_b,'logLoss',v1_l),
      'challengerV2',jsonb_build_object('brier',v2_b,'logLoss',v2_l)
    ),
    'groups',groups,
    'segmentWorstBrierDelta',segment_worst,
    'bigDb',jsonb_build_object('used',true,'strictPriorVerified',true,'reproducible',true),
    'trajectoryStatus','PASS',
    'crossMarketCoherenceStatus','PASS',
    'baselineRunId',t.baseline_run_id,
    'baselineFingerprint',t.baseline_fingerprint,
    'sourceCommit',t.source_commit
  );
end
$$;

revoke all on function public.cfi_mm_fusion_v3_full_sample_evaluation(uuid) from public,anon,authenticated;
revoke all on function public.cfi_mm_fusion_v3_register_snapshot() from public,anon,authenticated;
revoke all on function public.cfi_mm_fusion_v3_mark_settled() from public,anon,authenticated;
revoke all on function public.cfi_mm_fusion_v3_trial_ece(uuid,text) from public,anon,authenticated;
revoke all on function public.cfi_mm_fusion_v3_trial_evaluation(uuid) from public,anon,authenticated;
grant execute on function public.cfi_mm_fusion_v3_full_sample_evaluation(uuid) to service_role;
grant execute on function public.cfi_mm_fusion_v3_trial_ece(uuid,text) to service_role;
grant execute on function public.cfi_mm_fusion_v3_trial_evaluation(uuid) to service_role;

drop trigger if exists cfi_mm_fusion_v3_register_snapshot_trg on public.cfi_prediction_snapshots;
create trigger cfi_mm_fusion_v3_register_snapshot_trg
after insert on public.cfi_prediction_snapshots
for each row execute function public.cfi_mm_fusion_v3_register_snapshot();

drop trigger if exists cfi_mm_fusion_v3_mark_settled_trg on public.cfi_prediction_settlements;
create trigger cfi_mm_fusion_v3_mark_settled_trg
after insert or update of audit,actual_ht_home,actual_ht_away,actual_ft_home,actual_ft_away
on public.cfi_prediction_settlements
for each row execute function public.cfi_mm_fusion_v3_mark_settled();

comment on table public.cfi_mm_fusion_v3_prospective_trials is
'Research-only Fusion V3 prospective trial. decision_use=false; no canonical or production mutation; promotion requires separate fail-closed gate.';
comment on table public.cfi_mm_fusion_v3_prospective_samples is
'Immutable-linked prospective Fusion V3 research samples. Only pre-match snapshots with strict-prior BigDB + K048 telemetry are eligible.';
