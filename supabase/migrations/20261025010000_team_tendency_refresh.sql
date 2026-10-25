CREATE OR REPLACE FUNCTION public.cfi_refresh_team_tendency()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  CREATE TEMP TABLE _tt ON COMMIT DROP AS
  WITH f AS (
    SELECT home_team_id::text AS h, away_team_id::text AS a, ht_home, ht_away, ft_home, ft_away, match_date
    FROM public.fixtures
    WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL
  ),
  w AS (SELECT min(match_date) AS ws, max(match_date) AS we FROM f),
  sides AS (
    SELECT h AS team_id, (ht_home >= 4) AS oht, (ft_home >= 5) AS oft,
           (ht_home IS NOT NULL AND ht_away IS NOT NULL AND ht_home + ht_away >= 3) AS t3,
           (ft_home + ft_away >= 7) AS s7
    FROM f WHERE h IS NOT NULL AND h <> ''
    UNION ALL
    SELECT a, (ht_away >= 4), (ft_away >= 5),
           (ht_home IS NOT NULL AND ht_away IS NOT NULL AND ht_home + ht_away >= 3),
           (ft_home + ft_away >= 7)
    FROM f WHERE a IS NOT NULL AND a <> ''
  ),
  agg AS (
    SELECT team_id, count(*)::int AS n,
           count(*) FILTER (WHERE oht) AS e_oht, count(*) FILTER (WHERE oft) AS e_oft,
           count(*) FILTER (WHERE t3) AS e_t3, count(*) FILTER (WHERE s7) AS e_s7
    FROM sides GROUP BY team_id
  ),
  ev AS (
    SELECT a.team_id, m.market, a.n, m.ev, m.base
    FROM agg a
    CROSS JOIN LATERAL (VALUES ('Other HT', a.e_oht, 0.0111::float8), ('Other FT', a.e_oft, 0.0423::float8),
                               ('3+ HT', a.e_t3, 0.1264::float8), ('7+ FT', a.e_s7, 0.0263::float8)) AS m(market, ev, base)
    WHERE m.ev > 0
  ),
  sc AS (
    SELECT team_id, market, n, ev, base, ev::float8 / n AS rate, (ev::float8 / n) / base AS lift FROM ev
  )
  SELECT sc.team_id, sc.market, sc.n AS n_matches, sc.ev AS n_events,
         round(sc.rate::numeric, 6)::float8 AS rate, sc.base AS base_rate, round(sc.lift::numeric, 4)::float8 AS lift,
         CASE WHEN sc.n >= 50 AND sc.lift >= 3.0 THEN 'HIGH'
              WHEN sc.n >= 30 AND sc.lift >= 1.75 THEN 'MEDIUM'
              WHEN sc.n >= 15 AND sc.lift >= 1.5 THEN 'LOW' END AS flag,
         w.ws AS window_start, w.we AS window_end
  FROM sc CROSS JOIN w;

  DELETE FROM public.team_tendency WHERE market IN ('Other HT', 'Other FT', '3+ HT', '7+ FT');
  INSERT INTO public.team_tendency (team_id, market, n_matches, n_events, rate, base_rate, lift, flag, window_start, window_end, updated_at)
  SELECT team_id, market, n_matches, n_events, rate, base_rate, lift, flag, window_start, window_end, now()
  FROM _tt WHERE flag IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.cfi_refresh_team_tendency() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'cfi-team-tendency-refresh',
  '30 2 * * *',
  $$SELECT public.cfi_refresh_team_tendency()$$
);
