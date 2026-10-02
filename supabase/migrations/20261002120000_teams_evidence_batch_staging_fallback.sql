-- teams_evidence_batch: fallback via staging when teams/aliases miss
CREATE OR REPLACE FUNCTION public.teams_evidence_batch(p_team_names text[])
RETURNS TABLE(canonical_name text, evidence_count int)
LANGUAGE sql
STABLE
AS $function$
  WITH names AS (
    SELECT DISTINCT n FROM unnest(p_team_names) AS n
  ),
  resolved AS (
    SELECT n.n AS name, t.team_id 
    FROM names n JOIN teams t ON t.canonical_name = n.n
    UNION
    SELECT n.n AS name, t.team_id 
    FROM names n JOIN teams t ON t.normalized_name = lower(btrim(n.n))
    UNION
    SELECT n.n AS name, a.team_id 
    FROM names n JOIN team_aliases a ON a.alias_normalized = lower(btrim(n.n))
    UNION
    SELECT n.n AS name, s.canonical_home_team_id 
    FROM names n 
    JOIN cfi_living_verified_fixtures s ON s.home_team_norm = lower(btrim(n.n))
    WHERE s.canonical_home_team_id IS NOT NULL
    UNION
    SELECT n.n AS name, s.canonical_away_team_id 
    FROM names n 
    JOIN cfi_living_verified_fixtures s ON s.away_team_norm = lower(btrim(n.n))
    WHERE s.canonical_away_team_id IS NOT NULL
  )
  SELECT r.name, COALESCE(SUM(c.cnt), 0)::int
  FROM resolved r
  CROSS JOIN LATERAL (
    SELECT
      (SELECT COUNT(*) FROM fixtures f WHERE f.home_team_id = r.team_id AND f.ft_home IS NOT NULL AND f.ft_away IS NOT NULL)
      + (SELECT COUNT(*) FROM fixtures f WHERE f.away_team_id = r.team_id AND f.ft_home IS NOT NULL AND f.ft_away IS NOT NULL) AS cnt
  ) c
  GROUP BY r.name;
$function$;

REVOKE ALL ON FUNCTION public.teams_evidence_batch(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teams_evidence_batch(text[]) TO service_role;