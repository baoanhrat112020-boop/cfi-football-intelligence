CREATE OR REPLACE FUNCTION public.ou_result(goals integer, line numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN goals IS NULL OR line IS NULL THEN NULL
    ELSE (
      SELECT CASE (sign(goals - b.lo) + sign(goals - b.hi))
        WHEN 2 THEN 'WIN'
        WHEN 1 THEN 'HALF_WIN'
        WHEN 0 THEN 'PUSH'
        WHEN -1 THEN 'HALF_LOSS'
        ELSE 'LOSS'
      END
      FROM (
        SELECT CASE WHEN (line * 4)::int % 2 = 1 THEN line - 0.25 ELSE line END AS lo,
               CASE WHEN (line * 4)::int % 2 = 1 THEN line + 0.25 ELSE line END AS hi
      ) b
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.s_score(label text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE label
    WHEN 'WIN' THEN 1::numeric
    WHEN 'HALF_WIN' THEN 0.75
    WHEN 'PUSH' THEN 0.5
    WHEN 'HALF_LOSS' THEN 0.25
    WHEN 'LOSS' THEN 0::numeric
    ELSE NULL
  END
$function$;

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
  best_m text;
  best_p double precision := 0;
BEGIN
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
