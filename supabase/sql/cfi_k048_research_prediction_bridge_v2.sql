-- CFI K048 V2 research prediction lineage bridge.
-- Additive and research-only. Preserves all existing K048 immutable rows.
-- Exactly one prediction lineage is required: production snapshot OR research snapshot.

alter table public.cfi_k048_shadow_snapshots
  add column if not exists research_prediction_snapshot_id uuid null
  references public.cfi_research_prematch_snapshots(snapshot_id);

alter table public.cfi_k048_shadow_snapshots
  alter column prediction_snapshot_id drop not null;

alter table public.cfi_k048_shadow_snapshots
  drop constraint if exists cfi_k048_exactly_one_prediction_ref;
alter table public.cfi_k048_shadow_snapshots
  add constraint cfi_k048_exactly_one_prediction_ref
  check (num_nonnulls(prediction_snapshot_id,research_prediction_snapshot_id)=1);

create index if not exists cfi_k048_shadow_research_prediction_idx
  on public.cfi_k048_shadow_snapshots(research_prediction_snapshot_id,captured_at)
  where research_prediction_snapshot_id is not null;

create or replace function public.cfi_k048_snapshot_lineage_guard()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  r record;
  m record;
begin
  if num_nonnulls(new.prediction_snapshot_id,new.research_prediction_snapshot_id) <> 1 then
    raise exception 'K048_PREDICTION_REFERENCE_INVALID';
  end if;

  if new.captured_at >= new.kickoff_at then
    raise exception 'K048_SNAPSHOT_MUST_PRECEDE_KICKOFF';
  end if;

  if new.research_prediction_snapshot_id is not null then
    if new.runner_version <> 'CFI_K048_TRAJECTORY_JOINT_V2_FULL_SUPPORT' then
      raise exception 'K048_RESEARCH_LINEAGE_REQUIRES_V2';
    end if;

    select fixture_id,kickoff_at,status,strict_prior,created_at,max_evidence_date,target_date,
           home_team,away_team
      into r
      from public.cfi_research_prematch_snapshots
     where snapshot_id=new.research_prediction_snapshot_id;

    if not found or r.status <> 'DATA_READY' or r.strict_prior is not true then
      raise exception 'K048_RESEARCH_PREDICTION_NOT_READY';
    end if;
    if r.created_at >= r.kickoff_at or r.max_evidence_date >= r.target_date then
      raise exception 'K048_RESEARCH_PREDICTION_TEMPORAL_INVALID';
    end if;
    if r.fixture_id is null or new.fixture_id is distinct from r.fixture_id
       or new.kickoff_at is distinct from r.kickoff_at
       or new.target_date is distinct from r.target_date
       or new.home_team is distinct from r.home_team
       or new.away_team is distinct from r.away_team then
      raise exception 'K048_RESEARCH_PREDICTION_FIXTURE_MISMATCH';
    end if;

    select verified_fixture_id,kickoff_at,research_only
      into m
      from public.cfi_market_snapshots
     where market_snapshot_id=new.market_snapshot_id;

    if not found or m.research_only is not true or m.verified_fixture_id is null
       or m.verified_fixture_id is distinct from r.fixture_id
       or m.kickoff_at is distinct from r.kickoff_at then
      raise exception 'K048_MARKET_FIXTURE_LINEAGE_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.cfi_k048_snapshot_lineage_guard() from public,anon,authenticated;

drop trigger if exists cfi_k048_snapshot_lineage_guard_trg on public.cfi_k048_shadow_snapshots;
create trigger cfi_k048_snapshot_lineage_guard_trg
before insert or update on public.cfi_k048_shadow_snapshots
for each row execute function public.cfi_k048_snapshot_lineage_guard();

comment on column public.cfi_k048_shadow_snapshots.research_prediction_snapshot_id is
  'Immutable prospective research prediction lineage for K048 V2. Exactly one of prediction_snapshot_id or research_prediction_snapshot_id is present.';
