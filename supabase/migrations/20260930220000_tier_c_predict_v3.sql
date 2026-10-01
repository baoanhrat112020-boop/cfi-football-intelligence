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
  top3 JSONB;
  cs_opts JSONB;
  markets JSONB;
BEGIN
  SELECT rating, matches INTO rh, rh_matches FROM teams_elo WHERE team_id = home_id;
  SELECT rating, matches INTO ra, ra_matches FROM teams_elo WHERE team_id = away_id;
  rh := COALESCE(rh, 1500); ra := COALESCE(ra, 1500);
  rh_matches := COALESCE(rh_matches, 0); ra_matches := COALESCE(ra_matches, 0);

  elo_diff := rh - ra;

  total_xg := (CASE WHEN neutral THEN 2.45 ELSE 2.55 END)
              + 0.40 * LEAST(abs(rh - ra), 500) / 500.0;

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
    COALESCE(SUM(CASE WHEN gi >= 1 AND gj >= 1 THEN p ELSE 0 END), 0)::REAL,
    (SELECT jsonb_agg(jsonb_build_object('score', t.gi || '-' || t.gj, 'probability', ROUND(t.p, 4)) ORDER BY t.p DESC)
     FROM (SELECT gi, gj, p FROM norm ORDER BY p DESC LIMIT 3) t)
  INTO p_home, p_draw, p_away, p_over25, p_btts, top3
  FROM norm;

  top3 := COALESCE(top3, '[]'::jsonb);
  SELECT COALESCE(jsonb_agg(e.value || '{"decision":"WATCH","confidence":"LOW"}'::jsonb ORDER BY e.ord), '[]'::jsonb)
  INTO cs_opts
  FROM jsonb_array_elements(top3) WITH ORDINALITY AS e(value, ord);

  markets := jsonb_build_array(
    jsonb_build_object('market', '1X2_PICK',
      'value', CASE WHEN p_home >= p_draw AND p_home >= p_away THEN 'HOME' WHEN p_away >= p_draw THEN 'AWAY' ELSE 'DRAW' END,
      'probability', ROUND(GREATEST(p_home, p_draw, p_away)::numeric, 4),
      'decision', 'WATCH', 'confidence', 'LOW'),
    jsonb_build_object('market', 'DOUBLE_CHANCE', 'options', jsonb_build_array(
      jsonb_build_object('value', '1X', 'probability', ROUND((p_home + p_draw)::numeric, 4), 'decision', 'WATCH', 'confidence', 'LOW'),
      jsonb_build_object('value', 'X2', 'probability', ROUND((p_draw + p_away)::numeric, 4), 'decision', 'WATCH', 'confidence', 'LOW'),
      jsonb_build_object('value', '12', 'probability', ROUND((p_home + p_away)::numeric, 4), 'decision', 'WATCH', 'confidence', 'LOW'))),
    jsonb_build_object('market', 'OU_PICK',
      'value', CASE WHEN p_over25 >= 1.0 - p_over25 THEN 'OVER' ELSE 'UNDER' END,
      'probability', ROUND(GREATEST(p_over25, 1.0 - p_over25)::numeric, 4),
      'decision', 'WATCH', 'confidence', 'LOW'),
    jsonb_build_object('market', 'BTTS',
      'value', CASE WHEN p_btts >= 1.0 - p_btts THEN 'YES' ELSE 'NO' END,
      'probability', ROUND(GREATEST(p_btts, 1.0 - p_btts)::numeric, 4),
      'decision', 'WATCH', 'confidence', 'LOW'),
    jsonb_build_object('market', 'CS_TOP3_FT', 'options', cs_opts),
    jsonb_build_object('market', 'AH_MINUS_0_5',
      'value', CASE WHEN p_home >= p_draw + p_away THEN 'HOME' ELSE 'AWAY' END,
      'probability', ROUND(GREATEST(p_home, p_draw + p_away)::numeric, 4),
      'decision', 'WATCH', 'confidence', 'LOW')
  );

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
    'markets6', markets,
    'topScorelines', top3,
    'tier', 'C',
    'model', 'elo_prior_v3.1',
    'confidence', 'LOW',
    'elo_home', rh, 'elo_away', ra,
    'low_sample', (rh_matches < 30 OR ra_matches < 30)
  );
END;
$function$;
