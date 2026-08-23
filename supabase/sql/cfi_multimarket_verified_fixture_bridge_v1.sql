-- CFI Multi-Market prospective verified-fixture bridge V1.
-- Research-only additive migration. It does NOT insert into canonical historical fixtures
-- and does NOT enable production decision use.

alter table public.cfi_market_snapshots
  add column if not exists verified_fixture_id uuid null references public.cfi_living_verified_fixtures(fixture_id);

alter table public.cfi_market_snapshots
  alter column fixture_id drop not null;

alter table public.cfi_market_snapshots
  drop constraint if exists cfi_market_snapshot_exactly_one_fixture_ref;
alter table public.cfi_market_snapshots
  add constraint cfi_market_snapshot_exactly_one_fixture_ref
  check (num_nonnulls(fixture_id, verified_fixture_id) = 1);

create index if not exists cfi_market_snapshots_verified_fixture_idx
  on public.cfi_market_snapshots(verified_fixture_id,captured_at)
  where verified_fixture_id is not null;

create unique index if not exists cfi_market_snapshots_verified_identity_uq
  on public.cfi_market_snapshots(verified_fixture_id,bookmaker,market_family,period,line,captured_at)
  nulls not distinct
  where verified_fixture_id is not null;

create or replace function public.cfi_market_snapshot_verified_fixture_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v record;
begin
  if new.verified_fixture_id is null then
    return new; -- historical fixture_id path remains backward compatible
  end if;
  select fixture_id,kickoff_at,verification_status
    into v
  from public.cfi_living_verified_fixtures
  where fixture_id=new.verified_fixture_id;
  if not found or v.verification_status <> 'VERIFIED' then
    raise exception 'CFI_VERIFIED_FIXTURE_REQUIRED';
  end if;
  if new.kickoff_at <> v.kickoff_at then
    raise exception 'CFI_MARKET_KICKOFF_MISMATCH';
  end if;
  if new.captured_at >= v.kickoff_at then
    raise exception 'CFI_MARKET_CAPTURE_MUST_PRECEDE_KICKOFF';
  end if;
  return new;
end;
$$;
revoke execute on function public.cfi_market_snapshot_verified_fixture_guard() from public, anon, authenticated;

drop trigger if exists cfi_market_snapshots_verified_fixture_guard on public.cfi_market_snapshots;
create trigger cfi_market_snapshots_verified_fixture_guard
before insert on public.cfi_market_snapshots
for each row execute function public.cfi_market_snapshot_verified_fixture_guard();

alter table public.cfi_market_decision_settlements
  add column if not exists verified_fixture_id uuid null references public.cfi_living_verified_fixtures(fixture_id);

alter table public.cfi_market_decision_settlements
  alter column fixture_id drop not null;

alter table public.cfi_market_decision_settlements
  drop constraint if exists cfi_market_settlement_exactly_one_fixture_ref;
alter table public.cfi_market_decision_settlements
  add constraint cfi_market_settlement_exactly_one_fixture_ref
  check (num_nonnulls(fixture_id, verified_fixture_id) = 1);

create index if not exists cfi_market_decision_settlements_verified_fixture_idx
  on public.cfi_market_decision_settlements(verified_fixture_id,settled_at)
  where verified_fixture_id is not null;

create or replace function public.cfi_market_decision_settlement_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  d_market uuid;
  d_selection text;
  k timestamptz;
  m_fixture uuid;
  m_verified_fixture uuid;
begin
  select market_snapshot_id,selection into d_market,d_selection
  from public.cfi_decision_snapshots
  where decision_snapshot_id=new.decision_snapshot_id;
  if d_market is null then raise exception 'CFI_DECISION_SNAPSHOT_REQUIRED'; end if;
  if d_selection is null then raise exception 'CFI_DECISION_SELECTION_REQUIRED'; end if;
  if d_market <> new.market_snapshot_id then raise exception 'CFI_SETTLEMENT_MARKET_MISMATCH'; end if;
  if d_selection <> new.selection then raise exception 'CFI_SETTLEMENT_SELECTION_MISMATCH'; end if;

  select kickoff_at,fixture_id,verified_fixture_id
    into k,m_fixture,m_verified_fixture
  from public.cfi_market_snapshots
  where market_snapshot_id=new.market_snapshot_id;
  if k is null then raise exception 'CFI_MARKET_SNAPSHOT_REQUIRED'; end if;
  if num_nonnulls(m_fixture,m_verified_fixture) <> 1 then raise exception 'CFI_MARKET_FIXTURE_REFERENCE_INVALID'; end if;
  if m_fixture is not null and new.fixture_id is distinct from m_fixture then
    raise exception 'CFI_SETTLEMENT_FIXTURE_MISMATCH';
  end if;
  if m_verified_fixture is not null and new.verified_fixture_id is distinct from m_verified_fixture then
    raise exception 'CFI_SETTLEMENT_FIXTURE_MISMATCH';
  end if;
  if new.settled_at <= k then raise exception 'CFI_SETTLEMENT_MUST_FOLLOW_KICKOFF'; end if;
  if new.result_provenance is null or new.result_provenance='{}'::jsonb then raise exception 'CFI_RESULT_PROVENANCE_REQUIRED'; end if;
  return new;
end;
$$;
revoke execute on function public.cfi_market_decision_settlement_guard() from public, anon, authenticated;

comment on column public.cfi_market_snapshots.verified_fixture_id is
  'Prospective research fixture reference. Exactly one of fixture_id or verified_fixture_id must be present; future schedules are never inserted into historical BigDB merely to capture odds.';
comment on column public.cfi_market_decision_settlements.verified_fixture_id is
  'Prospective research fixture reference inherited from the immutable market snapshot.';
