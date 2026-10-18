CREATE OR REPLACE FUNCTION public.cfi_goldme(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH snap AS (
  SELECT DISTINCT ON ((m->>'fixture_id')::uuid) (m->>'fixture_id')::uuid AS fid, m
  FROM public.suggest_snapshot s
  CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
  CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
  WHERE s.snapshot_date >= current_date - LEAST(GREATEST(COALESCE(p_days, 30), 1), 120) AND m ? 'fixture_id'
  ORDER BY (m->>'fixture_id')::uuid, s.snapshot_date DESC
),
base AS (
  SELECT l.ht_home, l.ht_away, l.ft_home, l.ft_away, l.p_over05_ht, l.pred_home_ht, l.pred_away_ht, l.pred_home_ft, l.pred_away_ft, sn.m,
         (l.ht_home + l.ht_away >= 3) AS x3ht,
         (l.ht_home >= 4 OR l.ht_away >= 4) AS xoht,
         (l.ft_home >= 5 OR l.ft_away >= 5) AS xoft,
         (l.ft_home + l.ft_away >= 7) AS x7ft
  FROM public.suggest_pick_log l
  JOIN snap sn ON sn.fid = l.fixture_id
  WHERE l.settled_at IS NOT NULL AND l.void_reason IS NULL
    AND l.ht_home IS NOT NULL AND l.ft_home IS NOT NULL
    AND l.kickoff_at >= now() - LEAST(GREATEST(COALESCE(p_days, 30), 1), 120) * interval '1 day'
),
types AS (
  SELECT * FROM (VALUES ('x3ht', '3+ HT'), ('xoht', 'Other HT'), ('xoft', 'Other FT'), ('x7ft', '7+ FT')) t(k, name)
),
summ AS (
  SELECT t.k, t.name,
    count(*) AS n,
    count(*) FILTER (WHERE (to_jsonb(b)->>t.k)::boolean) AS hits,
    avg((b.m->'probs'->>t.name)::numeric) AS p_all,
    avg((b.m->'probs'->>t.name)::numeric) FILTER (WHERE (to_jsonb(b)->>t.k)::boolean) AS p_hit,
    count(*) FILTER (WHERE b.m->'hit_markets' ? t.name) AS flag_n,
    count(*) FILTER (WHERE b.m->'hit_markets' ? t.name AND (to_jsonb(b)->>t.k)::boolean) AS flag_hits
  FROM base b CROSS JOIN types t
  GROUP BY t.k, t.name
),
rows AS (
  SELECT b.* FROM base b WHERE b.x3ht OR b.xoht OR b.xoft OR b.x7ft
  ORDER BY (b.m->>'kickoff') DESC LIMIT 150
)
SELECT jsonb_build_object(
  'days', LEAST(GREATEST(COALESCE(p_days, 30), 1), 120),
  'total', (SELECT count(*) FROM base),
  'summary', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type', k, 'n', n, 'hits', hits,
      'rate', CASE WHEN n > 0 THEN round(hits::numeric / n, 4) END,
      'p_all', round(p_all, 4), 'p_hit', round(p_hit, 4),
      'flag_n', flag_n, 'flag_hits', flag_hits) ORDER BY k) FROM summ), '[]'::jsonb),
  'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kickoff', r.m->>'kickoff', 'competition', r.m->>'competition',
      'home', r.m->>'home', 'away', r.m->>'away',
      'ht', r.ht_home || '-' || r.ht_away, 'ft', r.ft_home || '-' || r.ft_away,
      'hit', to_jsonb(ARRAY_REMOVE(ARRAY[CASE WHEN r.x3ht THEN 'x3ht' END, CASE WHEN r.xoht THEN 'xoht' END, CASE WHEN r.xoft THEN 'xoft' END, CASE WHEN r.x7ft THEN 'x7ft' END], NULL)),
      'probs', r.m->'probs', 'flagged', COALESCE(r.m->'hit_markets', '[]'::jsonb),
      'top_market', r.m->>'top_market', 'top_p', r.m->'top_market_prob',
      'ht_market', r.m->>'selected_ht_market', 'ht_line', r.m->'selected_ht_line',
      'ft_market', r.m->>'selected_ft_market', 'ft_line', r.m->'selected_ft_line',
      'lh', r.m->'lambda_home_ft', 'la', r.m->'lambda_away_ft',
      'pred_ht', CASE WHEN r.pred_home_ht IS NULL THEN NULL ELSE r.pred_home_ht || '-' || r.pred_away_ht END,
      'pred_ft', CASE WHEN r.pred_home_ft IS NULL THEN NULL ELSE r.pred_home_ft || '-' || r.pred_away_ft END
    ) ORDER BY r.m->>'kickoff' DESC) FROM rows r), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme(integer) TO service_role;
