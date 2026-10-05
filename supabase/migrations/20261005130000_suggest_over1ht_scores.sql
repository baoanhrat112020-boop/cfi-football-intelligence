CREATE OR REPLACE FUNCTION public.cfi_pois_1x2(l1 double precision, l2 double precision)
 RETURNS double precision[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH a AS (SELECT n, exp(-l1) * power(l1, n) / factorial(n)::float AS p FROM generate_series(0, 12) n),
       b AS (SELECT n, exp(-l2) * power(l2, n) / factorial(n)::float AS p FROM generate_series(0, 12) n),
       j AS (SELECT a.n AS x, b.n AS y, a.p * b.p AS p FROM a CROSS JOIN b),
       t AS (SELECT SUM(p) AS s FROM j)
  SELECT ARRAY[
    (SELECT SUM(p) FROM j WHERE x > y) / (SELECT s FROM t),
    (SELECT SUM(p) FROM j WHERE x = y) / (SELECT s FROM t),
    (SELECT SUM(p) FROM j WHERE x < y) / (SELECT s FROM t)
  ]::double precision[];
$function$;

CREATE OR REPLACE FUNCTION public.cfi_score_pred(lh double precision, la double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  lhh double precision := lh * 0.45;
  lah double precision := la * 0.45;
  lft double precision := lh + la;
  lht double precision := (lh + la) * 0.45;
  x_ht double precision[] := cfi_pois_1x2(lhh, lah);
  x_ft double precision[] := cfi_pois_1x2(lh, la);
  p_o1ht double precision := 1.0 - exp(-lht) * (1.0 + lht);
  p_o25 double precision := 1.0 - exp(-lft) * (1.0 + lft + lft * lft / 2.0);
  p_o15 double precision := 1.0 - exp(-lft) * (1.0 + lft);
  p_btts double precision := (1.0 - exp(-lh)) * (1.0 - exp(-la));
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

CREATE OR REPLACE FUNCTION public.cfi_suggest_upcoming(p_minutes integer DEFAULT 240)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_cutoff timestamptz := now() + (p_minutes::text || ' minutes')::interval;
  v_lookback timestamptz := now() - interval '90 minutes';
  v_result jsonb;
BEGIN
  IF p_minutes NOT IN (30, 90, 180, 240, 270, 360, 600, 1440, 2880) THEN
    RAISE EXCEPTION 'Invalid window: %', p_minutes;
  END IF;

  WITH fixtures AS (
    SELECT v.fixture_id, v.kickoff_at, v.home_team AS home, v.away_team AS away,
           v.canonical_home_team_id::text AS h_id, v.canonical_away_team_id::text AS a_id,
           COALESCE(hs.attack_home, 1.53)::float AS attack_home,
           COALESCE(hs.defense_home, 1.22)::float AS defense_home,
           COALESCE(aws.attack_away, 1.22)::float AS attack_away,
           COALESCE(aws.defense_away, 1.53)::float AS defense_away
    FROM cfi_living_verified_fixtures v
    LEFT JOIN team_stats hs ON hs.team_id = v.canonical_home_team_id::text
    LEFT JOIN team_stats aws ON aws.team_id = v.canonical_away_team_id::text
    WHERE v.kickoff_at > v_lookback AND v.kickoff_at <= v_cutoff
      AND v.canonical_home_team_id IS NOT NULL
      AND v.canonical_away_team_id IS NOT NULL
  ),
  lambdas AS (
    SELECT f.*,
      ((f.attack_home + f.defense_away) / 2.0)::float AS lh,
      ((f.attack_away + f.defense_home) / 2.0)::float AS la
    FROM fixtures f
  ),
  probs AS (
    SELECT l.*, l.lh + l.la AS lft, (l.lh + l.la) * 0.42 AS lht FROM lambdas l
  ),
  scored AS (
    SELECT p.*,
      (1.0 - poisson_cdf(p.lht, 2))::float AS p_3ht,
      (1.0 - (poisson_cdf(p.lh * 0.42, 3) * poisson_cdf(p.la * 0.42, 3)))::float AS p_oht,
      (1.0 - (poisson_cdf(p.lh, 4) * poisson_cdf(p.la, 4)))::float AS p_oft,
      (1.0 - poisson_cdf(p.lft, 6))::float AS p_7ft,
      (1.0 - poisson_cdf(p.lft * 0.45, 1))::float AS p_over1_ht
    FROM probs p
  ),
  flags_agg AS (
    SELECT tt.team_id::text AS team_id,
      jsonb_agg(jsonb_build_object('market', tt.market, 'flag', tt.flag, 'lift', ROUND(tt.lift::numeric, 2))) AS flags,
      BOOL_OR(tt.flag = 'HIGH' AND tt.market = '3+ HT') AS high_3ht,
      BOOL_OR(tt.flag = 'HIGH' AND tt.market = 'Other FT') AS high_oft,
      BOOL_OR(tt.flag = 'HIGH' AND tt.market = 'Other HT') AS high_oht,
      BOOL_OR(tt.flag = 'HIGH' AND tt.market = '7+ FT') AS high_7ft
    FROM team_tendency tt
    WHERE tt.flag IN ('HIGH', 'MEDIUM')
    GROUP BY tt.team_id
  ),
  enriched AS (
    SELECT s.*,
      COALESCE(fh.flags, '[]'::jsonb) AS home_flags,
      COALESCE(fa.flags, '[]'::jsonb) AS away_flags,
      (COALESCE(fh.high_3ht,false) OR COALESCE(fa.high_3ht,false)) AS h3,
      (COALESCE(fh.high_oft,false) OR COALESCE(fa.high_oft,false)) AS ho,
      (COALESCE(fh.high_oht,false) OR COALESCE(fa.high_oht,false)) AS hh,
      (COALESCE(fh.high_7ft,false) OR COALESCE(fa.high_7ft,false)) AS h7
    FROM scored s
    LEFT JOIN flags_agg fh ON fh.team_id = s.h_id
    LEFT JOIN flags_agg fa ON fa.team_id = s.a_id
  ),
  filtered AS (
    SELECT e.*,
      (0.15 - CASE WHEN e.h3 THEN 0.03 ELSE 0 END) AS th_3ht,
      (0.10 - CASE WHEN e.ho THEN 0.03 ELSE 0 END) AS th_oft,
      (0.03 - CASE WHEN e.hh THEN 0.03 ELSE 0 END) AS th_oht,
      (0.05 - CASE WHEN e.h7 THEN 0.03 ELSE 0 END) AS th_7ft
    FROM enriched e
  ),
  picked AS (
    SELECT f.*,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN f.p_3ht >= f.th_3ht THEN '3+ HT' END,
        CASE WHEN f.p_oft >= f.th_oft THEN 'Other FT' END,
        CASE WHEN f.p_oht >= f.th_oht THEN 'Other HT' END,
        CASE WHEN f.p_7ft >= f.th_7ft THEN '7+ FT' END
      ], NULL) AS hit_markets
    FROM filtered f
  ),
  final AS (SELECT * FROM picked WHERE p_over1_ht >= 0.55),
  slot_agg AS (
    SELECT
      to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS d,
      to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:00') AS h,
      jsonb_agg((jsonb_build_object(
        'fixture_id', f.fixture_id,
        'kickoff', to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS+07:00'),
        'home', f.home, 'away', f.away,
        'probs', jsonb_build_object(
          '3+ HT', ROUND(f.p_3ht::numeric, 4),
          'Other FT', ROUND(f.p_oft::numeric, 4),
          'Other HT', ROUND(f.p_oht::numeric, 4),
          '7+ FT', ROUND(f.p_7ft::numeric, 4)
        ),
        'hit_markets', to_jsonb(f.hit_markets),
        'flags', (f.home_flags || f.away_flags)
      ) || cfi_score_pred(f.lh, f.la)) ORDER BY f.p_over1_ht DESC) AS matches
    FROM final f GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'minutes', p_minutes,
    'generated_at', to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS+07:00'),
    'slot_count', (SELECT COUNT(*) FROM slot_agg),
    'match_count', (SELECT COUNT(*) FROM final),
    'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'hour', h, 'matches', matches) ORDER BY d, h) FROM slot_agg), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
