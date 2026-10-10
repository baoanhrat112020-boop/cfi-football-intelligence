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

CREATE OR REPLACE FUNCTION public.cfi_suggest_upcoming(p_minutes integer DEFAULT 240)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_cutoff timestamptz := now() + (p_minutes::text || ' minutes')::interval;
  v_lookback timestamptz := now() - interval '150 minutes';
  v_result jsonb;
BEGIN
  IF p_minutes NOT IN (30, 90, 180, 240, 270, 360, 600, 1440, 2880) THEN
    RAISE EXCEPTION 'Invalid window: %', p_minutes;
  END IF;

  WITH fixtures AS (
    SELECT DISTINCT ON (COALESCE(v.canonical_home_team_id::text, v.home_team), COALESCE(v.canonical_away_team_id::text, v.away_team), v.kickoff_at) v.fixture_id, v.source_provenance->>'providerId' AS provider_id, v.source_provenance->>'stage' AS stage, v.source_provenance->>'league' AS league, v.kickoff_at, v.home_team AS home, v.away_team AS away,
           v.canonical_home_team_id::text AS h_id, v.canonical_away_team_id::text AS a_id,
           (v.canonical_home_team_id IS NULL OR v.canonical_away_team_id IS NULL) AS no_stats,
           COALESCE(hs.attack_home, 1.53)::float AS attack_home,
           COALESCE(hs.defense_home, 1.22)::float AS defense_home,
           COALESCE(aws.attack_away, 1.22)::float AS attack_away,
           COALESCE(aws.defense_away, 1.53)::float AS defense_away
    FROM cfi_living_verified_fixtures v
    LEFT JOIN team_stats hs ON hs.team_id = v.canonical_home_team_id::text
    LEFT JOIN team_stats aws ON aws.team_id = v.canonical_away_team_id::text
    WHERE v.kickoff_at > v_lookback AND v.kickoff_at <= v_cutoff
    ORDER BY COALESCE(v.canonical_home_team_id::text, v.home_team), COALESCE(v.canonical_away_team_id::text, v.away_team), v.kickoff_at, (v.source_name = 'LIVESCORE') DESC, v.fixture_id
  ),
  lambdas AS (
    SELECT f.*,
      ((f.attack_home + f.defense_away) / 2.0)::float AS lh,
      ((f.attack_away + f.defense_home) / 2.0)::float AS la
    FROM fixtures f
  ),
  probs AS (
    SELECT l.*, l.lh + l.la AS lft, (l.lh + l.la) * 0.50 AS lht FROM lambdas l
  ),
  scored AS (
    SELECT p.*,
      (1.0 - poisson_cdf(p.lht, 2))::float AS p_3ht,
      (1.0 - (poisson_cdf(p.lh * 0.50, 3) * poisson_cdf(p.la * 0.50, 3)))::float AS p_oht,
      (1.0 - (poisson_cdf(p.lh, 4) * poisson_cdf(p.la, 4)))::float AS p_oft,
      (1.0 - poisson_cdf(p.lft, 6))::float AS p_7ft,
      (1.0 - poisson_cdf(p.lft * 0.50, 1))::float AS p_over1_ht,
      (1.0 - exp(-p.lft * 0.50))::float AS p_over05_ht,
      ((1.0 - poisson_cdf(p.lft * 0.50, 1)) + 0.5 * exp(-p.lft * 0.50) * p.lft * 0.50)::float AS p_over075_ht
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
  odds_agg AS (
    SELECT mo.verified_fixture_id AS fid,
      jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'family', mo.market_family, 'period', mo.period, 'line', mo.line,
        'odds_over', mo.odds_over, 'odds_under', mo.odds_under,
        'odds_home', mo.odds_home, 'odds_draw', mo.odds_draw, 'odds_away', mo.odds_away,
        'p_implied', mo.p_implied_over, 'handicap_side', mo.handicap_side
      )) ORDER BY mo.market_family, mo.period, mo.line) AS market_odds
    FROM match_odds mo
    WHERE mo.verified_fixture_id IN (SELECT fixture_id FROM picked)
    GROUP BY mo.verified_fixture_id
  ),
  final AS (
    SELECT p.*, oa.market_odds
    FROM picked p
    LEFT JOIN odds_agg oa ON oa.fid = p.fixture_id
  ),
  preds AS MATERIALIZED (
    SELECT f.*, cfi_score_pred(f.lh, f.la) AS sp
    FROM final f
  ),
  sel AS (
    SELECT p.*,
      ht.market AS ht_market, ht.line AS ht_line, ht.s AS ht_s,
      ft.market AS ft_market, ft.line AS ft_line, ft.s AS ft_s
    FROM preds p
    LEFT JOIN LATERAL (
      SELECT c.market, c.line, c.s
      FROM (VALUES
        ('over_05_ht', 0.5, (p.sp->>'s_over05_ht')::numeric),
        ('over_075_ht', 0.75, (p.sp->>'s_over075_ht')::numeric),
        ('over_1_ht', 1.0, (p.sp->>'s_over1_ht')::numeric),
        ('over_125_ht', 1.25, (p.sp->>'s_over125_ht')::numeric),
        ('over_15_ht', 1.5, (p.sp->>'s_over15_ht')::numeric)
      ) AS c(market, line, s)
      WHERE c.s BETWEEN 0.55 AND 0.70
      ORDER BY c.line DESC
      LIMIT 1
    ) ht ON true
    LEFT JOIN LATERAL (
      SELECT c.market, c.line, c.s
      FROM (VALUES
        ('over_15_ft', 1.5, (p.sp->>'s_over_15_ft')::numeric),
        ('over_2_ft', 2.0, (p.sp->>'s_over_2_ft')::numeric),
        ('over_225_ft', 2.25, (p.sp->>'s_over_225_ft')::numeric),
        ('over_25_ft', 2.5, (p.sp->>'s_over_25_ft')::numeric),
        ('over_275_ft', 2.75, (p.sp->>'s_over_275_ft')::numeric),
        ('over_3_ft', 3.0, (p.sp->>'s_over_3_ft')::numeric),
        ('over_325_ft', 3.25, (p.sp->>'s_over_325_ft')::numeric),
        ('over_35_ft', 3.5, (p.sp->>'s_over_35_ft')::numeric)
      ) AS c(market, line, s)
      WHERE c.s BETWEEN 0.55 AND 0.70
      ORDER BY c.line DESC
      LIMIT 1
    ) ft ON true
  ),
  tops AS (
    SELECT s.*, t.market AS top_m, t.p AS top_p
    FROM sel s
    LEFT JOIN LATERAL (
      SELECT c.market, c.p
      FROM (VALUES
        ('btts_yes', (s.sp->'markets'->>'m_btts_yes')::numeric),
        ('1x2_ht_home', (s.sp->'markets'->>'m_1x2_ht_home')::numeric),
        ('1x2_ft_home', (s.sp->'markets'->>'m_1x2_ft_home')::numeric),
        (s.ht_market, s.ht_s),
        (s.ft_market, s.ft_s)
      ) AS c(market, p)
      WHERE c.market IS NOT NULL AND c.p >= 0.5
      ORDER BY c.p DESC, c.market
      LIMIT 1
    ) t ON true
  ),
  slot_agg AS (
    SELECT
      to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS d,
      to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:00') AS h,
      jsonb_agg((jsonb_build_object(
        'fixture_id', f.fixture_id, 'provider_id', f.provider_id,
        'kickoff', to_char(f.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS+07:00'),
        'home', f.home, 'away', f.away, 'competition', CASE WHEN f.stage IS NOT NULL AND f.league IS NOT NULL AND f.league <> f.stage THEN f.stage || ' · ' || f.league WHEN f.stage IS NOT NULL THEN f.stage ELSE NULL END,
        'no_stats', f.no_stats,
        'probs', jsonb_build_object(
          '3+ HT', ROUND(f.p_3ht::numeric, 4),
          'Other FT', ROUND(f.p_oft::numeric, 4),
          'Other HT', ROUND(f.p_oht::numeric, 4),
          '7+ FT', ROUND(f.p_7ft::numeric, 4)
        ),
        'hit_markets', to_jsonb(f.hit_markets),
        'flags', (f.home_flags || f.away_flags)
      ) || (f.sp - 'top_market' - 'top_market_prob')
        || jsonb_build_object('lambda_home_ft', ROUND(f.lh::numeric, 4), 'lambda_away_ft', ROUND(f.la::numeric, 4))
        || jsonb_build_object(
          'top_market', f.top_m,
          'top_market_prob', CASE WHEN f.top_m IS NULL THEN NULL ELSE ROUND(f.top_p, 4) END,
          'selected_ht_market', f.ht_market, 'selected_ht_line', f.ht_line, 'selected_ht_p', f.ht_s,
          'selected_ft_market', f.ft_market, 'selected_ft_line', f.ft_line, 'selected_ft_p', f.ft_s
        )
        || CASE WHEN f.market_odds IS NOT NULL THEN jsonb_build_object('market_odds', f.market_odds) ELSE '{}'::jsonb END) ORDER BY f.p_over075_ht DESC) AS matches
    FROM tops f GROUP BY 1, 2
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

CREATE OR REPLACE FUNCTION public.cfi_settle_suggest_picks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settled integer := 0;
  v_no_ht integer := 0;
  v_void integer := 0;
BEGIN
  WITH cand AS (
    SELECT l.fixture_id, l.top_market, f.ht_home AS fht_h, f.ht_away AS fht_a, f.ft_home AS fft_h, f.ft_away AS fft_a
    FROM public.suggest_pick_log l
    JOIN LATERAL (
      SELECT fx.ht_home, fx.ht_away, fx.ft_home, fx.ft_away
      FROM public.fixtures fx
      WHERE fx.home_team_id = l.home_team_id
        AND fx.away_team_id = l.away_team_id
        AND fx.match_date BETWEEN l.target_date - 1 AND l.target_date + 1
        AND fx.status IN ('CANONICAL', 'COMPLETE')
        AND fx.ft_home IS NOT NULL AND fx.ft_away IS NOT NULL
      ORDER BY abs(fx.match_date - l.target_date)
      LIMIT 1
    ) f ON true
    WHERE l.settled_at IS NULL
      AND l.kickoff_at < now() - interval '3 hours'
      AND l.home_team_id IS NOT NULL AND l.away_team_id IS NOT NULL
  ),
  calc AS (
    SELECT c.*,
           (c.fht_h IS NOT NULL AND c.fht_a IS NOT NULL AND c.fft_h >= c.fht_h AND c.fft_a >= c.fht_a) AS ht_ok,
           m.period AS ou_period,
           m.line AS ou_line
    FROM cand c
    LEFT JOIN LATERAL (
      SELECT CASE WHEN c.top_market = 'over_2_5_ft' THEN 'ft' ELSE x.r[3] END AS period,
             CASE WHEN c.top_market = 'over_2_5_ft' THEN 2.5
                  WHEN x.r[2] = '' THEN x.r[1]::numeric
                  ELSE (x.r[1] || '.' || x.r[2])::numeric END AS line
      FROM (SELECT regexp_match(c.top_market, '^over_(\d)(\d*)_(ht|ft)$') AS r) x
      WHERE c.top_market = 'over_2_5_ft' OR x.r IS NOT NULL
    ) m ON true
  ),
  upd AS (
    UPDATE public.suggest_pick_log l SET
      settled_at = now(),
      void_reason = CASE WHEN c.ht_ok THEN NULL ELSE 'NO_HT' END,
      ht_home = CASE WHEN c.ht_ok THEN c.fht_h END,
      ht_away = CASE WHEN c.ht_ok THEN c.fht_a END,
      ft_home = c.fft_h,
      ft_away = c.fft_a,
      hit_o05_ht = CASE WHEN c.ht_ok THEN (c.fht_h + c.fht_a) >= 1 END,
      hit_o1_ht = CASE WHEN c.ht_ok THEN (c.fht_h + c.fht_a) >= 2 END,
      result_o075 = CASE WHEN NOT c.ht_ok THEN NULL
                         WHEN c.fht_h + c.fht_a >= 2 THEN 'WIN'
                         WHEN c.fht_h + c.fht_a = 1 THEN 'HALF_WIN'
                         ELSE 'LOSS' END,
      hit_top_market = CASE
        WHEN l.top_market = 'btts_yes' THEN c.fft_h >= 1 AND c.fft_a >= 1
        WHEN l.top_market = '1x2_ht_home' THEN CASE WHEN c.ht_ok THEN c.fht_h > c.fht_a END
        WHEN l.top_market = '1x2_ft_home' THEN c.fft_h > c.fft_a
        WHEN c.ou_period = 'ht' THEN CASE WHEN c.ht_ok THEN
          CASE public.ou_result(c.fht_h + c.fht_a, c.ou_line)
            WHEN 'WIN' THEN true WHEN 'HALF_WIN' THEN true
            WHEN 'LOSS' THEN false WHEN 'HALF_LOSS' THEN false
            ELSE NULL END
          END
        WHEN c.ou_period = 'ft' THEN
          CASE public.ou_result(c.fft_h + c.fft_a, c.ou_line)
            WHEN 'WIN' THEN true WHEN 'HALF_WIN' THEN true
            WHEN 'LOSS' THEN false WHEN 'HALF_LOSS' THEN false
            ELSE NULL END
        ELSE NULL END
    FROM calc c
    WHERE l.fixture_id = c.fixture_id
    RETURNING c.ht_ok
  )
  SELECT count(*), count(*) FILTER (WHERE NOT ht_ok) INTO v_settled, v_no_ht FROM upd;

  WITH v AS (
    UPDATE public.suggest_pick_log
    SET settled_at = now(), void_reason = 'NO_RESULT'
    WHERE settled_at IS NULL AND kickoff_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_void FROM v;

  RETURN jsonb_build_object('status', 'OK', 'settled', v_settled, 'settled_without_ht', v_no_ht, 'voided_no_result', v_void);
END;
$function$;
