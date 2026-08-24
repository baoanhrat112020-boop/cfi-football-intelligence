-- CFI Multi-Market prospective research decision bridge V1.
-- Additive, research-only, backward compatible. Exactly one prediction lineage is required.

alter table public.cfi_decision_snapshots
  add column if not exists research_prediction_snapshot_id uuid null references public.cfi_research_prematch_snapshots(snapshot_id);

alter table public.cfi_decision_snapshots
  alter column prediction_snapshot_id drop not null;

alter table public.cfi_decision_snapshots
  drop constraint if exists cfi_decision_exactly_one_prediction_ref;
alter table public.cfi_decision_snapshots
  add constraint cfi_decision_exactly_one_prediction_ref
  check (num_nonnulls(prediction_snapshot_id,research_prediction_snapshot_id)=1);

create index if not exists cfi_decision_snapshots_research_prediction_idx
  on public.cfi_decision_snapshots(research_prediction_snapshot_id,decision_timestamp)
  where research_prediction_snapshot_id is not null;

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
  r record;
begin
  select kickoff_at,is_closing,verified_fixture_id into k,closing,m_verified
  from public.cfi_market_snapshots where market_snapshot_id=new.market_snapshot_id;
  if k is null then raise exception 'CFI_MARKET_SNAPSHOT_REQUIRED'; end if;
  if closing then raise exception 'CFI_CLOSING_PRICE_NOT_ALLOWED_FOR_PREMATCH_DECISION'; end if;
  if new.decision_timestamp >= k then raise exception 'CFI_DECISION_MUST_PRECEDE_KICKOFF'; end if;
  if num_nonnulls(new.prediction_snapshot_id,new.research_prediction_snapshot_id) <> 1 then
    raise exception 'CFI_DECISION_PREDICTION_REFERENCE_INVALID';
  end if;
  if new.research_prediction_snapshot_id is not null then
    select fixture_id,kickoff_at,status,strict_prior,created_at,max_evidence_date,target_date
      into r from public.cfi_research_prematch_snapshots
      where snapshot_id=new.research_prediction_snapshot_id;
    if not found or r.status <> 'DATA_READY' or r.strict_prior is not true then
      raise exception 'CFI_RESEARCH_PREDICTION_NOT_READY';
    end if;
    if r.created_at >= r.kickoff_at or r.max_evidence_date >= r.target_date then
      raise exception 'CFI_RESEARCH_PREDICTION_TEMPORAL_INVALID';
    end if;
    if m_verified is null or r.fixture_id <> m_verified or r.kickoff_at <> k then
      raise exception 'CFI_DECISION_FIXTURE_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.cfi_decision_snapshot_temporal_guard() from public,anon,authenticated;

comment on column public.cfi_decision_snapshots.research_prediction_snapshot_id is
  'Prospective research prediction lineage. Exactly one of production prediction_snapshot_id or research_prediction_snapshot_id is present.';
