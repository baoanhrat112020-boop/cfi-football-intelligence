CREATE OR REPLACE FUNCTION public.tier_c_predict(home_id text, away_id text, neutral boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  rh REAL; ra REAL;
  rh_matches INT; ra_matches INT;
  elo_diff REAL;
  total_xg REAL;
  share_home REAL;
  xg_home REAL; xg_away REAL;
  rho REAL := -0.1;
  max_goals INT := 8;
  p_home REAL;
  p_draw REAL;
  p_away REAL;
  p_over25 REAL;
  p_btts REAL;
BEGIN
  SELECT rating, matches INTO rh, rh_matches FROM teams_elo WHERE team_id = home_id;
  SELECT rating, matches INTO ra, ra_matches FROM teams_elo WHERE team_id = away_id;
  rh := COALESCE(rh, 1500); ra := COALESCE(ra, 1500);
  rh_matches := COALESCE(rh_matches, 0); ra_matches := COALESCE(ra_matches, 0);

  elo_diff := rh - ra;

  total_xg := CASE WHEN neutral THEN 2.45 ELSE 2.55 END;

  share_home := 0.5
    + (CASE WHEN neutral THEN 0.0 ELSE 0.05 END)
    + elo_diff / 2000.0;
  share_home := GREATEST(0.25, LEAST(0.75, share_home));

  xg_home := GREATEST(0.20, LEAST(4.50, total_xg * share_home));
  xg_away := GREATEST(0.20, LEAST(4.50, total_xg * (1.0 - share_home)));

  WITH poisson_i AS (
    SELECT i AS gi,
           (exp((-xg_home)::numeric) * power(xg_home::numeric, i) / factorial(i)::numeric) AS p_i
    FROM generate_series(0, max_goals) AS i
  ),
  poisson_j AS (
    SELECT j AS gj,
           (exp((-xg_away)::numeric) * power(xg_away::numeric, j) / factorial(j)::numeric) AS p_j
    FROM generate_series(0, max_goals) AS j
  ),
  base AS (
    SELECT gi, gj, (p_i * p_j)::numeric AS p
    FROM poisson_i CROSS JOIN poisson_j
  ),
  adjusted AS (
    SELECT gi, gj, (p * (
      CASE
        WHEN gi = 0 AND gj = 0 THEN 1.0 - rho * xg_home * xg_away
        WHEN gi = 0 AND gj = 1 THEN 1.0 + rho * xg_home
        WHEN gi = 1 AND gj = 0 THEN 1.0 + rho * xg_away
        WHEN gi = 1 AND gj = 1 THEN 1.0 - rho
        ELSE 1.0
      END
    )::numeric) AS p
    FROM base
  ),
  norm AS (
    SELECT gi, gj, (p / (SELECT SUM(p) FROM adjusted))::numeric AS p
    FROM adjusted
  )
  SELECT
    COALESCE(SUM(CASE WHEN gi > gj THEN p ELSE 0 END), 0)::REAL,
    COALESCE(SUM(CASE WHEN gi = gj THEN p ELSE 0 END), 0)::REAL,
    COALESCE(SUM(CASE WHEN gi < gj THEN p ELSE 0 END), 0)::REAL,
    COALESCE(SUM(CASE WHEN gi + gj >= 3 THEN p ELSE 0 END), 0)::REAL,
    COALESCE(SUM(CASE WHEN gi >= 1 AND gj >= 1 THEN p ELSE 0 END), 0)::REAL
  INTO p_home, p_draw, p_away, p_over25, p_btts
  FROM norm;

  RETURN jsonb_build_object(
    'p_home', ROUND(p_home::numeric, 4),
    'p_draw', ROUND(p_draw::numeric, 4),
    'p_away', ROUND(p_away::numeric, 4),
    'p_over25', ROUND(p_over25::numeric, 4),
    'p_under25', ROUND((1.0 - p_over25)::numeric, 4),
    'p_btts', ROUND(p_btts::numeric, 4),
    'p_no_btts', ROUND((1.0 - p_btts)::numeric, 4),
    'xg_home', ROUND(xg_home::numeric, 2),
    'xg_away', ROUND(xg_away::numeric, 2),
    'tier', 'C',
    'model', 'elo_prior_v3',
    'confidence', 'LOW',
    'elo_home', rh, 'elo_away', ra,
    'low_sample', (rh_matches < 30 OR ra_matches < 30)
  );
END;
$function$;
