CREATE OR REPLACE FUNCTION public.cfi_upsert_livescore_fixtures(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_other_id integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status', 'ERROR', 'reason', 'ROWS_ARRAY_REQUIRED');
  END IF;
  v_total := jsonb_array_length(p_rows);
  IF v_total > 500 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'reason', 'MAX_500_ROWS');
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (r.fixture_id) r.*
    FROM jsonb_to_recordset(p_rows) AS r(
      fixture_id uuid, match_date date, home_team_id uuid, away_team_id uuid,
      ht_home integer, ht_away integer, ft_home integer, ft_away integer,
      status text, competition_key text, competition_name text, tier text
    )
    ORDER BY r.fixture_id
  ),
  clash AS (
    SELECT s.fixture_id
    FROM src s
    JOIN public.fixtures x
      ON x.match_date = s.match_date
     AND x.home_team_id = s.home_team_id
     AND x.away_team_id = s.away_team_id
     AND x.fixture_id <> s.fixture_id
  ),
  up AS (
    INSERT INTO public.fixtures AS f (
      fixture_id, match_date, home_team_id, away_team_id,
      ht_home, ht_away, ft_home, ft_away,
      status, competition_key, tier, competition_name
    )
    SELECT s.fixture_id, s.match_date, s.home_team_id, s.away_team_id,
           s.ht_home, s.ht_away, s.ft_home, s.ft_away,
           COALESCE(s.status, 'CANONICAL'), s.competition_key, COALESCE(s.tier, 'minor'), s.competition_name
    FROM src s
    WHERE s.fixture_id NOT IN (SELECT fixture_id FROM clash)
    ON CONFLICT (fixture_id) DO UPDATE SET
      match_date = EXCLUDED.match_date,
      home_team_id = EXCLUDED.home_team_id,
      away_team_id = EXCLUDED.away_team_id,
      ht_home = EXCLUDED.ht_home,
      ht_away = EXCLUDED.ht_away,
      ft_home = EXCLUDED.ft_home,
      ft_away = EXCLUDED.ft_away,
      status = EXCLUDED.status,
      competition_key = EXCLUDED.competition_key,
      tier = EXCLUDED.tier,
      competition_name = EXCLUDED.competition_name,
      updated_at = now()
    WHERE (f.ht_home, f.ht_away, f.ft_home, f.ft_away)
          IS DISTINCT FROM
          (EXCLUDED.ht_home, EXCLUDED.ht_away, EXCLUDED.ft_home, EXCLUDED.ft_away)
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COALESCE(count(*) FILTER (WHERE inserted), 0),
         COALESCE(count(*) FILTER (WHERE NOT inserted), 0),
         (SELECT count(*) FROM clash)
    INTO v_inserted, v_updated, v_other_id
  FROM up;

  RETURN jsonb_build_object(
    'status', 'OK',
    'received', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_total - v_inserted - v_updated,
    'skipped_other_fixture_id', v_other_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) TO service_role;
