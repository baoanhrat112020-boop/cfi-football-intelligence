SELECT
  model_version,
  count(*) FILTER (WHERE settled_at IS NOT NULL AND hit_top_market IS NOT NULL) AS n_settled,
  count(*) FILTER (WHERE settled_at IS NULL) AS n_pending,
  min(target_date) AS first_target_date,
  (current_date - min(target_date)) AS days_since_start,
  (count(*) FILTER (WHERE settled_at IS NOT NULL AND hit_top_market IS NOT NULL) >= 1000
    OR (current_date - min(target_date)) >= 14) AS ready
FROM suggest_pick_log
WHERE model_version IN ('v2_ht050', 'v3_dynamic')
GROUP BY 1
ORDER BY 1;

SELECT
  model_version,
  count(*) AS n,
  avg(power(top_market_prob - hit_top_market::int, 2)) AS brier,
  avg(top_market_prob) AS avg_pred,
  avg(hit_top_market::int) AS avg_actual,
  (avg(top_market_prob) - avg(hit_top_market::int)) * 100 AS gap_pts,
  count(*) FILTER (WHERE top_market ~ '_(075|125|225|275|325)_') AS n_quarter_line
FROM suggest_pick_log
WHERE settled_at IS NOT NULL
  AND void_reason IS NULL
  AND hit_top_market IS NOT NULL
  AND top_market_prob IS NOT NULL
  AND model_version IN ('v2_ht050', 'v3_dynamic')
GROUP BY 1
ORDER BY 1;

SELECT
  model_version,
  count(*) AS n,
  avg(power(top_market_prob - hit_top_market::int, 2)) AS brier,
  avg(top_market_prob) AS avg_pred,
  avg(hit_top_market::int) AS avg_actual,
  (avg(top_market_prob) - avg(hit_top_market::int)) * 100 AS gap_pts
FROM suggest_pick_log
WHERE settled_at IS NOT NULL
  AND void_reason IS NULL
  AND hit_top_market IS NOT NULL
  AND top_market_prob IS NOT NULL
  AND top_market !~ '_(075|125|225|275|325)_'
  AND model_version IN ('v2_ht050', 'v3_dynamic')
GROUP BY 1
ORDER BY 1;

SELECT
  model_version,
  (kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
  count(*) AS n,
  sum(power(top_market_prob - hit_top_market::int, 2)) AS sum_sq_err,
  sum(top_market_prob) AS sum_pred,
  sum(hit_top_market::int) AS sum_hit
FROM suggest_pick_log
WHERE settled_at IS NOT NULL
  AND void_reason IS NULL
  AND hit_top_market IS NOT NULL
  AND top_market_prob IS NOT NULL
  AND model_version IN ('v2_ht050', 'v3_dynamic')
GROUP BY 1, 2
ORDER BY 2, 1;

WITH d AS (
  SELECT
    model_version,
    (kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
    count(*) AS n,
    sum(power(top_market_prob - hit_top_market::int, 2)) AS s_err,
    sum(power(top_market_prob - hit_top_market::int, 4)) AS s_err4,
    sum(top_market_prob) AS s_pred,
    sum(hit_top_market::int) AS s_hit
  FROM suggest_pick_log
  WHERE settled_at IS NOT NULL
    AND void_reason IS NULL
    AND hit_top_market IS NOT NULL
    AND top_market_prob IS NOT NULL
    AND top_market !~ '_(075|125|225|275|325)_'
    AND model_version IN ('v2_ht050', 'v3_dynamic')
  GROUP BY 1, 2
),
m AS (
  SELECT
    model_version,
    sum(n) AS n,
    count(*) AS n_days,
    sum(s_err) / sum(n) AS brier,
    (sum(s_pred) - sum(s_hit)) / sum(n) * 100 AS gap_pts,
    sum(s_err4) / sum(n) AS mean_err4
  FROM d
  GROUP BY 1
),
se AS (
  SELECT
    m.model_version,
    m.n,
    m.n_days,
    m.brier,
    m.gap_pts,
    CASE
      WHEN m.model_version = 'v3_dynamic'
        THEN sqrt((SELECT sum(power(d.s_err - m.brier * d.n, 2)) FROM d WHERE d.model_version = m.model_version)) / m.n
      ELSE sqrt((m.mean_err4 - power(m.brier, 2)) / m.n)
    END AS se_brier
  FROM m
),
v2 AS (SELECT * FROM se WHERE model_version = 'v2_ht050'),
v3 AS (SELECT * FROM se WHERE model_version = 'v3_dynamic'),
r AS (
  SELECT
    v3.n AS n_v3,
    v3.n_days AS days_v3,
    v2.n AS n_v2,
    v2.n_days AS days_v2,
    v3.brier - v2.brier AS diff,
    sqrt(power(v3.se_brier, 2) + power(v2.se_brier, 2)) AS se_diff,
    v3.gap_pts AS v3_gap_pts
  FROM v2, v3
)
SELECT
  n_v3,
  days_v3,
  n_v2,
  days_v2,
  diff AS brier_diff_v3_minus_v2,
  se_diff,
  diff - 1.96 * se_diff AS ci_low,
  diff + 1.96 * se_diff AS ci_high,
  CASE
    WHEN diff - 1.96 * se_diff > 0.005 THEN 'v3_worse_rollback_to_v2'
    WHEN diff + 1.96 * se_diff < -0.005 THEN 'v3_better'
    ELSE 'indistinguishable_keep_v3'
  END AS brier_rule,
  v3_gap_pts,
  CASE
    WHEN v3_gap_pts <= 2 THEN 'ok'
    WHEN v3_gap_pts > 5 THEN 'overfit_rollback'
    ELSE 'warn'
  END AS gap_rule
FROM r;
