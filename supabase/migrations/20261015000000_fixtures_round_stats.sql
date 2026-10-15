BEGIN;

ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS round integer;
ALTER TABLE public.fixtures ADD COLUMN IF NOT EXISTS round_label text;

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
  v_clash_filled integer := 0;
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
      status text, competition_key text, competition_name text, tier text,
      round integer, round_label text, country text
    )
    ORDER BY r.fixture_id
  ),
  clash AS (
    SELECT s.fixture_id, x.fixture_id AS existing_id
    FROM src s
    JOIN public.fixtures x
      ON x.match_date = s.match_date
     AND x.home_team_id = s.home_team_id
     AND x.away_team_id = s.away_team_id
     AND x.fixture_id <> s.fixture_id
  ),
  fill AS (
    UPDATE public.fixtures x
       SET round = COALESCE(x.round, s.round),
           round_label = COALESCE(x.round_label, s.round_label),
           country = COALESCE(x.country, s.country),
           updated_at = now()
      FROM clash c
      JOIN src s ON s.fixture_id = c.fixture_id
     WHERE x.fixture_id = c.existing_id
       AND ((x.round IS NULL AND s.round IS NOT NULL)
         OR (x.round_label IS NULL AND s.round_label IS NOT NULL)
         OR (x.country IS NULL AND s.country IS NOT NULL))
    RETURNING 1
  ),
  up AS (
    INSERT INTO public.fixtures AS f (
      fixture_id, match_date, home_team_id, away_team_id,
      ht_home, ht_away, ft_home, ft_away,
      status, competition_key, tier, competition_name,
      round, round_label, country
    )
    SELECT s.fixture_id, s.match_date, s.home_team_id, s.away_team_id,
           s.ht_home, s.ht_away, s.ft_home, s.ft_away,
           COALESCE(s.status, 'CANONICAL'), s.competition_key, COALESCE(s.tier, 'minor'), s.competition_name,
           s.round, s.round_label, s.country
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
      round = COALESCE(EXCLUDED.round, f.round),
      round_label = COALESCE(EXCLUDED.round_label, f.round_label),
      country = COALESCE(EXCLUDED.country, f.country),
      updated_at = now()
    WHERE (f.ht_home, f.ht_away, f.ft_home, f.ft_away, f.round, f.round_label, f.country)
          IS DISTINCT FROM
          (EXCLUDED.ht_home, EXCLUDED.ht_away, EXCLUDED.ft_home, EXCLUDED.ft_away,
           COALESCE(EXCLUDED.round, f.round), COALESCE(EXCLUDED.round_label, f.round_label), COALESCE(EXCLUDED.country, f.country))
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COALESCE(count(*) FILTER (WHERE inserted), 0),
         COALESCE(count(*) FILTER (WHERE NOT inserted), 0),
         (SELECT count(*) FROM clash),
         (SELECT count(*) FROM fill)
    INTO v_inserted, v_updated, v_other_id, v_clash_filled
  FROM up;

  RETURN jsonb_build_object(
    'status', 'OK',
    'received', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_total - v_inserted - v_updated,
    'skipped_other_fixture_id', v_other_id,
    'filled_on_clash', v_clash_filled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_round_stats(p_country text DEFAULT NULL, p_league text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH season AS (
  SELECT (date_trunc('year', current_date - interval '6 months') + interval '6 months')::date AS start_date
),
base AS (
  SELECT f.fixture_id, f.match_date, f.round, f.country,
         f.competition_name,
         lower(regexp_replace(COALESCE(f.competition_name, ''), '\s', '', 'g')) AS league_key,
         lower(f.country) AS country_key,
         f.ht_home, f.ht_away, f.ft_home, f.ft_away,
         f.home_team_id, f.away_team_id
  FROM public.fixtures f, season s
  WHERE f.round IS NOT NULL AND f.country IS NOT NULL
    AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL
    AND f.match_date >= s.start_date
),
leagues AS (
  SELECT country_key, league_key, min(country) AS country, min(competition_name) AS league,
         count(*) AS n_matches, count(DISTINCT round) AS n_rounds, max(round) AS last_round
  FROM base
  GROUP BY country_key, league_key
  HAVING count(*) >= 10
),
sel AS (
  SELECT * FROM base
  WHERE p_country IS NOT NULL AND p_league IS NOT NULL
    AND country_key = lower(p_country)
    AND league_key = lower(regexp_replace(p_league, '\s', '', 'g'))
),
rounds AS (
  SELECT s.round, count(*) AS n,
         count(*) FILTER (WHERE s.ht_home + s.ht_away >= 1) AS o05_ht,
         count(*) FILTER (WHERE s.ht_home + s.ht_away >= 2) AS o15_ht,
         count(*) FILTER (WHERE s.ft_home + s.ft_away >= 1) AS o05_ft,
         count(*) FILTER (WHERE s.ft_home + s.ft_away >= 2) AS o15_ft,
         count(*) FILTER (WHERE s.ft_home + s.ft_away >= 3) AS o25_ft,
         count(*) FILTER (WHERE s.ft_home + s.ft_away >= 4) AS o35_ft,
         count(*) FILTER (WHERE s.ht_home > 0 AND s.ht_away > 0) AS btts_ht,
         count(*) FILTER (WHERE s.ft_home > 0 AND s.ft_away > 0) AS btts_ft,
         jsonb_agg(jsonb_build_object(
           'date', s.match_date,
           'home', COALESCE(th.canonical_name, '?'), 'away', COALESCE(ta.canonical_name, '?'),
           'ht', s.ht_home || '-' || s.ht_away, 'ft', s.ft_home || '-' || s.ft_away
         ) ORDER BY s.match_date, s.fixture_id) AS matches
  FROM sel s
  LEFT JOIN public.teams th ON th.team_id::text = s.home_team_id::text
  LEFT JOIN public.teams ta ON ta.team_id::text = s.away_team_id::text
  GROUP BY s.round
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'season_start', (SELECT start_date FROM season),
  'leagues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'country', country, 'league', league, 'n_matches', n_matches, 'n_rounds', n_rounds, 'last_round', last_round)
      ORDER BY n_matches DESC, country, league) FROM (SELECT * FROM leagues ORDER BY n_matches DESC LIMIT 80) l), '[]'::jsonb),
  'rounds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'round', round, 'n', n, 'complete', n >= 0.9 * (SELECT max(n) FROM rounds),
      'o05_ht', o05_ht, 'o15_ht', o15_ht, 'o05_ft', o05_ft, 'o15_ft', o15_ft, 'o25_ft', o25_ft, 'o35_ft', o35_ft,
      'btts_ht', btts_ht, 'btts_ft', btts_ft, 'matches', matches) ORDER BY round DESC) FROM rounds), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_round_stats(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_round_stats(text, text) TO service_role;

COMMIT;
