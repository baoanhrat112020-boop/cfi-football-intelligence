CREATE OR REPLACE FUNCTION public.cfi_report_hours(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'n', n, 'hits', h, 'p', round(p::numeric, 4)) ORDER BY b), '[]'::jsonb)
FROM (
  SELECT (floor(extract(hour FROM l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh') / 4) * 4)::int AS b,
         count(*) AS n, count(*) FILTER (WHERE l.hit_top_market) AS h, avg(l.top_market_prob) AS p
  FROM public.suggest_pick_log l
  WHERE (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
    AND l.settled_at IS NOT NULL AND l.void_reason IS NULL AND l.ft_home IS NOT NULL
    AND l.top_market IS NOT NULL AND l.hit_top_market IS NOT NULL
    AND (l.home_team || ' ' || l.away_team) !~* '\mU1[0-8]\M'
    AND l.top_market !~ '^over_[01]\d*_ft$'
    AND l.top_market !~ '^over_0_?[0-6]?\d*_ht$'
  GROUP BY 1
) t;
$function$;

REVOKE ALL ON FUNCTION public.cfi_report_hours(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_report_hours(date, date) TO service_role;
