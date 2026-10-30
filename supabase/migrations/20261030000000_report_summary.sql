CREATE OR REPLACE FUNCTION public.cfi_summary(p_from date, p_to date, p_min_n integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH x AS (
  SELECT 'singles'::text AS tab,
         COALESCE(l.legs->0->>'type', '?') || '|' || CASE WHEN (l.legs->0->>'line') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN trim_scale((l.legs->0->>'line')::numeric)::text ELSE '' END AS k,
         l.result IN ('WIN', 'LOSS', 'HALF_LOSS') AS settled, l.result = 'WIN' AS win, l.system_p AS p
  FROM public.parlay_log l WHERE l.mode = 'single' AND l.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'parlays', l.mode || '|' || l.ptype, l.result IN ('WIN', 'LOSS', 'HALF_LOSS'), l.result = 'WIN', l.system_p
  FROM public.parlay_log l WHERE l.mode <> 'single' AND l.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'picks', q.k, q.settled, q.win, q.p
  FROM (
    SELECT regexp_replace(l.top_market, '^over_(\d)_(\d+)_(ht|ft)$', 'over_\1\2_\3') AS k,
           l.settled_at IS NOT NULL AND l.void_reason IS NULL AND l.ft_home IS NOT NULL AND l.hit_top_market IS NOT NULL AS settled,
           COALESCE(l.hit_top_market, false) AS win, l.top_market_prob AS p
    FROM public.suggest_pick_log l
    WHERE (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
      AND l.top_market IS NOT NULL
      AND (l.home_team || ' ' || l.away_team) !~* '\mU1[0-8]\M'
  ) q
  WHERE q.k !~ '^over_[01]\d*_ft$' AND q.k !~ '^over_0[0-6]\d*_ht$'
  UNION ALL
  SELECT 'bc', b.market, b.settled_at IS NOT NULL AND NOT b.void AND b.hit IS NOT NULL, COALESCE(b.hit, false), b.p_win
  FROM public.best_choice_daily b WHERE b.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'bc_ht', b.market, b.settled_at IS NOT NULL AND NOT b.void AND b.hit IS NOT NULL, COALESCE(b.hit, false), b.p_win
  FROM public.best_choice_ht b WHERE b.day BETWEEN p_from AND p_to
  UNION ALL
  SELECT CASE WHEN r.grp = 'eng' THEN 'radar_eng' ELSE 'radar' END,
         CASE WHEN r.p < 0.15 THEN '<15%' WHEN r.p < 0.25 THEN '15-25%' WHEN r.p < 0.40 THEN '25-40%' ELSE '>=40%' END,
         r.settled_at IS NOT NULL AND r.gold IS NOT NULL, COALESCE(r.gold, false), r.p
  FROM public.goldme_radar r WHERE r.flagged AND r.day BETWEEN p_from AND p_to
), tabs AS (
  SELECT tab, count(*) AS n, count(*) FILTER (WHERE settled) AS settled, count(*) FILTER (WHERE settled AND win) AS wins,
         round(avg(p::numeric) FILTER (WHERE settled), 4) AS avg_p
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
      'key', t.tab, 'n', t.n, 'settled', t.settled, 'wins', t.wins,
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

CREATE OR REPLACE FUNCTION public.cfi_report_cached(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_ver constant integer := 8;
  v_store boolean;
  v_out jsonb;
BEGIN
  v_store := p_to < v_today - 1 AND p_from >= v_today - 178;
  IF v_store THEN
    SELECT c.payload INTO v_out FROM public.report_cache c
    WHERE c.d_from = p_from AND c.d_to = p_to AND c.min_n = p_min_n AND c.ver = v_ver;
    IF v_out IS NOT NULL THEN
      RETURN v_out;
    END IF;
  END IF;
  v_out := public.cfi_report(p_from, p_to, p_min_n)
    || jsonb_build_object(
      'hours', COALESCE(public.cfi_report_hours(p_from, p_to), '[]'::jsonb),
      'partial', p_from < v_today - 178,
      'best_choice', public.cfi_best_choice_report(p_from, p_to),
      'goldme', public.cfi_goldme_range(p_from, p_to),
      'radar', public.cfi_goldme_radar_report(p_from, p_to),
      'summary', public.cfi_summary(p_from, p_to)
    );
  IF v_store THEN
    INSERT INTO public.report_cache (d_from, d_to, min_n, ver, payload)
    VALUES (p_from, p_to, p_min_n, v_ver, v_out)
    ON CONFLICT (d_from, d_to, min_n) DO UPDATE
      SET ver = EXCLUDED.ver, payload = EXCLUDED.payload, built_at = now();
  END IF;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_report_cached(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_report_cached(date, date, integer) TO service_role;
