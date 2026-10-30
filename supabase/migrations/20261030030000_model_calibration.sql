CREATE OR REPLACE FUNCTION public.cfi_score_pred(lh double precision, la double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  lhh double precision := lh * 0.50;
  lah double precision := la * 0.50;
  lft double precision := lh + la;
  lht double precision := (lh + la) * 0.50;
  x_ht double precision[] := cfi_pois_1x2(lhh, lah);
  x_ft double precision[] := cfi_pois_1x2(lh, la);
  q1 double precision := lht * exp(-lht);
  q_ge1 double precision := 1.0 - exp(-lht);
  q_ge2 double precision := 1.0 - exp(-lht) - lht * exp(-lht);
  p_o05ht double precision := 1.0 - exp(-lht);
  p_o1ht double precision := 1.0 - exp(-lht) * (1.0 + lht);
  p_o075ht double precision := (1.0 - exp(-lht) * (1.0 + lht)) + 0.5 * exp(-lht) * lht;
  p_o25 double precision := 1.0 - exp(-lft) * (1.0 + lft + lft * lft / 2.0);
  p_o15 double precision := 1.0 - exp(-lft) * (1.0 + lft);
  p_btts double precision := (1.0 - exp(-lh)) * (1.0 - exp(-la));
  f2 double precision := lft * lft / 2.0 * exp(-lft);
  f3 double precision := lft * lft * lft / 6.0 * exp(-lft);
  q_ge4 double precision := p_o25 - f3;
  p_home_cal double precision;
  best_m text;
  best_p double precision := 0;
BEGIN
  p_btts := 1.0 / (1.0 + exp(-(0.6895 * ln(GREATEST(LEAST(p_btts, 0.999), 0.001) / (1.0 - GREATEST(LEAST(p_btts, 0.999), 0.001))) - 0.006)));
  p_home_cal := 1.0 / (1.0 + exp(-(1.3145 * ln(GREATEST(LEAST(x_ft[1], 0.999), 0.001) / (1.0 - GREATEST(LEAST(x_ft[1], 0.999), 0.001))) + 0.0981)));
  x_ft := ARRAY[p_home_cal, x_ft[2] * (1.0 - p_home_cal) / GREATEST(1.0 - x_ft[1], 0.001), x_ft[3] * (1.0 - p_home_cal) / GREATEST(1.0 - x_ft[1], 0.001)];
  IF p_o1ht > best_p THEN best_m := 'over_1_ht'; best_p := p_o1ht; END IF;
  IF x_ht[1] > best_p THEN best_m := '1x2_ht_home'; best_p := x_ht[1]; END IF;
  IF x_ft[1] > best_p THEN best_m := '1x2_ft_home'; best_p := x_ft[1]; END IF;
  IF p_o25 > best_p THEN best_m := 'over_2_5_ft'; best_p := p_o25; END IF;
  IF p_btts > best_p THEN best_m := 'btts_yes'; best_p := p_btts; END IF;
  IF best_p < 0.5 THEN best_m := NULL; END IF;
  RETURN jsonb_build_object(
    'pred_home_ht', floor(lhh)::int,
    'pred_away_ht', floor(lah)::int,
    'pred_home_ft', floor(lh)::int,
    'pred_away_ft', floor(la)::int,
    'p_over1_ht', ROUND(p_o1ht::numeric, 4),
    'p_over05_ht', ROUND(p_o05ht::numeric, 4),
    'p_over075_ht', ROUND(p_o075ht::numeric, 4),
    's_over05_ht', ROUND(q_ge1::numeric, 4),
    's_over075_ht', ROUND((q_ge2 + 0.75 * q1)::numeric, 4),
    's_over1_ht', ROUND((q_ge2 + 0.50 * q1)::numeric, 4),
    's_over125_ht', ROUND((q_ge2 + 0.25 * q1)::numeric, 4),
    's_over15_ht', ROUND(q_ge2::numeric, 4),
    's_over_15_ft', ROUND(p_o15::numeric, 4),
    's_over_2_ft', ROUND((p_o25 + 0.50 * f2)::numeric, 4),
    's_over_225_ft', ROUND((p_o25 + 0.25 * f2)::numeric, 4),
    's_over_25_ft', ROUND(p_o25::numeric, 4),
    's_over_275_ft', ROUND((q_ge4 + 0.75 * f3)::numeric, 4),
    's_over_3_ft', ROUND((q_ge4 + 0.50 * f3)::numeric, 4),
    's_over_325_ft', ROUND((q_ge4 + 0.25 * f3)::numeric, 4),
    's_over_35_ft', ROUND(q_ge4::numeric, 4),
    'markets', jsonb_build_object(
      'm_1x2_ht_home', ROUND(x_ht[1]::numeric, 4),
      'm_1x2_ht_draw', ROUND(x_ht[2]::numeric, 4),
      'm_1x2_ht_away', ROUND(x_ht[3]::numeric, 4),
      'm_1x2_ft_home', ROUND(x_ft[1]::numeric, 4),
      'm_1x2_ft_draw', ROUND(x_ft[2]::numeric, 4),
      'm_1x2_ft_away', ROUND(x_ft[3]::numeric, 4),
      'm_over_2_5_ft', ROUND(p_o25::numeric, 4),
      'm_over_1_5_ft', ROUND(p_o15::numeric, 4),
      'm_btts_yes', ROUND(p_btts::numeric, 4)
    ),
    'top_market', best_m,
    'top_market_prob', CASE WHEN best_m IS NULL THEN NULL ELSE ROUND(best_p::numeric, 4) END
  );
END;
$function$;

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
             round(((c.n / (c.n + 10.0)) * coalesce(hw.att, lg.avg_h) + (1 - (c.n / (c.n + 10.0))) * lg.avg_h)::numeric, 4) AS attack_home,
             round(((c.n / (c.n + 10.0)) * coalesce(hw.def, lg.avg_a) + (1 - (c.n / (c.n + 10.0))) * lg.avg_a)::numeric, 4) AS defense_home,
             round(((c.n / (c.n + 10.0)) * coalesce(aww.att, lg.avg_a) + (1 - (c.n / (c.n + 10.0))) * lg.avg_a)::numeric, 4) AS attack_away,
             round(((c.n / (c.n + 10.0)) * coalesce(aww.def, lg.avg_h) + (1 - (c.n / (c.n + 10.0))) * lg.avg_h)::numeric, 4) AS defense_away
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

SELECT public.cfi_refresh_team_stats();
