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
      ) || cfi_score_pred(f.lh, f.la) || jsonb_build_object('lambda_home_ft', ROUND(f.lh::numeric, 4), 'lambda_away_ft', ROUND(f.la::numeric, 4))
        || CASE WHEN f.market_odds IS NOT NULL THEN jsonb_build_object('market_odds', f.market_odds) ELSE '{}'::jsonb END) ORDER BY f.p_over075_ht DESC) AS matches
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
    SELECT l.fixture_id, f.ht_home AS fht_h, f.ht_away AS fht_a, f.ft_home AS fft_h, f.ft_away AS fft_a
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
           (c.fht_h IS NOT NULL AND c.fht_a IS NOT NULL AND c.fft_h >= c.fht_h AND c.fft_a >= c.fht_a) AS ht_ok
    FROM cand c
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
      hit_top_market = CASE l.top_market
        WHEN 'over_1_ht' THEN CASE WHEN c.ht_ok THEN (c.fht_h + c.fht_a) >= 2 END
        WHEN '1x2_ht_home' THEN CASE WHEN c.ht_ok THEN c.fht_h > c.fht_a END
        WHEN '1x2_ft_home' THEN c.fft_h > c.fft_a
        WHEN 'over_2_5_ft' THEN (c.fft_h + c.fft_a) >= 3
        WHEN 'btts_yes' THEN c.fft_h >= 1 AND c.fft_a >= 1
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

