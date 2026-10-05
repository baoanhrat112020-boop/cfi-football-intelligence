DO $do$
DECLARE
  d text := pg_get_functiondef('public.cfi_suggest_upcoming(integer)'::regprocedure);
  n text := d;
BEGIN
  n := replace(
    n,
    $q$SELECT v.fixture_id, v.kickoff_at, v.home_team AS home$q$,
    $q$SELECT DISTINCT ON (v.canonical_home_team_id, v.canonical_away_team_id, v.kickoff_at) v.fixture_id, v.source_provenance->>'providerId' AS provider_id, v.kickoff_at, v.home_team AS home$q$
  );
  IF n = d THEN RAISE EXCEPTION 'select clause not found'; END IF;
  d := n;
  n := replace(
    n,
    E'AND v.canonical_away_team_id IS NOT NULL\n  ),\n  lambdas AS (',
    E'AND v.canonical_away_team_id IS NOT NULL\n    ORDER BY v.canonical_home_team_id, v.canonical_away_team_id, v.kickoff_at, (v.source_name = ''LIVESCORE'') DESC, v.fixture_id\n  ),\n  lambdas AS ('
  );
  IF n = d THEN RAISE EXCEPTION 'where clause end not found'; END IF;
  d := n;
  n := replace(
    n,
    $q$'fixture_id', f.fixture_id,$q$,
    $q$'fixture_id', f.fixture_id, 'provider_id', f.provider_id,$q$
  );
  IF n = d THEN RAISE EXCEPTION 'json clause not found'; END IF;
  EXECUTE n;
END
$do$;
