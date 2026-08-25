-- Deterministic prospective Multi-Market FT 1X2 shadow snapshot preparer.
-- Uses only a strict-prior production prematch snapshot's scoreline.expectedGoals.
-- Frozen calibration is fit through 2025 and remains decision_use=false.

create or replace function public.cfi_research_prepare_multimarket_shadow_snapshot(
  p_fixture uuid,
  p_source_prediction_snapshot uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v record;
  s record;
  lh double precision;
  la double precision;
  ph double precision;
  pa double precision;
  raw_home double precision:=0;
  raw_draw double precision:=0;
  raw_away double precision:=0;
  z double precision;
  qh double precision;
  qd double precision;
  qa double precision;
  qz double precision;
  i integer;
  j integer;
  fp text;
  pred jsonb;
  phash text;
  sid uuid;
  max_ev date;
begin
  select * into v from public.cfi_living_verified_fixtures
  where fixture_id=p_fixture and verification_status='VERIFIED';
  if not found then raise exception 'FIXTURE_NOT_VERIFIED'; end if;
  if now()>=v.kickoff_at then raise exception 'PREDICTION_NOT_PREMATCH'; end if;

  select * into s from public.cfi_prediction_snapshots
  where snapshot_id=p_source_prediction_snapshot and strict_prior is true;
  if not found then raise exception 'STRICT_PRIOR_SOURCE_SNAPSHOT_REQUIRED'; end if;
  if s.created_at>=v.kickoff_at then raise exception 'SOURCE_SNAPSHOT_NOT_PREMATCH'; end if;
  if s.target_date<>v.target_date or s.home_team<>v.home_team or s.away_team<>v.away_team then
    raise exception 'SOURCE_FIXTURE_IDENTITY_MISMATCH';
  end if;
  if coalesce((s.prediction#>>'{strictPriorAudit,verified}')::boolean,false) is not true then
    raise exception 'SOURCE_TEMPORAL_AUDIT_REQUIRED';
  end if;
  if coalesce((s.prediction#>>'{strictPriorAudit,evidence,futureEvidenceCount}')::integer,-1)<>0
     or coalesce((s.prediction#>>'{strictPriorAudit,evidence,sameDateEvidenceCount}')::integer,-1)<>0 then
    raise exception 'STRICT_PRIOR_FAILURE';
  end if;

  lh:=(s.prediction#>>'{scoreline,expectedGoals,ftHome}')::double precision;
  la:=(s.prediction#>>'{scoreline,expectedGoals,ftAway}')::double precision;
  if lh is null or la is null or lh<0 or la<0 then raise exception 'EXPECTED_GOALS_REQUIRED'; end if;

  -- Independent Poisson score grid, 0..20, normalized to remove tiny truncated tail.
  ph:=exp(-lh);
  for i in 0..20 loop
    if i>0 then ph:=ph*lh/i; end if;
    pa:=exp(-la);
    for j in 0..20 loop
      if j>0 then pa:=pa*la/j; end if;
      if i>j then raw_home:=raw_home+ph*pa;
      elsif i=j then raw_draw:=raw_draw+ph*pa;
      else raw_away:=raw_away+ph*pa;
      end if;
    end loop;
  end loop;
  z:=raw_home+raw_draw+raw_away;
  if z<=0 then raise exception 'INVALID_SCORE_GRID'; end if;
  raw_home:=raw_home/z; raw_draw:=raw_draw/z; raw_away:=raw_away/z;

  -- CFI_MULTI_MARKET_FROZEN_CAL_V1 FT 1X2 Platt transforms.
  raw_home:=greatest(1e-9,least(1-1e-9,raw_home));
  raw_draw:=greatest(1e-9,least(1-1e-9,raw_draw));
  raw_away:=greatest(1e-9,least(1-1e-9,raw_away));
  qh:=1/(1+exp(-(.9932605647*ln(raw_home/(1-raw_home))+.2628253689)));
  qd:=1/(1+exp(-(.6510983643*ln(raw_draw/(1-raw_draw))-.3252062781)));
  qa:=1/(1+exp(-(1.0506349428*ln(raw_away/(1-raw_away))-.3108767501)));
  qz:=qh+qd+qa;
  qh:=qh/qz; qd:=qd/qz; qa:=qa/qz;

  max_ev:=coalesce((s.prediction#>>'{strictPriorAudit,evidence,maxEvidenceDate}')::date,
                   (s.prediction#>>'{bigDbRetrieval,temporalAudit,maxEvidenceDate}')::date);
  if max_ev is null or max_ev>=v.target_date then raise exception 'STRICT_PRIOR_MAX_EVIDENCE_INVALID'; end if;

  fp:=md5('CFI_MULTI_MARKET_V1|CFI_MULTI_MARKET_FROZEN_CAL_V1|FT_1X2|POISSON_0_20|.9932605647,.2628253689|.6510983643,-.3252062781|1.0506349428,-.3108767501|scoreline.expectedGoals');
  pred:=jsonb_build_object(
    'model','CFI_MULTI_MARKET_V1',
    'modelVersion','CFI_MULTI_MARKET_V1',
    'calibrationVersion','CFI_MULTI_MARKET_FROZEN_CAL_V1',
    'decisionUse',false,
    'status','SHADOW_RESEARCH',
    'targetDate',v.target_date,
    'homeTeam',v.home_team,
    'awayTeam',v.away_team,
    'sourcePredictionSnapshotId',s.snapshot_id,
    'sourcePredictionHash',s.prediction_hash,
    'sourceContract','scoreline.expectedGoals',
    'expectedGoals',jsonb_build_object('ftHome',lh,'ftAway',la),
    'raw1X2FT',jsonb_build_object('home',raw_home,'draw',raw_draw,'away',raw_away),
    'probabilities',jsonb_build_object('FT_1X2_HOME',qh,'FT_1X2_DRAW',qd,'FT_1X2_AWAY',qa),
    'provenance',jsonb_build_object('strictPrior',true,'futureEvidenceCount',0,'sameDateEvidenceCount',0,'maxEvidenceDate',max_ev)
  );
  phash:=md5(pred::text||'|'||fp||'|'||v.fixture_id::text||'|'||v.kickoff_at::text);

  insert into public.cfi_research_prematch_snapshots(
    fixture_id,model_name,model_version,model_fingerprint,target_date,kickoff_at,
    home_team,away_team,canonical_home_team_id,canonical_away_team_id,max_evidence_date,
    prediction,prediction_hash,status,strict_prior
  ) values(
    v.fixture_id,'CFI_MULTI_MARKET_V1','CFI_MULTI_MARKET_V1+CFI_MULTI_MARKET_FROZEN_CAL_V1',fp,
    v.target_date,v.kickoff_at,v.home_team,v.away_team,v.canonical_home_team_id,v.canonical_away_team_id,
    max_ev,pred,phash,'DATA_READY',true
  ) on conflict(fixture_id,model_fingerprint) do nothing returning snapshot_id into sid;
  if sid is null then
    select snapshot_id into sid from public.cfi_research_prematch_snapshots
    where fixture_id=v.fixture_id and model_fingerprint=fp;
  end if;
  return sid;
end;
$$;
revoke execute on function public.cfi_research_prepare_multimarket_shadow_snapshot(uuid,uuid) from public,anon,authenticated;