CREATE OR REPLACE FUNCTION public.cfi_suggest_track_record(p_days integer DEFAULT NULL::integer, p_tier text DEFAULT NULL::text, p_before_kickoff timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_before_fixture uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT * FROM public.suggest_pick_log
  WHERE (p_days IS NULL OR kickoff_at >= now() - make_interval(days => p_days))
    AND (p_tier IS NULL OR confidence_tier = p_tier)
),
scored AS (
  SELECT * FROM base WHERE settled_at IS NOT NULL AND void_reason IS NULL
),
tiers(tier, ord) AS (
  VALUES ('CAO', 1), ('KHA', 2), ('TB', 3), ('THAP', 4), ('RAT_THAP', 5)
),
tier_stats AS (
  SELECT t.tier, t.ord,
         count(s.fixture_id) AS n,
         avg(s.p_over05_ht) AS o05_pred,
         avg(s.hit_o05_ht::int) AS o05_actual,
         avg(s.p_over075_ht) AS o075_pred,
         (count(*) FILTER (WHERE s.result_o075 = 'WIN') + 0.5 * count(*) FILTER (WHERE s.result_o075 = 'HALF_WIN'))::double precision
           / NULLIF(count(s.fixture_id), 0) AS o075_actual,
         avg(s.p_over1_ht) AS o1_pred,
         avg(s.hit_o1_ht::int) AS o1_actual,
         count(*) FILTER (WHERE s.result_o075 = 'WIN') AS win,
         count(*) FILTER (WHERE s.result_o075 = 'HALF_WIN') AS half,
         count(*) FILTER (WHERE s.result_o075 = 'LOSS') AS loss
  FROM tiers t
  LEFT JOIN scored s ON s.confidence_tier = t.tier
  GROUP BY t.tier, t.ord
),
tier_ci AS (
  SELECT ts.*,
         CASE WHEN ts.n > 0 THEN
           greatest(0, (ts.o075_actual + 3.841459 / (2 * ts.n)
             - 1.959964 * sqrt(ts.o075_actual * (1 - ts.o075_actual) / ts.n + 3.841459 / (4 * ts.n * ts.n)))
             / (1 + 3.841459 / ts.n)) END AS ci_low,
         CASE WHEN ts.n > 0 THEN
           least(1, (ts.o075_actual + 3.841459 / (2 * ts.n)
             + 1.959964 * sqrt(ts.o075_actual * (1 - ts.o075_actual) / ts.n + 3.841459 / (4 * ts.n * ts.n)))
             / (1 + 3.841459 / ts.n)) END AS ci_high
  FROM tier_stats ts
),
market_stats AS (
  SELECT b.top_market AS market,
         count(*) AS n,
         avg(b.top_market_prob) AS prob_avg,
         avg(b.hit_top_market::int) AS hit_rate
  FROM base b
  WHERE b.settled_at IS NOT NULL AND b.hit_top_market IS NOT NULL
  GROUP BY b.top_market
),
market_ci AS (
  SELECT ms.*,
         greatest(0, (ms.hit_rate + 3.841459 / (2 * ms.n)
           - 1.959964 * sqrt(ms.hit_rate * (1 - ms.hit_rate) / ms.n + 3.841459 / (4 * ms.n * ms.n)))
           / (1 + 3.841459 / ms.n)) AS ci_low,
         least(1, (ms.hit_rate + 3.841459 / (2 * ms.n)
           + 1.959964 * sqrt(ms.hit_rate * (1 - ms.hit_rate) / ms.n + 3.841459 / (4 * ms.n * ms.n)))
           / (1 + 3.841459 / ms.n)) AS ci_high
  FROM market_stats ms
),
recent AS (
  SELECT fixture_id, kickoff_at, home_team, away_team,
         CASE WHEN ht_home IS NOT NULL THEN ht_home || '-' || ht_away END AS ht_score,
         ft_home || '-' || ft_away AS ft_score,
         confidence_tier, top_market, hit_top_market, result_o075
  FROM base
  WHERE settled_at IS NOT NULL AND void_reason IS DISTINCT FROM 'NO_RESULT'
    AND (p_before_kickoff IS NULL
         OR kickoff_at < p_before_kickoff
         OR (p_before_fixture IS NOT NULL AND kickoff_at = p_before_kickoff AND fixture_id < p_before_fixture))
  ORDER BY kickoff_at DESC, fixture_id DESC
  LIMIT CASE WHEN p_before_kickoff IS NULL THEN 100 ELSE least(greatest(COALESCE(p_limit, 100), 1), 200) END
)
SELECT jsonb_build_object(
  'days', p_days,
  'tier', p_tier,
  'generated_at', now(),
  'counts', jsonb_build_object(
    'pending', (SELECT count(*) FROM base WHERE settled_at IS NULL),
    'scored', (SELECT count(*) FROM scored),
    'void_no_result', (SELECT count(*) FROM base WHERE void_reason = 'NO_RESULT'),
    'void_no_ht', (SELECT count(*) FROM base WHERE void_reason = 'NO_HT'),
    'logging_since', (SELECT min(first_logged_at) FROM public.suggest_pick_log)
  ),
  'calibration_by_tier', (
    SELECT jsonb_agg(jsonb_build_object(
      'tier', tier, 'n', n,
      'o05_pred', round(o05_pred::numeric, 4), 'o05_actual', round(o05_actual::numeric, 4),
      'o075_pred', round(o075_pred::numeric, 4), 'o075_actual', round(o075_actual::numeric, 4),
      'o1_pred', round(o1_pred::numeric, 4), 'o1_actual', round(o1_actual::numeric, 4),
      'win', win, 'half', half, 'loss', loss,
      'wilson_95_low', round(ci_low::numeric, 4), 'wilson_95_high', round(ci_high::numeric, 4)
    ) ORDER BY ord) FROM tier_ci
  ),
  'by_top_market', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'market', market, 'n', n,
      'prob_avg', round(prob_avg::numeric, 4), 'hit_rate', round(hit_rate::numeric, 4),
      'wilson_95_low', round(ci_low::numeric, 4), 'wilson_95_high', round(ci_high::numeric, 4)
    ) ORDER BY n DESC) FROM market_ci
  ), '[]'::jsonb),
  'recent_settled', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'fixture_id', fixture_id,
      'kickoff', kickoff_at, 'home', home_team, 'away', away_team,
      'ht_score', ht_score, 'ft_score', ft_score, 'tier', confidence_tier,
      'top_market', top_market, 'hit', hit_top_market, 'o075_result', result_o075
    ) ORDER BY kickoff_at DESC, fixture_id DESC) FROM recent
  ), '[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.cfi_log_suggest_picks(p_snapshot_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date := COALESCE(p_snapshot_date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_payload jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_candidates integer := 0;
