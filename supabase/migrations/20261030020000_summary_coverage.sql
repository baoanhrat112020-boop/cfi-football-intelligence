CREATE OR REPLACE FUNCTION public.cfi_summary(p_from date, p_to date, p_min_n integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH x AS (
  SELECT 'singles'::text AS tab,
         COALESCE(l.legs->0->>'type', '?') || '|' || CASE WHEN (l.legs->0->>'line') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN trim_scale((l.legs->0->>'line')::numeric)::text ELSE '' END AS k,
         l.result IN ('WIN', 'LOSS', 'HALF_LOSS') AS settled, l.result = 'WIN' AS win, l.system_p AS p,
         l.result IS NULL AND l.day >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1 AS pend, l.result IS NULL AND l.day < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1 AS miss
  FROM public.parlay_log l WHERE l.mode = 'single' AND l.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'parlays', l.mode || '|' || l.ptype, l.result IN ('WIN', 'LOSS', 'HALF_LOSS'), l.result = 'WIN', l.system_p,
         l.result IS NULL AND l.day >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1, l.result IS NULL AND l.day < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1
  FROM public.parlay_log l WHERE l.mode <> 'single' AND l.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'picks', q.k, q.settled, q.win, q.p, q.pend, q.miss
  FROM (
    SELECT regexp_replace(l.top_market, '^over_(\d)_(\d+)_(ht|ft)$', 'over_\1\2_\3') AS k,
           l.settled_at IS NOT NULL AND l.void_reason IS NULL AND l.ft_home IS NOT NULL AND l.hit_top_market IS NOT NULL AS settled,
           COALESCE(l.hit_top_market, false) AS win, l.top_market_prob AS p,
           l.settled_at IS NULL AND l.kickoff_at >= now() - interval '30 hours' AS pend,
           (l.settled_at IS NULL AND l.kickoff_at < now() - interval '30 hours')
             OR (l.settled_at IS NOT NULL AND (l.void_reason IS NOT NULL OR l.ft_home IS NULL)) AS miss
    FROM public.suggest_pick_log l
    WHERE (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
      AND l.top_market IS NOT NULL
      AND (l.home_team || ' ' || l.away_team) !~* '\mU1[0-8]\M'
  ) q
  WHERE q.k !~ '^over_[01]\d*_ft$' AND q.k !~ '^over_0[0-6]\d*_ht$'
  UNION ALL
  SELECT 'bc', b.market, b.settled_at IS NOT NULL AND NOT b.void AND b.hit IS NOT NULL, COALESCE(b.hit, false), b.p_win,
         b.settled_at IS NULL AND b.kickoff_at >= now() - interval '30 hours',
         (b.settled_at IS NULL AND b.kickoff_at < now() - interval '30 hours') OR (b.void AND b.ht_home IS NULL AND b.market ~ '_ht$')
  FROM public.best_choice_daily b WHERE b.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'bc_ht', b.market, b.settled_at IS NOT NULL AND NOT b.void AND b.hit IS NOT NULL, COALESCE(b.hit, false), b.p_win,
         b.settled_at IS NULL AND b.kickoff_at >= now() - interval '30 hours',
         (b.settled_at IS NULL AND b.kickoff_at < now() - interval '30 hours') OR (b.void AND b.ht_home IS NULL)
  FROM public.best_choice_ht b WHERE b.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT CASE WHEN r.grp = 'eng' THEN 'radar_eng' ELSE 'radar' END,
         CASE WHEN r.p < 0.15 THEN '<15%' WHEN r.p < 0.25 THEN '15-25%' WHEN r.p < 0.40 THEN '25-40%' ELSE '>=40%' END,
         r.settled_at IS NOT NULL AND r.gold IS NOT NULL, COALESCE(r.gold, false), r.p,
         r.settled_at IS NULL AND r.kickoff_at >= now() - interval '30 hours', r.settled_at IS NULL AND r.kickoff_at < now() - interval '30 hours'
  FROM public.goldme_radar r WHERE r.flagged AND r.day BETWEEN p_from AND p_to
), tabs AS (
  SELECT tab, count(*) AS n, count(*) FILTER (WHERE settled) AS settled, count(*) FILTER (WHERE settled AND win) AS wins,
         round(avg(p::numeric) FILTER (WHERE settled), 4) AS avg_p,
         count(*) FILTER (WHERE pend) AS pend, count(*) FILTER (WHERE miss) AS miss
  FROM x GROUP BY tab
), grp AS (
  SELECT tab, k, count(*) AS n, count(*) FILTER (WHERE settled) AS settled, count(*) FILTER (WHERE settled AND win) AS wins,
         round(avg(p::numeric) FILTER (WHERE settled), 4) AS avg_p
  FROM x GROUP BY tab, k
)
SELECT jsonb_build_object(
  'from', p_from, 'to', p_to, 'min_n', p_min_n,
  'tabs', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', t.tab, 'n', t.n, 'settled', t.settled, 'wins', t.wins, 'pending', t.pend, 'missing', t.miss,
      'rate', CASE WHEN t.settled > 0 THEN round(t.wins::numeric / t.settled, 4) END,
      'avg_p', t.avg_p,
      'groups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('k', g.k, 'n', g.n, 'settled', g.settled, 'wins', g.wins,
                 'rate', CASE WHEN g.settled > 0 THEN round(g.wins::numeric / g.settled, 4) END,
                 'avg_p', g.avg_p, 'small', g.settled < p_min_n)
               ORDER BY (g.settled < p_min_n), CASE WHEN g.settled > 0 THEN g.wins::numeric / g.settled END DESC NULLS LAST, g.settled DESC, g.n DESC)
        FROM (SELECT * FROM grp WHERE grp.tab = t.tab ORDER BY (grp.settled < p_min_n), CASE WHEN grp.settled > 0 THEN grp.wins::numeric / grp.settled END DESC NULLS LAST, grp.settled DESC, grp.n DESC LIMIT 14) g
      ), '[]'::jsonb)
    ) ORDER BY CASE t.tab WHEN 'singles' THEN 1 WHEN 'picks' THEN 2 WHEN 'parlays' THEN 3 WHEN 'bc' THEN 4 WHEN 'bc_ht' THEN 5 WHEN 'radar' THEN 6 ELSE 7 END)
    FROM tabs t), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_summary(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_summary(date, date, integer) TO service_role;
