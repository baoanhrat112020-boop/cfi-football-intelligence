-- Research-only append-only settlement resolver for market snapshots that may
-- reference either canonical fixtures or immutable living verified fixtures.
-- No prediction/market snapshot rewrite and no production decision use.
create or replace function public.cfi_settle_forward_market_ready_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_canonical_fixture_id uuid;
  v_match_count integer;
  v_ft_home integer;
  v_ft_away integer;
  v_fixture_status text;
  v_state text;
  v_inserted integer := 0;
  v_already integer := 0;
  v_pending_result integer := 0;
  v_pending_identity integer := 0;
  v_ambiguous integer := 0;
  v_scanned integer := 0;
  v_rows integer;
begin
  for r in
    select d.decision_snapshot_id,d.market_snapshot_id,d.selection,
           m.fixture_id,m.verified_fixture_id,m.kickoff_at,m.market_family,m.period
    from public.cfi_decision_snapshots d
    join public.cfi_market_snapshots m on m.market_snapshot_id=d.market_snapshot_id
    left join public.cfi_market_decision_settlements s on s.decision_snapshot_id=d.decision_snapshot_id
    where s.decision_snapshot_id is null
      and m.research_only=true
      and m.kickoff_at < now()
      and m.market_family='1X2'
      and m.period='FT'
    order by m.kickoff_at,d.decision_snapshot_id
    limit 200
  loop
    v_scanned := v_scanned + 1;
    v_canonical_fixture_id := null;
    v_match_count := 0;

    if r.fixture_id is not null then
      v_canonical_fixture_id := r.fixture_id;
      v_match_count := 1;
    elsif r.verified_fixture_id is not null then
      select min(f.fixture_id::text)::uuid, count(*)
        into v_canonical_fixture_id, v_match_count
      from public.cfi_living_verified_fixtures l
      join public.fixtures f
        on f.match_date=l.target_date
       and f.home_team_id=l.canonical_home_team_id
       and f.away_team_id=l.canonical_away_team_id
      where l.fixture_id=r.verified_fixture_id
        and l.verification_status='VERIFIED'
        and l.canonical_home_team_id is not null
        and l.canonical_away_team_id is not null
        and l.kickoff_at=r.kickoff_at;
    end if;

    if v_match_count = 0 or v_canonical_fixture_id is null then
      v_pending_identity := v_pending_identity + 1;
      continue;
    elsif v_match_count > 1 then
      v_ambiguous := v_ambiguous + 1;
      continue;
    end if;

    select f.ft_home,f.ft_away,f.status
      into v_ft_home,v_ft_away,v_fixture_status
    from public.fixtures f
    where f.fixture_id=v_canonical_fixture_id;

    if v_ft_home is null or v_ft_away is null then
      v_pending_result := v_pending_result + 1;
      continue;
    end if;

    v_state := case
      when r.selection='HOME' and v_ft_home>v_ft_away then 'FULL_WIN'
      when r.selection='DRAW' and v_ft_home=v_ft_away then 'FULL_WIN'
      when r.selection='AWAY' and v_ft_home<v_ft_away then 'FULL_WIN'
      else 'FULL_LOSS'
    end;

    insert into public.cfi_market_decision_settlements(
      decision_snapshot_id,market_snapshot_id,fixture_id,verified_fixture_id,
      selection,settlement_state,actual_home_goals,actual_away_goals,
      settled_at,result_provenance,research_only,immutable
    ) values (
      r.decision_snapshot_id,r.market_snapshot_id,
      case when r.fixture_id is not null then v_canonical_fixture_id else null end,
      case when r.fixture_id is null then r.verified_fixture_id else null end,
      r.selection,v_state,v_ft_home,v_ft_away,now(),
      jsonb_build_object(
        'source','CANONICAL_FIXTURE_READ_ONLY_RESOLUTION',
        'resolverVersion','CFI_FORWARD_MARKET_SETTLEMENT_V2',
        'resolvedCanonicalFixtureId',v_canonical_fixture_id,
        'marketFixtureRefType',case when r.fixture_id is not null then 'CANONICAL_FIXTURE_ID' else 'VERIFIED_LIVING_FIXTURE_ID' end,
        'fixtureStatus',v_fixture_status,
        'identityBridge',case when r.fixture_id is null then 'VERIFIED_LIVING_TEAM_IDS_SAME_DATE_KICKOFF' else 'DIRECT_CANONICAL' end
      ),
      true,true
    )
    on conflict(decision_snapshot_id) do nothing;

    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_inserted := v_inserted + 1; else v_already := v_already + 1; end if;
  end loop;

  return jsonb_build_object(
    'status','OK',
    'version','CFI_FORWARD_MARKET_SETTLEMENT_V2',
    'researchOnly',true,
    'decisionUse',false,
    'productionMutation',false,
    'scanned',v_scanned,
    'inserted',v_inserted,
    'alreadySettledRace',v_already,
    'pendingResult',v_pending_result,
    'pendingIdentity',v_pending_identity,
    'ambiguousIdentity',v_ambiguous
  );
end;
$$;