BEGIN
  SELECT payload INTO v_payload FROM public.suggest_snapshot WHERE snapshot_date = v_date;
  IF v_payload IS NULL THEN
    RETURN jsonb_build_object('status', 'NO_SNAPSHOT', 'snapshot_date', v_date);
  END IF;

  WITH src AS (
    SELECT DISTINCT ON ((m->>'fixture_id')::uuid)
           (m->>'fixture_id')::uuid AS fixture_id,
           (m->>'kickoff')::timestamptz AS kickoff_at,
           m->>'home' AS home_team,
           m->>'away' AS away_team,
           (m->>'lambda_home_ft')::real AS lambda_home_ft,
           (m->>'lambda_away_ft')::real AS lambda_away_ft,
           (m->>'p_over05_ht')::real AS p_over05_ht,
           (m->>'p_over075_ht')::real AS p_over075_ht,
           (m->>'p_over1_ht')::real AS p_over1_ht,
           m->>'top_market' AS top_market,
           (m->>'top_market_prob')::real AS top_market_prob,
           (m->>'pred_home_ht')::smallint AS pred_home_ht,
           (m->>'pred_away_ht')::smallint AS pred_away_ht,
           (m->>'pred_home_ft')::smallint AS pred_home_ft,
           (m->>'pred_away_ft')::smallint AS pred_away_ft
    FROM jsonb_array_elements(v_payload->'slots') s
    CROSS JOIN LATERAL jsonb_array_elements(s->'matches') m
    WHERE m ? 'fixture_id' AND m ? 'lambda_home_ft' AND m ? 'p_over075_ht'
    ORDER BY (m->>'fixture_id')::uuid
  ),
  prepared AS (
    SELECT src.*,
           COALESCE(v.target_date, (src.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS target_date,
           v.canonical_home_team_id AS home_team_id,
           v.canonical_away_team_id AS away_team_id,
           CASE WHEN src.p_over075_ht >= 0.65 THEN 'CAO'
                WHEN src.p_over075_ht >= 0.60 THEN 'KHA'
                WHEN src.p_over075_ht >= 0.55 THEN 'TB'
                WHEN src.p_over075_ht >= 0.50 THEN 'THAP'
                ELSE 'RAT_THAP' END AS confidence_tier
    FROM src
    LEFT JOIN public.cfi_living_verified_fixtures v ON v.fixture_id = src.fixture_id
    WHERE src.kickoff_at > now() + interval '5 minutes'
  ),
  up AS (
    INSERT INTO public.suggest_pick_log AS l (
      fixture_id, target_date, kickoff_at, home_team, away_team, home_team_id, away_team_id,
      lambda_home_ft, lambda_away_ft, p_over05_ht, p_over075_ht, p_over1_ht,
      top_market, top_market_prob, pred_home_ht, pred_away_ht, pred_home_ft, pred_away_ft,
      confidence_tier, p_over075_ht_first
    )
    SELECT fixture_id, target_date, kickoff_at, home_team, away_team, home_team_id, away_team_id,
           lambda_home_ft, lambda_away_ft, p_over05_ht, p_over075_ht, p_over1_ht,
           top_market, top_market_prob, pred_home_ht, pred_away_ht, pred_home_ft, pred_away_ft,
           confidence_tier, p_over075_ht
    FROM prepared
    ON CONFLICT (fixture_id) DO UPDATE SET
      target_date = EXCLUDED.target_date,
      kickoff_at = EXCLUDED.kickoff_at,
      home_team_id = COALESCE(EXCLUDED.home_team_id, l.home_team_id),
      away_team_id = COALESCE(EXCLUDED.away_team_id, l.away_team_id),
      lambda_home_ft = EXCLUDED.lambda_home_ft,
      lambda_away_ft = EXCLUDED.lambda_away_ft,
      p_over05_ht = EXCLUDED.p_over05_ht,
      p_over075_ht = EXCLUDED.p_over075_ht,
      p_over1_ht = EXCLUDED.p_over1_ht,
      top_market = EXCLUDED.top_market,
      top_market_prob = EXCLUDED.top_market_prob,
      pred_home_ht = EXCLUDED.pred_home_ht,
      pred_away_ht = EXCLUDED.pred_away_ht,
      pred_home_ft = EXCLUDED.pred_home_ft,
      pred_away_ft = EXCLUDED.pred_away_ft,
      confidence_tier = EXCLUDED.confidence_tier,
      n_updates = l.n_updates + 1,
      last_logged_at = now()
    WHERE l.kickoff_at > now() + interval '5 minutes'
      AND l.settled_at IS NULL
      AND (l.kickoff_at, l.lambda_home_ft, l.lambda_away_ft, l.p_over075_ht, l.top_market)
          IS DISTINCT FROM
          (EXCLUDED.kickoff_at, EXCLUDED.lambda_home_ft, EXCLUDED.lambda_away_ft, EXCLUDED.p_over075_ht, EXCLUDED.top_market)
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COALESCE(count(*) FILTER (WHERE inserted), 0),
         COALESCE(count(*) FILTER (WHERE NOT inserted), 0),
         (SELECT count(*) FROM prepared)
    INTO v_inserted, v_updated, v_candidates
  FROM up;

  RETURN jsonb_build_object(
    'status', 'OK',
    'snapshot_date', v_date,
    'candidates_before_kickoff', v_candidates,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$function$;
