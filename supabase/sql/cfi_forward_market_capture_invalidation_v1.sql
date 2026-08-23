-- CFI forward market capture invalidation V1.
-- Append-only correction ledger for immutable forward captures.
-- Invalidated captures remain preserved as evidence but never count toward readiness.

create table if not exists public.cfi_forward_market_capture_invalidations (
  invalidation_id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.cfi_forward_market_captures(capture_id),
  reason_code text not null,
  reason_detail text null,
  verifier_source_name text not null,
  verifier_source_url text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(capture_id)
);

alter table public.cfi_forward_market_capture_invalidations enable row level security;
revoke all on public.cfi_forward_market_capture_invalidations from anon,authenticated;

create or replace function public.cfi_forward_capture_invalidation_immutable_guard()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'CFI_FORWARD_CAPTURE_INVALIDATION_IMMUTABLE';
end;$$;
revoke execute on function public.cfi_forward_capture_invalidation_immutable_guard() from public,anon,authenticated;

drop trigger if exists cfi_forward_capture_invalidation_immutable on public.cfi_forward_market_capture_invalidations;
create trigger cfi_forward_capture_invalidation_immutable before update or delete on public.cfi_forward_market_capture_invalidations for each row execute function public.cfi_forward_capture_invalidation_immutable_guard();

create or replace view public.cfi_forward_market_readiness_v1 as
with verified as (
  select c.*
  from public.cfi_forward_market_captures c
  left join public.cfi_forward_market_capture_invalidations i on i.capture_id=c.capture_id
  where c.verification_status='VERIFIED_PREMATCH'
    and c.kickoff_verified=true
    and c.captured_at<c.kickoff_at
    and i.capture_id is null
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

comment on table public.cfi_forward_market_capture_invalidations is 'Append-only correction ledger; invalidated immutable captures are preserved but excluded from readiness.';
