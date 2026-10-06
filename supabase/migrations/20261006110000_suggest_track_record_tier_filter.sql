DROP FUNCTION IF EXISTS public.cfi_suggest_track_record(integer);

CREATE OR REPLACE FUNCTION public.cfi_suggest_track_record(p_days integer DEFAULT NULL, p_tier text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
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
  SELECT kickoff_at, home_team, away_team,
         CASE WHEN ht_home IS NOT NULL THEN ht_home || '-' || ht_away END AS ht_score,
         ft_home || '-' || ft_away AS ft_score,
         confidence_tier, top_market, hit_top_market, result_o075
  FROM base
  WHERE settled_at IS NOT NULL AND void_reason IS DISTINCT FROM 'NO_RESULT'
  ORDER BY kickoff_at DESC
  LIMIT 100
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
      'kickoff', kickoff_at, 'home', home_team, 'away', away_team,
      'ht_score', ht_score, 'ft_score', ft_score, 'tier', confidence_tier,
      'top_market', top_market, 'hit', hit_top_market, 'o075_result', result_o075
    ) ORDER BY kickoff_at DESC) FROM recent
  ), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_suggest_track_record(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_suggest_track_record(integer, text) TO service_role;
