-- CFI forward market capture staging V1.
-- Research-only. Allows real odds capture before a canonical future fixture exists.
-- Does not mutate fixtures/teams and does not make betting decisions.

create table if not exists public.cfi_forward_market_captures (
  capture_id uuid primary key default gen_random_uuid(),
  external_fixture_key text not null,
  home_team text not null,
  away_team text not null,
  competition text null,
  scheduled_at_raw text not null,
  kickoff_at timestamptz null,
  kickoff_verified boolean not null default false,
  bookmaker text not null,
  market_family text not null check (market_family in ('1X2','OVER_UNDER','ASIAN_HANDICAP')),
  period text not null default 'FT' check (period in ('HT','FT')),
  line numeric null,
  odds_home numeric null check (odds_home is null or odds_home > 1),
  odds_draw numeric null check (odds_draw is null or odds_draw > 1),
  odds_away numeric null check (odds_away is null or odds_away > 1),
  odds_over numeric null check (odds_over is null or odds_over > 1),
  odds_under numeric null check (odds_under is null or odds_under > 1),
  source_name text not null,
  source_url text not null,
  source_observed_at_raw text null,
  source_provenance jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  verification_status text not null default 'RAW' check (verification_status in ('RAW','VERIFIED_PREMATCH','REJECTED','EXPIRED')),
  research_only boolean not null default true check (research_only=true),
  constraint cfi_forward_capture_family_shape check (
    (market_family='1X2' and odds_home is not null and odds_draw is not null and odds_away is not null)
    or (market_family='OVER_UNDER' and line is not null and odds_over is not null and odds_under is not null)
    or (market_family='ASIAN_HANDICAP' and line is not null and odds_home is not null and odds_away is not null)
  ),
  constraint cfi_forward_verified_temporal check (
    verification_status <> 'VERIFIED_PREMATCH'
    or (kickoff_verified=true and kickoff_at is not null and captured_at < kickoff_at)
  ),
  unique(external_fixture_key,bookmaker,market_family,period,line,source_name,source_observed_at_raw)
);

create index if not exists cfi_forward_capture_status_idx on public.cfi_forward_market_captures(verification_status,market_family,captured_at);
create index if not exists cfi_forward_capture_fixture_idx on public.cfi_forward_market_captures(external_fixture_key,captured_at);

alter table public.cfi_forward_market_captures enable row level security;
revoke all on public.cfi_forward_market_captures from anon,authenticated;

create or replace function public.cfi_forward_capture_immutable_guard()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'CFI_FORWARD_CAPTURE_IMMUTABLE';
end;$$;
revoke execute on function public.cfi_forward_capture_immutable_guard() from public,anon,authenticated;

drop trigger if exists cfi_forward_capture_immutable on public.cfi_forward_market_captures;
create trigger cfi_forward_capture_immutable before update or delete on public.cfi_forward_market_captures for each row execute function public.cfi_forward_capture_immutable_guard();

-- Verification is append-only: a verifier writes a new verified row with a new source_observed_at_raw/version,
-- never mutates a RAW capture. Candidate thresholds count VERIFIED_PREMATCH only.
create or replace view public.cfi_forward_market_readiness_v1 as
with verified as (
  select * from public.cfi_forward_market_captures
  where verification_status='VERIFIED_PREMATCH' and kickoff_verified=true and captured_at<kickoff_at
),
base as (
  select
    count(*) filter(where market_family='1X2') as verified_1x2_rows,
    count(distinct external_fixture_key) filter(where market_family='1X2') as verified_1x2_fixtures,
    count(*) as verified_all_rows,
    count(distinct external_fixture_key) as verified_all_fixtures,
    count(*) filter(where kickoff_at-captured_at > interval '6 hours') as early_rows,
    count(*) filter(where kickoff_at-captured_at <= interval '6 hours') as late_rows
  from verified
), settled as (
  select count(*) as settled_decisions
  from public.cfi_market_decision_settlements s
  join public.cfi_decision_snapshots d on d.decision_snapshot_id=s.decision_snapshot_id
)
select
  b.*,
  s.settled_decisions,
  (b.verified_1x2_fixtures>=30) as k035_ready,
  (b.verified_all_rows>=30 and b.early_rows>=10 and b.late_rows>=10) as k036_ready,
  (s.settled_decisions>=30) as k037_ready,
  (s.settled_decisions>=30) as k022_ready
from base b cross join settled s;

create or replace function public.cfi_refresh_market_candidate_readiness_v1()
returns table(experiment_code text,old_status text,new_status text,reason text)
language plpgsql security invoker set search_path=public as $$
declare r record; ready boolean;
begin
  select * into r from public.cfi_forward_market_readiness_v1;
  for experiment_code,ready,reason in
    select * from (values
      ('K035-ODDS-DEVIG-FL-BIAS',r.k035_ready,'>=30 distinct verified pre-match 1X2 fixtures'),
      ('K036-MARKET-TIMING-CALIBRATION',r.k036_ready,'>=30 verified rows with >=10 early and >=10 late captures'),
      ('K037-PROSPECTIVE-MARKET-BASELINE',r.k037_ready,'>=30 settled prospective decisions'),
      ('K022-DECISION-UTILITY-REPLAY',r.k022_ready,'>=30 settled prospective decisions')
    ) v(code,is_ready,why)
  loop
    if ready then
      return query
      with prior as (
        select q.status from public.cfi_research_candidate_queue q where q.experiment_code=cfi_refresh_market_candidate_readiness_v1.experiment_code
      ), upd as (
        update public.cfi_research_candidate_queue q set status='TESTING',updated_at=now()
        where q.experiment_code=cfi_refresh_market_candidate_readiness_v1.experiment_code and q.status='BLOCKED'
        returning q.status
      )
      select cfi_refresh_market_candidate_readiness_v1.experiment_code,
             coalesce((select status from prior),'MISSING'),
             case when exists(select 1 from upd) then 'TESTING' else coalesce((select status from prior),'MISSING') end,
             cfi_refresh_market_candidate_readiness_v1.reason;
    end if;
  end loop;
end;$$;

comment on table public.cfi_forward_market_captures is 'Research-only append-only raw/verified real market captures. RAW captures do not count toward promotion; verified distinct samples only.';
comment on view public.cfi_forward_market_readiness_v1 is 'Fail-closed candidate readiness. >=30 never means promotion; it only permits TESTING.';
