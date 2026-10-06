DO $do$
DECLARE
  d text := pg_get_functiondef('public.cfi_suggest_upcoming(integer)'::regprocedure);
  n text;
BEGIN
  n := replace(d,
    $q$v.source_provenance->>'providerId' AS provider_id,$q$,
    $q$v.source_provenance->>'providerId' AS provider_id, v.source_provenance->>'stage' AS stage, v.source_provenance->>'league' AS league,$q$);
  IF n = d THEN RAISE EXCEPTION 'provider_id clause not found'; END IF;
  d := n;
  n := replace(d,
    $q$'home', f.home, 'away', f.away,$q$,
    $q$'home', f.home, 'away', f.away, 'competition', CASE WHEN f.stage IS NOT NULL AND f.league IS NOT NULL AND f.league <> f.stage THEN f.stage || ' · ' || f.league WHEN f.stage IS NOT NULL THEN f.stage ELSE NULL END,$q$);
  IF n = d THEN RAISE EXCEPTION 'home/away clause not found'; END IF;
  EXECUTE n;
END
$do$;
