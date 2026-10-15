BEGIN;

CREATE OR REPLACE FUNCTION public.cfi_league_key(p_country text, p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
SELECT CASE
  WHEN lower(COALESCE(p_country, '')) = 'belgium'
       AND s.k IN ('firstdivisiona', 'proleague', 'jupilerproleague') THEN 'belgianproleague'
  ELSE s.k
END
FROM (SELECT translate(lower(regexp_replace(COALESCE(p_name, ''), '\s', '', 'g')), 'üöäéèáàçñ', 'uoaeeaacn') AS k) s
$function$;

CREATE OR REPLACE FUNCTION public.cfi_round_stats(p_country text DEFAULT NULL, p_league text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH season AS (
  SELECT (date_trunc('year', current_date - interval '6 months') + interval '6 months')::date AS start_date
),
numbered AS (
  SELECT f.fixture_id, f.match_date, f.round, f.country, f.competition_name,
         public.cfi_league_key(f.country, f.competition_name) AS league_key,
         lower(f.country) AS country_key,
         f.ht_home, f.ht_away, f.ft_home, f.ft_away, f.home_team_id, f.away_team_id
  FROM public.fixtures f, season s
  WHERE f.round IS NOT NULL AND f.country IS NOT NULL
    AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL
    AND f.match_date >= s.start_date
),
top_leagues(country_key, league_key, rk) AS (
  VALUES ('england','premierleague',1), ('spain','laliga',2), ('spain','laliga1',2), ('germany','bundesliga',3),
         ('italy','seriea',4), ('france','ligue1',5), ('netherlands','eredivisie',6),
         ('portugal','primeiraliga',7), ('portugal','ligaportugal',7),
         ('belgium','belgianproleague',8),
         ('turkiye','superlig',9), ('turkey','superlig',9),
         ('scotland','premiership',10)
),
leagues AS (
  SELECT b.country_key, b.league_key, min(b.country) AS country, min(b.competition_name) AS league,
         count(*) AS n_matches, count(DISTINCT b.round) AS n_rounds, max(b.round) AS last_round,
         min(t.rk) AS top_rank
  FROM numbered b
  LEFT JOIN public.cfi_country_region cr ON cr.country = b.country
  LEFT JOIN top_leagues t ON t.country_key = b.country_key AND t.league_key = b.league_key
  WHERE COALESCE(cr.region, '') <> 'international'
  GROUP BY b.country_key, b.league_key
  HAVING count(*) >= 10
),
sel_numbered AS (
  SELECT * FROM numbered
  WHERE p_country IS NOT NULL AND p_league IS NOT NULL
    AND country_key = lower(p_country)
    AND league_key = public.cfi_league_key(p_country, p_league)
),
sel_unnumbered AS (
  SELECT f.fixture_id, f.match_date, f.country, f.competition_name,
         f.ht_home, f.ht_away, f.ft_home, f.ft_away, f.home_team_id, f.away_team_id
  FROM public.fixtures f, season s
  WHERE p_country IS NOT NULL AND p_league IS NOT NULL
    AND f.round IS NULL AND f.round_label IS NOT NULL
    AND f.country IS NOT NULL AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL
    AND f.match_date >= s.start_date
    AND lower(f.country) = lower(p_country)
    AND public.cfi_league_key(f.country, f.competition_name) = public.cfi_league_key(p_country, p_league)
),
inferred AS (
  SELECT u.fixture_id,
         CASE WHEN count(DISTINCT n.round) = 1 THEN min(n.round) END AS round
  FROM sel_unnumbered u
  JOIN sel_numbered n ON abs(n.match_date - u.match_date) <= 2
  GROUP BY u.fixture_id
),
sel AS (
  SELECT n.round, n.match_date, n.fixture_id, n.ht_home, n.ht_away, n.ft_home, n.ft_away, n.home_team_id, n.away_team_id
  FROM sel_numbered n
  UNION ALL
  SELECT i.round, u.match_date, u.fixture_id, u.ht_home, u.ht_away, u.ft_home, u.ft_away, u.home_team_id, u.away_team_id
  FROM inferred i JOIN sel_unnumbered u ON u.fixture_id = i.fixture_id
  WHERE i.round IS NOT NULL
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
      'country', country, 'league', league, 'n_matches', n_matches, 'n_rounds', n_rounds, 'last_round', last_round,
      'top', top_rank IS NOT NULL)
      ORDER BY top_rank NULLS LAST, n_rounds DESC, n_matches DESC, country, league)
      FROM (SELECT * FROM leagues ORDER BY top_rank NULLS LAST, n_rounds DESC, n_matches DESC LIMIT 150) l), '[]'::jsonb),
  'rounds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'round', round, 'n', n, 'complete', n >= 0.9 * (SELECT max(n) FROM rounds),
      'o05_ht', o05_ht, 'o15_ht', o15_ht, 'o05_ft', o05_ft, 'o15_ft', o15_ft, 'o25_ft', o25_ft, 'o35_ft', o35_ft,
      'btts_ht', btts_ht, 'btts_ft', btts_ft, 'matches', matches) ORDER BY round DESC) FROM rounds), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_round_stats(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_round_stats(text, text) TO service_role;

COMMIT;
