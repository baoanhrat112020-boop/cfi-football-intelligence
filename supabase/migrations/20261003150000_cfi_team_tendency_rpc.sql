DROP FUNCTION IF EXISTS cfi_team_tendency_by_names(text[]);

CREATE OR REPLACE FUNCTION cfi_team_tendency_by_names(p_names text[])
RETURNS TABLE(
  team_name text,
  market text,
  flag text,
  n_matches int,
  n_events int,
  rate float,
  lift float
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT t.canonical_name, tt.market, tt.flag, tt.n_matches, tt.n_events,
         tt.rate::float, tt.lift::float
  FROM team_tendency tt
  JOIN teams t ON t.team_id::text = tt.team_id
  WHERE t.canonical_name = ANY(p_names)
    AND tt.flag IN ('HIGH', 'MEDIUM');
$$;

GRANT EXECUTE ON FUNCTION cfi_team_tendency_by_names(text[])
  TO service_role, anon, authenticated;