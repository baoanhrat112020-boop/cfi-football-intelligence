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
      SELECT (e->>'line')::numeric AS line
      FROM jsonb_array_elements(COALESCE(p.market_odds, '[]'::jsonb)) e
      WHERE e->>'family' = 'OVER_UNDER' AND e->>'period' = 'FT' AND e->>'line' IS NOT NULL
      LIMIT 1
    ) mkt ON true
    LEFT JOIN LATERAL (
      SELECT c.market, c.line, c.s
      FROM (VALUES
        ('over_2_ft', 2.0, (p.sp->>'s_over_2_ft')::numeric),
        ('over_225_ft', 2.25, (p.sp->>'s_over_225_ft')::numeric),
        ('over_25_ft', 2.5, (p.sp->>'s_over_25_ft')::numeric),
        ('over_275_ft', 2.75, (p.sp->>'s_over_275_ft')::numeric),
        ('over_3_ft', 3.0, (p.sp->>'s_over_3_ft')::numeric),
        ('over_325_ft', 3.25, (p.sp->>'s_over_325_ft')::numeric),
        ('over_35_ft', 3.5, (p.sp->>'s_over_35_ft')::numeric)
      ) AS c(market, line, s)
      WHERE CASE WHEN mkt.line IS NOT NULL THEN c.line = mkt.line AND c.s >= 0.5
                 ELSE c.s BETWEEN 0.55 AND 0.70 END
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
