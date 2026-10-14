BEGIN;

DROP FUNCTION IF EXISTS public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text);

CREATE FUNCTION public.cfi_suggest_track_record(p_days integer DEFAULT NULL::integer, p_tier text DEFAULT NULL::text, p_before_kickoff timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_before_fixture uuid DEFAULT NULL::uuid, p_model_version text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_competitions text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH comp AS (
  SELECT s.fixture_id,
         CASE WHEN v.source_provenance->>'stage' IS NOT NULL AND v.source_provenance->>'league' IS NOT NULL AND v.source_provenance->>'league' <> v.source_provenance->>'stage'
                THEN (v.source_provenance->>'stage') || ' · ' || (v.source_provenance->>'league')
              WHEN v.source_provenance->>'stage' IS NOT NULL THEN v.source_provenance->>'stage'
              ELSE NULL END AS name
  FROM public.suggest_pick_log s
  JOIN public.cfi_living_verified_fixtures v ON v.fixture_id = s.fixture_id
),
base AS (
  SELECT * FROM public.suggest_pick_log
  WHERE (p_days IS NULL OR kickoff_at >= now() - make_interval(days => p_days))
    AND (p_tier IS NULL OR confidence_tier = p_tier)
    AND (p_model_version IS NULL OR model_version = p_model_version)
    AND (p_market IS NULL OR CASE WHEN top_market = 'over_2_5_ft' OR top_market ~ '^over_\d\d*_ft$' THEN 'over_ft'
                                  WHEN top_market ~ '^over_\d\d*_ht$' THEN 'over_ht'
                                  ELSE top_market END = p_market)
    AND (p_competitions IS NULL OR fixture_id IN (SELECT c.fixture_id FROM comp c WHERE c.name = ANY(p_competitions)))
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
labeled AS (
  SELECT b.*, x.line AS ou_line, x.label AS top_result
  FROM base b
  CROSS JOIN LATERAL (
    SELECT m.line,
           CASE
             WHEN b.top_market IS NULL OR b.settled_at IS NULL THEN NULL
             WHEN m.period = 'ht' THEN CASE WHEN b.ht_home IS NOT NULL THEN public.ou_result(b.ht_home + b.ht_away, m.line) END
             WHEN m.period = 'ft' THEN public.ou_result(b.ft_home + b.ft_away, m.line)
             ELSE CASE b.hit_top_market WHEN true THEN 'WIN' WHEN false THEN 'LOSS' END
           END AS label
    FROM (
      SELECT CASE WHEN b.top_market = 'over_2_5_ft' THEN 'ft' ELSE q.r[3] END AS period,
             CASE WHEN b.top_market = 'over_2_5_ft' THEN 2.5
                  WHEN q.r IS NULL THEN NULL
                  WHEN q.r[2] = '' THEN q.r[1]::numeric
                  ELSE (q.r[1] || '.' || q.r[2])::numeric END AS line
      FROM (SELECT regexp_match(b.top_market, '^over_(\d)(\d*)_(ht|ft)$') AS r) q
    ) m
  ) x
),
market_stats AS (
  SELECT l.model_version,
         CASE WHEN l.top_market = 'over_2_5_ft' OR l.top_market ~ '^over_\d\d*_ft$' THEN 'over_ft'
              WHEN l.top_market ~ '^over_\d\d*_ht$' THEN 'over_ht'
              ELSE l.top_market END AS market,
         l.ou_line AS line,
         count(*) FILTER (WHERE l.top_result = 'WIN') AS n_win,
         count(*) FILTER (WHERE l.top_result = 'HALF_WIN') AS n_half_win,
         count(*) FILTER (WHERE l.top_result = 'PUSH') AS n_push,
         count(*) FILTER (WHERE l.top_result = 'HALF_LOSS') AS n_half_loss,
         count(*) FILTER (WHERE l.top_result = 'LOSS') AS n_loss,
         avg(l.top_market_prob) FILTER (WHERE l.top_result <> 'PUSH') AS prob_avg
  FROM labeled l
  WHERE l.settled_at IS NOT NULL AND l.void_reason IS DISTINCT FROM 'NO_RESULT' AND l.top_result IS NOT NULL
  GROUP BY 1, 2, 3
),
market_rate AS (
  SELECT ms.*,
         (ms.n_win + ms.n_half_win + ms.n_half_loss + ms.n_loss) AS n,
         (ms.n_win + 0.75 * ms.n_half_win + 0.25 * ms.n_half_loss)::double precision
           / NULLIF(ms.n_win + ms.n_half_win + ms.n_half_loss + ms.n_loss, 0) AS hit_rate
  FROM market_stats ms
),
market_ci AS (
  SELECT mr.*,
         CASE WHEN mr.n > 0 THEN
           greatest(0, (mr.hit_rate + 3.841459 / (2 * mr.n)
             - 1.959964 * sqrt(mr.hit_rate * (1 - mr.hit_rate) / mr.n + 3.841459 / (4 * mr.n * mr.n)))
             / (1 + 3.841459 / mr.n)) END AS ci_low,
         CASE WHEN mr.n > 0 THEN
           least(1, (mr.hit_rate + 3.841459 / (2 * mr.n)
             + 1.959964 * sqrt(mr.hit_rate * (1 - mr.hit_rate) / mr.n + 3.841459 / (4 * mr.n * mr.n)))
             / (1 + 3.841459 / mr.n)) END AS ci_high
  FROM market_rate mr
),
recent AS (
  SELECT fixture_id, kickoff_at, home_team, away_team,
         CASE WHEN ht_home IS NOT NULL THEN ht_home || '-' || ht_away END AS ht_score,
         ft_home || '-' || ft_away AS ft_score,
         confidence_tier, top_market, hit_top_market, result_o075, ou_line, top_result, model_version
  FROM labeled
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
  'model_version', p_model_version,
  'market', p_market,
  'competitions_filter', to_jsonb(p_competitions),
  'competitions', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'n', n) ORDER BY n DESC, name) FROM (SELECT name, count(*) AS n FROM comp WHERE name IS NOT NULL GROUP BY name) cn), '[]'::jsonb),
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
      'market', market, 'line', line, 'model_version', model_version,
      'n', n, 'n_win', n_win, 'n_half_win', n_half_win, 'n_push', n_push,
      'n_half_loss', n_half_loss, 'n_loss', n_loss,
      'prob_avg', round(prob_avg::numeric, 4), 'hit_rate', round(hit_rate::numeric, 4),
      'wilson_95_low', round(ci_low::numeric, 4), 'wilson_95_high', round(ci_high::numeric, 4)
    ) ORDER BY n DESC, market, line, model_version) FROM market_ci
  ), '[]'::jsonb),
  'recent_settled', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'fixture_id', fixture_id,
      'kickoff', kickoff_at, 'home', home_team, 'away', away_team,
      'ht_score', ht_score, 'ft_score', ft_score, 'tier', confidence_tier,
      'top_market', top_market, 'top_line', ou_line, 'top_result', top_result,
      'hit', hit_top_market, 'o075_result', result_o075, 'model_version', model_version
    ) ORDER BY kickoff_at DESC, fixture_id DESC) FROM recent
  ), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text, text[]) TO service_role;

COMMIT;
