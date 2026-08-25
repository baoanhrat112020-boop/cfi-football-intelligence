-- CFI Multi-Market research-only forward market/decision snapshots.
-- No historical odds reconstruction. No production decisionUse.

create table if not exists public.cfi_market_snapshots (
  market_snapshot_id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(fixture_id),
  captured_at timestamptz not null,
  kickoff_at timestamptz not null,
  bookmaker text not null,
  market_family text not null check (market_family in ('1X2','OVER_UNDER','ASIAN_HANDICAP')),
  period text not null check (period in ('HT','FT')),
  line numeric null,
  odds_home numeric null check (odds_home is null or odds_home > 1),
  odds_draw numeric null check (odds_draw is null or odds_draw > 1),
  odds_away numeric null check (odds_away is null or odds_away > 1),
  odds_over numeric null check (odds_over is null or odds_over > 1),
  odds_under numeric null check (odds_under is null or odds_under > 1),
  source_name text not null,
  source_url text null,
  source_provenance jsonb not null default '{}'::jsonb,
  is_closing boolean not null default false,
  research_only boolean not null default true check (research_only = true),
  created_at timestamptz not null default now(),
  constraint cfi_market_snapshot_pre_kickoff check (captured_at < kickoff_at),
  constraint cfi_market_snapshot_family_shape check (
    (market_family='1X2' and odds_home is not null and odds_draw is not null and odds_away is not null)
    or (market_family='OVER_UNDER' and line is not null and odds_over is not null and odds_under is not null)
    or (market_family='ASIAN_HANDICAP' and line is not null and odds_home is not null and odds_away is not null)
  ),
  unique (fixture_id, bookmaker, market_family, period, line, captured_at)
);

create table if not exists public.cfi_decision_snapshots (
  decision_snapshot_id uuid primary key default gen_random_uuid(),
  prediction_snapshot_id uuid not null references public.cfi_prediction_snapshots(snapshot_id),
  market_snapshot_id uuid not null references public.cfi_market_snapshots(market_snapshot_id),
  cfi_probability numeric not null check (cfi_probability >= 0 and cfi_probability <= 1),
  market_probability numeric not null check (market_probability >= 0 and market_probability <= 1),
  edge numeric not null,
  uncertainty jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('BET_SIMULATED','WATCH','PASS','SHADOW')),
  stake_simulated numeric not null default 0 check (stake_simulated >= 0),
  decision_timestamp timestamptz not null,
  decision_use boolean not null default false check (decision_use = false),
  research_only boolean not null default true check (research_only = true),
  created_at timestamptz not null default now(),
  constraint cfi_simulated_stake_only check (stake_simulated = 0 or decision='BET_SIMULATED')
);

create index if not exists cfi_market_snapshots_fixture_idx on public.cfi_market_snapshots(fixture_id,captured_at);
create index if not exists cfi_decision_snapshots_market_idx on public.cfi_decision_snapshots(market_snapshot_id,decision_timestamp);

alter table public.cfi_market_snapshots enable row level security;
alter table public.cfi_decision_snapshots enable row level security;
revoke all on public.cfi_market_snapshots from anon, authenticated;
revoke all on public.cfi_decision_snapshots from anon, authenticated;

create or replace function public.cfi_multimarket_snapshot_immutable_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'CFI_RESEARCH_SNAPSHOT_IMMUTABLE';
end;
$$;
revoke execute on function public.cfi_multimarket_snapshot_immutable_guard() from public, anon, authenticated;

drop trigger if exists cfi_market_snapshots_immutable on public.cfi_market_snapshots;
create trigger cfi_market_snapshots_immutable before update or delete on public.cfi_market_snapshots for each row execute function public.cfi_multimarket_snapshot_immutable_guard();
drop trigger if exists cfi_decision_snapshots_immutable on public.cfi_decision_snapshots;
create trigger cfi_decision_snapshots_immutable before update or delete on public.cfi_decision_snapshots for each row execute function public.cfi_multimarket_snapshot_immutable_guard();

create or replace function public.cfi_decision_snapshot_temporal_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  k timestamptz;
  closing boolean;
begin
  select kickoff_at,is_closing into k,closing from public.cfi_market_snapshots where market_snapshot_id=new.market_snapshot_id;
  if k is null then raise exception 'CFI_MARKET_SNAPSHOT_REQUIRED'; end if;
  if closing then raise exception 'CFI_CLOSING_PRICE_NOT_ALLOWED_FOR_PREMATCH_DECISION'; end if;
  if new.decision_timestamp >= k then raise exception 'CFI_DECISION_MUST_PRECEDE_KICKOFF'; end if;
  return new;
end;
$$;
revoke execute on function public.cfi_decision_snapshot_temporal_guard() from public, anon, authenticated;

drop trigger if exists cfi_decision_snapshots_temporal on public.cfi_decision_snapshots;
create trigger cfi_decision_snapshots_temporal before insert on public.cfi_decision_snapshots for each row execute function public.cfi_decision_snapshot_temporal_guard();

comment on table public.cfi_market_snapshots is 'Research-only append-only pre-match market price snapshots. Closing rows may be stored for evaluation but never referenced by pre-match decision snapshots.';
comment on table public.cfi_decision_snapshots is 'Research-only append-only simulated decisions. decision_use is permanently false in V1; no production betting action is permitted.';
