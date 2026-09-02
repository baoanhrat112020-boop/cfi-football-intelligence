-- CFI Group A research decision model-dedupe V1.
-- Research-infrastructure-only trigger replacement.
-- No table/constraint/RLS/production prediction mutation.
-- Preserves the live identity-aware verified-fixture contract while allowing
-- multiple frozen research model lineages on one fixture.

create or replace function public.cfi_decision_snapshot_temporal_guard()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  k timestamptz;
  closing boolean;
  m_verified uuid;
  vf record;
  p record;
  r record;
begin
  select kickoff_at,is_closing,verified_fixture_id into k,closing,m_verified
  from public.cfi_market_snapshots where market_snapshot_id=new.market_snapshot_id;
  if k is null then raise exception 'CFI_MARKET_SNAPSHOT_REQUIRED'; end if;
  if m_verified is null then raise exception 'CFI_VERIFIED_FIXTURE_MARKET_REQUIRED'; end if;
  if closing then raise exception 'CFI_CLOSING_PRICE_NOT_ALLOWED_FOR_PREMATCH_DECISION'; end if;
  if new.decision_timestamp >= k then raise exception 'CFI_DECISION_MUST_PRECEDE_KICKOFF'; end if;
  if num_nonnulls(new.prediction_snapshot_id,new.research_prediction_snapshot_id) <> 1 then
    raise exception 'CFI_DECISION_PREDICTION_REFERENCE_INVALID';
  end if;

  select fixture_id,target_date,kickoff_at,home_team,away_team,verification_status
    into vf from public.cfi_living_verified_fixtures where fixture_id=m_verified;
  if not found or vf.verification_status <> 'VERIFIED' then
    raise exception 'CFI_VERIFIED_FIXTURE_REQUIRED';
  end if;
  if vf.kickoff_at <> k then raise exception 'CFI_MARKET_VERIFIED_FIXTURE_KICKOFF_MISMATCH'; end if;

  if new.research_prediction_snapshot_id is not null then
    select fixture_id,kickoff_at,status,strict_prior,created_at,max_evidence_date,target_date,model_name,model_fingerprint
      into r from public.cfi_research_prematch_snapshots
      where snapshot_id=new.research_prediction_snapshot_id;
    if not found or r.status <> 'DATA_READY' or r.strict_prior is not true then
      raise exception 'CFI_RESEARCH_PREDICTION_NOT_READY';
    end if;
    if r.created_at >= r.kickoff_at or r.max_evidence_date >= r.target_date then
      raise exception 'CFI_RESEARCH_PREDICTION_TEMPORAL_INVALID';
    end if;
    if r.fixture_id <> m_verified or r.kickoff_at <> k then
      raise exception 'CFI_DECISION_FIXTURE_MISMATCH';
    end if;
    if r.model_fingerprint is null or btrim(r.model_fingerprint)='' then
      raise exception 'CFI_RESEARCH_MODEL_FINGERPRINT_REQUIRED';
    end if;

    -- One decision sample per verified fixture and immutable frozen model
    -- fingerprint. Different research models may be paired on the same fixture.
    if exists (
      select 1
      from public.cfi_decision_snapshots d
      join public.cfi_market_snapshots m on m.market_snapshot_id=d.market_snapshot_id
      join public.cfi_research_prematch_snapshots rp on rp.snapshot_id=d.research_prediction_snapshot_id
      where m.verified_fixture_id=m_verified
        and rp.model_fingerprint=r.model_fingerprint
    ) then
      raise exception 'CFI_VERIFIED_FIXTURE_MODEL_DECISION_ALREADY_EXISTS';
    end if;
  else
    -- Production prediction lineage retains its existing fail-closed uniqueness.
    if exists (
      select 1
      from public.cfi_decision_snapshots d
      join public.cfi_market_snapshots m on m.market_snapshot_id=d.market_snapshot_id
      where m.verified_fixture_id=m_verified
        and d.prediction_snapshot_id is not null
    ) then
      raise exception 'CFI_VERIFIED_FIXTURE_DECISION_ALREADY_EXISTS';
    end if;

    select target_date,home_team,away_team,strict_prior,created_at
      into p from public.cfi_prediction_snapshots
      where snapshot_id=new.prediction_snapshot_id;
    if not found or p.strict_prior is not true then
      raise exception 'CFI_STRICT_PRIOR_PREDICTION_REQUIRED';
    end if;
    if p.created_at >= k then raise exception 'CFI_PREDICTION_MUST_PRECEDE_KICKOFF'; end if;
    if p.target_date <> vf.target_date or p.home_team <> vf.home_team or p.away_team <> vf.away_team then
      raise exception 'CFI_DECISION_FIXTURE_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.cfi_decision_snapshot_temporal_guard() from public,anon,authenticated;
