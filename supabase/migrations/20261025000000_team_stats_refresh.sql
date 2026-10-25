CREATE OR REPLACE FUNCTION public.cfi_refresh_team_stats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n integer;
  has_upd boolean;
  sets text := 'attack_home = EXCLUDED.attack_home, attack_away = EXCLUDED.attack_away, defense_home = EXCLUDED.defense_home, defense_away = EXCLUDED.defense_away, n_matches = EXCLUDED.n_matches';
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'team_stats' AND column_name = 'updated_at') INTO has_upd;
  IF has_upd THEN sets := sets || ', updated_at = now()'; END IF;
  EXECUTE format($q$
    WITH f AS (
      SELECT home_team_id::text AS h, away_team_id::text AS a, ft_home, ft_away, match_date, fixture_id
      FROM public.fixtures
      WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    ),
    lg AS (SELECT avg(ft_home)::float8 AS avg_h, avg(ft_away)::float8 AS avg_a FROM f),
    hm AS (
      SELECT h AS t, ft_home AS gf, ft_away AS ga,
             row_number() OVER (PARTITION BY h ORDER BY match_date DESC NULLS FIRST, fixture_id DESC) AS rn
      FROM f
    ),
    aw AS (
      SELECT a AS t, ft_away AS gf, ft_home AS ga,
             row_number() OVER (PARTITION BY a ORDER BY match_date DESC NULLS FIRST, fixture_id DESC) AS rn
      FROM f
    ),
    hw AS (
      SELECT t, sum(gf * power(0.94, rn - 1))::float8 / sum(power(0.94, rn - 1)) AS att, sum(ga * power(0.94, rn - 1))::float8 / sum(power(0.94, rn - 1)) AS def
      FROM hm WHERE rn <= 30 GROUP BY t
    ),
    aww AS (
      SELECT t, sum(gf * power(0.94, rn - 1))::float8 / sum(power(0.94, rn - 1)) AS att, sum(ga * power(0.94, rn - 1))::float8 / sum(power(0.94, rn - 1)) AS def
      FROM aw WHERE rn <= 30 GROUP BY t
    ),
    cnt AS (
      SELECT t, count(*)::int AS n FROM (SELECT h AS t FROM f UNION ALL SELECT a FROM f) x GROUP BY t
    ),
    res AS (
      SELECT c.t AS team_id, c.n AS n_matches,
             round((LEAST(1.0, c.n / 10.0) * coalesce(hw.att, lg.avg_h) + (1 - LEAST(1.0, c.n / 10.0)) * lg.avg_h)::numeric, 4) AS attack_home,
             round((LEAST(1.0, c.n / 10.0) * coalesce(hw.def, lg.avg_a) + (1 - LEAST(1.0, c.n / 10.0)) * lg.avg_a)::numeric, 4) AS defense_home,
             round((LEAST(1.0, c.n / 10.0) * coalesce(aww.att, lg.avg_a) + (1 - LEAST(1.0, c.n / 10.0)) * lg.avg_a)::numeric, 4) AS attack_away,
             round((LEAST(1.0, c.n / 10.0) * coalesce(aww.def, lg.avg_h) + (1 - LEAST(1.0, c.n / 10.0)) * lg.avg_h)::numeric, 4) AS defense_away
      FROM cnt c CROSS JOIN lg LEFT JOIN hw ON hw.t = c.t LEFT JOIN aww ON aww.t = c.t
    )
    INSERT INTO public.team_stats (team_id, attack_home, attack_away, defense_home, defense_away, n_matches)
    SELECT team_id, attack_home, attack_away, defense_home, defense_away, n_matches FROM res
    ON CONFLICT (team_id) DO UPDATE SET %s
  $q$, sets);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.cfi_refresh_team_stats() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'cfi-team-stats-refresh',
  '20 2 * * *',
  $$SELECT public.cfi_refresh_team_stats()$$
);
