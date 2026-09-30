CREATE OR REPLACE FUNCTION public.tier_c_predict(home_id text, away_id text, neutral boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  rh REAL; ra REAL;
  rh_matches INT; ra_matches INT;
  diff REAL; p_raw REAL; p_home REAL; p_draw REAL; p_away REAL;
  xg_home REAL; xg_away REAL; xg_total REAL;
  p_over25 REAL; p_btts REAL;
BEGIN
  SELECT rating, matches INTO rh, rh_matches FROM teams_elo WHERE team_id = home_id;
  SELECT rating, matches INTO ra, ra_matches FROM teams_elo WHERE team_id = away_id;
  rh := COALESCE(rh, 1500); ra := COALESCE(ra, 1500);
  rh_matches := COALESCE(rh_matches, 0); ra_matches := COALESCE(ra_matches, 0);

  diff := rh - ra + (CASE WHEN neutral THEN 0 ELSE 100 END);
  p_raw := 1.0 / (1.0 + power(10, -diff / 400.0));
  p_draw := 0.26;
  p_home := p_raw * (1 - p_draw);
  p_away := (1 - p_raw) * (1 - p_draw);

  xg_home := GREATEST(0.3, LEAST(3.5, 1.4 + (rh - ra + 100) / 400.0 * 0.5));
  xg_away := GREATEST(0.3, LEAST(3.5, 1.2 - (rh - ra + 100) / 400.0 * 0.5));
  xg_total := xg_home + xg_away;

  p_over25 := 1.0 - exp(-xg_total) * (1.0 + xg_total + power(xg_total,2)/2.0);
  p_over25 := GREATEST(0.05, LEAST(0.95, p_over25));
  p_btts := (1.0 - exp(-xg_home)) * (1.0 - exp(-xg_away));
  p_btts := GREATEST(0.05, LEAST(0.95, p_btts));

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
    'model', 'elo_prior_v2',
    'confidence', 'LOW',
    'elo_home', rh, 'elo_away', ra,
    'low_sample', (rh_matches < 30 OR ra_matches < 30)
  );
END;
$function$;
