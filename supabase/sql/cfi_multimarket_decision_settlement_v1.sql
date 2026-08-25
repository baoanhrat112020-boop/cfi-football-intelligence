-- CFI Multi-Market research-only decision selection + settlement ledger.
-- Forward-only. No historical reconstruction. No production decision use.

alter table public.cfi_decision_snapshots
  add column if not exists selection text;

alter table public.cfi_decision_snapshots
  drop constraint if exists cfi_decision_selection_valid;
alter table public.cfi_decision_snapshots
  add constraint cfi_decision_selection_valid
  check (selection is null or selection in ('HOME','DRAW','AWAY','OVER','UNDER'));

create table if not exists public.cfi_market_decision_settlements (
  settlement_id uuid primary key default gen_random_uuid(),
  decision_snapshot_id uuid not null unique references public.cfi_decision_snapshots(decision_snapshot_id),
  market_snapshot_id uuid not null references public.cfi_market_snapshots(market_snapshot_id),
  fixture_id uuid not null references public.fixtures(fixture_id),
  selection text not null check (selection in ('HOME','DRAW','AWAY','OVER','UNDER')),
  settlement_state text not null check (settlement_state in ('FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS')),
  actual_home_goals integer not null check (actual_home_goals >= 0),
  actual_away_goals integer not null check (actual_away_goals >= 0),
  settled_at timestamptz not null,
  result_provenance jsonb not null,
  research_only boolean not null default true check (research_only = true),
  immutable boolean not null default true check (immutable = true),
  created_at timestamptz not null default now()
);

create index if not exists cfi_market_decision_settlements_fixture_idx
  on public.cfi_market_decision_settlements(fixture_id,settled_at);

alter table public.cfi_market_decision_settlements enable row level security;
revoke all on public.cfi_market_decision_settlements from anon, authenticated;

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
begin
  select market_snapshot_id,selection into d_market,d_selection
  from public.cfi_decision_snapshots
  where decision_snapshot_id=new.decision_snapshot_id;
  if d_market is null then raise exception 'CFI_DECISION_SNAPSHOT_REQUIRED'; end if;
  if d_selection is null then raise exception 'CFI_DECISION_SELECTION_REQUIRED'; end if;
  if d_market <> new.market_snapshot_id then raise exception 'CFI_SETTLEMENT_MARKET_MISMATCH'; end if;
  if d_selection <> new.selection then raise exception 'CFI_SETTLEMENT_SELECTION_MISMATCH'; end if;
  select kickoff_at,fixture_id into k,m_fixture from public.cfi_market_snapshots where market_snapshot_id=new.market_snapshot_id;
  if k is null then raise exception 'CFI_MARKET_SNAPSHOT_REQUIRED'; end if;
  if m_fixture <> new.fixture_id then raise exception 'CFI_SETTLEMENT_FIXTURE_MISMATCH'; end if;
  if new.settled_at <= k then raise exception 'CFI_SETTLEMENT_MUST_FOLLOW_KICKOFF'; end if;
  if new.result_provenance is null or new.result_provenance='{}'::jsonb then raise exception 'CFI_RESULT_PROVENANCE_REQUIRED'; end if;
  return new;
end;
$$;
revoke execute on function public.cfi_market_decision_settlement_guard() from public, anon, authenticated;

drop trigger if exists cfi_market_decision_settlement_insert_guard on public.cfi_market_decision_settlements;
create trigger cfi_market_decision_settlement_insert_guard
before insert on public.cfi_market_decision_settlements
for each row execute function public.cfi_market_decision_settlement_guard();

drop trigger if exists cfi_market_decision_settlement_immutable on public.cfi_market_decision_settlements;
create trigger cfi_market_decision_settlement_immutable
before update or delete on public.cfi_market_decision_settlements
for each row execute function public.cfi_multimarket_snapshot_immutable_guard();

comment on table public.cfi_market_decision_settlements is 'Research-only append-only post-kickoff settlement ledger for forward multi-market simulated decisions. Never reconstruct historical decisions.';
