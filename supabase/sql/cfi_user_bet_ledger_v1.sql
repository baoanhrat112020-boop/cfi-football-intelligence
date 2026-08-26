-- CFI user-confirmed bet ledger V1.
-- It records a user's confirmation and later verified settlement only.
-- It never places a wager and must not be used as prediction evidence.

create extension if not exists pgcrypto;

create table if not exists public.cfi_user_bets (
  bet_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  idempotency_key text not null unique,
  prediction_snapshot_id uuid references public.cfi_prediction_snapshots(snapshot_id) on delete set null,
  target_date date not null,
  home_team text not null,
  away_team text not null,
  market_family text not null check (market_family in ('CHAMPION','1X2','OVER_UNDER','ASIAN_HANDICAP')),
  market text not null,
  period text not null check (period in ('HT','FT')),
  selection text not null check (selection in ('HOME','DRAW','AWAY','OVER','UNDER','3+ HT','7+ FT','OTHER HT','OTHER FT')),
  line numeric,
  decimal_odds numeric not null check (decimal_odds > 1),
  stake numeric not null check (stake > 0),
  bookmaker text not null check (btrim(bookmaker) <> ''),
  confirmed_at timestamptz not null,
  confirmed_by_user boolean not null default true check (confirmed_by_user = true),
  manual_override boolean not null default false,
  source_url text,
  notes text,
  constraint cfi_user_bets_distinct_teams check (lower(btrim(home_team)) <> lower(btrim(away_team))),
  constraint cfi_user_bets_line_required check (
    market_family not in ('OVER_UNDER','ASIAN_HANDICAP') or line is not null
  ),
  constraint cfi_user_bets_selection_family check (
    (market_family = 'CHAMPION' and selection in ('3+ HT','7+ FT','OTHER HT','OTHER FT')) or
    (market_family = '1X2' and selection in ('HOME','DRAW','AWAY')) or
    (market_family = 'OVER_UNDER' and selection in ('OVER','UNDER')) or
    (market_family = 'ASIAN_HANDICAP' and selection in ('HOME','AWAY'))
  ),
  constraint cfi_user_bets_champion_period check (
    (selection in ('3+ HT','OTHER HT') and period = 'HT') or
    (selection in ('7+ FT','OTHER FT') and period = 'FT') or
    (market_family <> 'CHAMPION')
  )
);

create index if not exists cfi_user_bets_confirmed_idx
  on public.cfi_user_bets(confirmed_at desc);
create index if not exists cfi_user_bets_fixture_idx
  on public.cfi_user_bets(target_date, home_team, away_team);

create table if not exists public.cfi_user_bet_settlements (
  settlement_id uuid primary key default gen_random_uuid(),
  bet_id uuid not null unique references public.cfi_user_bets(bet_id) on delete restrict,
  settled_at timestamptz not null default now(),
  settlement_state text not null check (settlement_state in ('FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS')),
  profit_loss numeric not null,
  return_amount numeric not null check (return_amount >= 0),
  actual_ht_home integer not null check (actual_ht_home >= 0),
  actual_ht_away integer not null check (actual_ht_away >= 0),
  actual_ft_home integer not null check (actual_ft_home >= 0),
  actual_ft_away integer not null check (actual_ft_away >= 0),
  result_source_url text not null check (btrim(result_source_url) <> ''),
  result_provenance jsonb not null,
  immutable boolean not null default true check (immutable = true),
  created_at timestamptz not null default now()
);

create index if not exists cfi_user_bet_settlements_settled_idx
  on public.cfi_user_bet_settlements(settled_at desc);

create or replace function public.cfi_user_bet_immutable_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'CFI_USER_BET_LEDGER_APPEND_ONLY';
end;
$$;

drop trigger if exists cfi_user_bets_immutable on public.cfi_user_bets;
create trigger cfi_user_bets_immutable
before update or delete on public.cfi_user_bets
for each row execute function public.cfi_user_bet_immutable_guard();

drop trigger if exists cfi_user_bet_settlements_immutable on public.cfi_user_bet_settlements;
create trigger cfi_user_bet_settlements_immutable
before update or delete on public.cfi_user_bet_settlements
for each row execute function public.cfi_user_bet_immutable_guard();

alter table public.cfi_user_bets enable row level security;
alter table public.cfi_user_bet_settlements enable row level security;
revoke all on public.cfi_user_bets from anon, authenticated;
revoke all on public.cfi_user_bet_settlements from anon, authenticated;
grant select, insert on public.cfi_user_bets to service_role;
grant select, insert on public.cfi_user_bet_settlements to service_role;

create or replace view public.cfi_user_bet_status
with (security_invoker = true)
as
select
  b.bet_id, b.created_at, b.idempotency_key, b.prediction_snapshot_id,
  b.target_date, b.home_team, b.away_team, b.market_family, b.market,
  b.period, b.selection, b.line, b.decimal_odds, b.stake, b.bookmaker,
  b.confirmed_at, b.confirmed_by_user, b.manual_override,
  s.settlement_id, s.settled_at, s.settlement_state, s.profit_loss,
  s.return_amount, s.actual_ht_home, s.actual_ht_away,
  s.actual_ft_home, s.actual_ft_away, s.result_source_url,
  case when s.settlement_id is null then 'RECORDED' else 'SETTLED' end as status
from public.cfi_user_bets b
left join public.cfi_user_bet_settlements s on s.bet_id = b.bet_id;

revoke all on public.cfi_user_bet_status from anon, authenticated;
grant select on public.cfi_user_bet_status to service_role;

comment on table public.cfi_user_bets is
  'Append-only user confirmation ledger. It records a wager only after explicit user confirmation; it never places a wager or feeds model training.';
comment on table public.cfi_user_bet_settlements is
  'Append-only settlement ledger using verified result provenance; it is separate from prediction evidence and learning inputs.';
