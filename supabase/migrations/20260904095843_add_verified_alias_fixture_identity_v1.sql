-- Canonical unique-fixture identity for prediction audit/learning.
-- Keeps every immutable snapshot, but groups verified aliases for evaluation only.

create or replace view public.cfi_prediction_fixture_identity_v1
with (security_invoker = true)
as
with resolved as (
  select
    e.snapshot_id,
    e.target_date,
    e.home_team,
    e.away_team,
    e.prediction_created_at,
    e.selected_for_match_audit,
    e.settlement_status,
    public.cfi_resolve_team_name(e.home_team) as home_resolution,
    public.cfi_resolve_team_name(e.away_team) as away_resolution
  from public.cfi_prediction_evaluation e
), keyed as (
  select
    r.snapshot_id,
    r.target_date,
    r.home_team,
    r.away_team,
    r.prediction_created_at,
    r.selected_for_match_audit,
    r.settlement_status,
    r.home_resolution,
    r.away_resolution,
    (r.home_resolution ->> 'team_id')::uuid as canonical_home_team_id,
    (r.away_resolution ->> 'team_id')::uuid as canonical_away_team_id,
    case
      when (r.home_resolution ->> 'status') = 'RESOLVED'
       and (r.away_resolution ->> 'status') = 'RESOLVED'
      then r.target_date::text || '|' || (r.home_resolution ->> 'team_id') || '|' || (r.away_resolution ->> 'team_id')
      else 'SNAPSHOT|' || r.snapshot_id::text
    end as fixture_identity_key,
    (r.home_resolution ->> 'status') = 'RESOLVED'
      and (r.away_resolution ->> 'status') = 'RESOLVED' as identity_resolved
  from resolved r
), ranked as (
  select
    k.*,
    first_value(k.snapshot_id) over (
      partition by k.fixture_identity_key
      order by k.prediction_created_at, k.snapshot_id
    ) as representative_snapshot_id,
    count(*) over (partition by k.fixture_identity_key) as snapshot_count_for_fixture,
    row_number() over (
      partition by k.fixture_identity_key
      order by k.prediction_created_at, k.snapshot_id
    ) as fixture_snapshot_rank,
    count(*) filter (where k.selected_for_match_audit) over (
      partition by k.fixture_identity_key
    ) as selected_snapshot_count_for_fixture,
    first_value(k.snapshot_id) over (
      partition by k.fixture_identity_key
      order by case when k.selected_for_match_audit then 0 else 1 end,
               k.prediction_created_at,
               k.snapshot_id
    ) as selected_representative_candidate,
    row_number() over (
      partition by k.fixture_identity_key
      order by case when k.selected_for_match_audit then 0 else 1 end,
               k.prediction_created_at,
               k.snapshot_id
    ) as selected_priority_rank
  from keyed k
)
select
  r.snapshot_id,
  r.target_date,
  r.home_team,
  r.away_team,
  r.prediction_created_at,
  r.selected_for_match_audit,
  r.settlement_status,
  r.home_resolution,
  r.away_resolution,
  r.canonical_home_team_id,
  r.canonical_away_team_id,
  r.fixture_identity_key,
  r.identity_resolved,
  r.representative_snapshot_id,
  r.snapshot_count_for_fixture,
  r.fixture_snapshot_rank,
  r.selected_snapshot_count_for_fixture,
  r.selected_representative_candidate,
  r.selected_priority_rank,
  case
    when r.selected_snapshot_count_for_fixture > 0 then r.selected_representative_candidate
    else null::uuid
  end as selected_representative_snapshot_id
from ranked r;

revoke all on table public.cfi_prediction_fixture_identity_v1 from public, anon, authenticated;
grant select on table public.cfi_prediction_fixture_identity_v1 to service_role;
