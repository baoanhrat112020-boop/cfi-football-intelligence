CREATE OR REPLACE FUNCTION public.cfi_log_suggest_picks(p_snapshot_date date DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.cfi_log_suggest_picks(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_settle_suggest_picks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_log_suggest_picks(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_settle_suggest_picks() TO service_role;
