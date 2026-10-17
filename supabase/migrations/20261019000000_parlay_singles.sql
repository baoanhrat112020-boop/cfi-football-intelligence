ALTER TABLE public.parlay_log DROP CONSTRAINT IF EXISTS parlay_log_mode_check;
ALTER TABLE public.parlay_log ADD CONSTRAINT parlay_log_mode_check CHECK (mode IN ('suggest','round','special','xspecial','xdaily','single'));

CREATE OR REPLACE FUNCTION public.cfi_parlay_stats(p_days integer DEFAULT 30, p_group text DEFAULT 'std')
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT mode, ptype, result, ret, placed,
         (user_legs IS NOT NULL) AS is_user,
         CASE WHEN user_legs IS NOT NULL AND user_p IS NOT NULL THEN user_p ELSE system_p END AS p,
         n_legs, day, scope, split_part(scope, ':', 1) AS kind, pkey, system_p
  FROM public.parlay_log
  WHERE settled_at IS NOT NULL AND result IN ('WIN','LOSS','HALF_LOSS')
    AND day >= current_date - GREATEST(p_days, 1)
    AND (CASE WHEN p_group = 'x' THEN mode IN ('xspecial','xdaily') WHEN p_group = 's' THEN mode = 'single' ELSE mode IN ('suggest','round','special') END)
),
grp AS (
  SELECT mode, ptype, is_user,
         count(*) AS n,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         round(avg(p)::numeric, 4) AS avg_p,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(((result = 'WIN')::int - p)^2)::numeric, 4) AS brier,
         count(ret) AS n_odds,
         round(avg(ret - 1)::numeric, 4) AS roi
  FROM base GROUP BY mode, ptype, is_user
),
tot AS (
  SELECT mode, is_user,
         count(*) AS n,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         round(avg(p)::numeric, 4) AS avg_p,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         count(ret) AS n_odds,
         round(avg(ret - 1)::numeric, 4) AS roi
  FROM base GROUP BY mode, is_user
),
by_legs AS (
  SELECT mode, n_legs AS k, count(*) AS n,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(p)::numeric, 4) AS avg_p,
         count(ret) AS n_odds, round(avg(ret - 1)::numeric, 4) AS roi
  FROM base GROUP BY mode, n_legs
),
by_kind AS (
  SELECT mode, kind AS k, count(*) AS n,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(p)::numeric, 4) AS avg_p,
         count(ret) AS n_odds, round(avg(ret - 1)::numeric, 4) AS roi
  FROM base GROUP BY mode, kind
),
buckets AS (
  SELECT (floor(p * 10) * 10)::int AS lo, count(*) AS n,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(p)::numeric, 4) AS avg_p
  FROM base WHERE NOT is_user GROUP BY 1
),
placed AS (
  SELECT mode, count(*) AS n,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(p)::numeric, 4) AS avg_p,
         count(ret) AS n_odds, round(avg(ret - 1)::numeric, 4) AS roi,
         round(sum(ret - 1)::numeric, 3) AS profit
  FROM base WHERE placed GROUP BY mode
),
ranked AS (
  SELECT b.*, row_number() OVER (PARTITION BY b.mode, b.scope, b.ptype ORDER BY b.system_p DESC) AS rk
  FROM base b WHERE NOT b.is_user
),
top1 AS (
  SELECT mode, count(*) AS n,
         round((count(*) FILTER (WHERE result = 'WIN'))::numeric / count(*), 4) AS hit,
         round(avg(p)::numeric, 4) AS avg_p,
         count(ret) AS n_odds, round(avg(ret - 1)::numeric, 4) AS roi
  FROM ranked WHERE rk = 1 GROUP BY mode
),
daily AS (
  SELECT day, count(*) AS n, count(*) FILTER (WHERE result = 'WIN') AS wins,
         count(ret) AS n_odds, round(COALESCE(sum(ret - 1), 0)::numeric, 3) AS profit
  FROM base WHERE day >= current_date - 14 GROUP BY day
),
leg_rows AS (
  SELECT DISTINCT ON ((l.leg->>'fixture_id'), (l.leg->>'type'), COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric))
         (l.leg->>'type') AS ltype,
         COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric) AS line,
         (l.leg->>'p')::numeric AS p,
         public.cfi_parlay_leg_score(l.leg->>'type', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric), s.ht_home, s.ht_away, s.ft_home, s.ft_away) AS sc,
         ((u.e->>'line') IS NOT NULL) AS changed
  FROM public.parlay_log pl
  CROSS JOIN LATERAL jsonb_array_elements(pl.legs) WITH ORDINALITY AS l(leg, ord)
  LEFT JOIN LATERAL (
    SELECT e FROM jsonb_array_elements(COALESCE(pl.user_legs, '[]'::jsonb)) e WHERE (e->>'i')::int = l.ord - 1 LIMIT 1
  ) u ON true
  JOIN public.suggest_pick_log s ON s.fixture_id = (l.leg->>'fixture_id')::uuid
       AND s.settled_at IS NOT NULL AND s.void_reason IS NULL AND s.ft_home IS NOT NULL
  WHERE pl.settled_at IS NOT NULL AND pl.result IN ('WIN','LOSS','HALF_LOSS')
    AND pl.day >= current_date - GREATEST(p_days, 1)
    AND (CASE WHEN p_group = 'x' THEN pl.mode IN ('xspecial','xdaily') WHEN p_group = 's' THEN pl.mode = 'single' ELSE pl.mode IN ('suggest','round','special') END)
),
leg_grp AS (
  SELECT ltype, line, count(*) FILTER (WHERE sc <> 0) AS n,
         round((count(*) FILTER (WHERE sc > 0))::numeric / NULLIF(count(*) FILTER (WHERE sc <> 0), 0), 4) AS hit,
         round(avg(p) FILTER (WHERE NOT changed)::numeric, 4) AS avg_p
  FROM leg_rows WHERE sc IS NOT NULL GROUP BY ltype, line
  HAVING count(*) FILTER (WHERE sc <> 0) >= 3
),
recent AS (
  SELECT mode, ptype, scope, result, ret, is_user, placed, round(p::numeric, 4) AS p, n_legs, day
  FROM base ORDER BY day DESC, scope DESC LIMIT 30
)
SELECT jsonb_build_object(
  'days', p_days,
  'groups', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM grp g), '[]'::jsonb),
  'totals', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM tot t), '[]'::jsonb),
  'by_legs', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.mode, x.k) FROM by_legs x), '[]'::jsonb),
  'by_kind', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.mode, x.k) FROM by_kind x), '[]'::jsonb),
  'buckets', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lo) FROM buckets x), '[]'::jsonb),
  'placed', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM placed x), '[]'::jsonb),
  'top1', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM top1 x), '[]'::jsonb),
  'daily', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day DESC) FROM daily x), '[]'::jsonb),
  'legs', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ltype, x.line) FROM leg_grp x), '[]'::jsonb),
  'recent', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM recent r), '[]'::jsonb),
  'calibration', public.cfi_parlay_calibration(),
  'pending', (SELECT count(*) FROM public.parlay_log WHERE settled_at IS NULL AND (CASE WHEN p_group = 'x' THEN mode IN ('xspecial','xdaily') WHEN p_group = 's' THEN mode = 'single' ELSE mode IN ('suggest','round','special') END))
);
$function$;

CREATE OR REPLACE FUNCTION public.cfi_parlay_recent(p_days integer DEFAULT 30, p_limit integer DEFAULT 40, p_group text DEFAULT 'std')
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH r AS (
  SELECT pl.*
  FROM public.parlay_log pl
  WHERE pl.settled_at IS NOT NULL AND pl.result IN ('WIN','LOSS','HALF_LOSS')
    AND pl.day >= current_date - GREATEST(p_days, 1)
    AND (CASE WHEN p_group = 'x' THEN pl.mode IN ('xspecial','xdaily') WHEN p_group = 's' THEN pl.mode = 'single' ELSE pl.mode IN ('suggest','round','special') END)
  ORDER BY pl.day DESC, pl.settled_at DESC, pl.scope DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'mode', r.mode,
  'ptype', r.ptype,
  'scope', r.scope,
  'result', r.result,
  'ret', r.ret,
  'is_user', (r.user_legs IS NOT NULL),
  'placed', r.placed,
  'p', round((CASE WHEN r.user_legs IS NOT NULL AND r.user_p IS NOT NULL THEN r.user_p ELSE r.system_p END)::numeric, 4),
  'n_legs', r.n_legs,
  'day', r.day,
  'legs', (
    SELECT jsonb_agg(jsonb_build_object(
      'home', l.leg->>'home',
      'away', l.leg->>'away',
      'kickoff', l.leg->>'kickoff',
      'type', l.leg->>'type',
      'line', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric),
      'odds', CASE WHEN r.user_legs IS NOT NULL AND u.e IS NOT NULL THEN (u.e->>'odds')::numeric ELSE (l.leg->>'odds')::numeric END,
      'ht', s.ht_home || '-' || s.ht_away,
      'ft', s.ft_home || '-' || s.ft_away,
      'sc', public.cfi_parlay_leg_score(l.leg->>'type', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric), s.ht_home, s.ht_away, s.ft_home, s.ft_away)
    ) ORDER BY l.ord)
    FROM jsonb_array_elements(r.legs) WITH ORDINALITY AS l(leg, ord)
    LEFT JOIN LATERAL (
      SELECT e FROM jsonb_array_elements(COALESCE(r.user_legs, '[]'::jsonb)) e WHERE (e->>'i')::int = l.ord - 1 LIMIT 1
    ) u ON true
    LEFT JOIN public.suggest_pick_log s ON s.fixture_id = (l.leg->>'fixture_id')::uuid
  )
) ORDER BY r.day DESC, r.settled_at DESC, r.scope DESC), '[]'::jsonb)
FROM r;
$function$;

CREATE OR REPLACE FUNCTION public.cfi_parlay_placed(p_limit integer DEFAULT 50, p_group text DEFAULT 'std')
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH r AS (
  SELECT pl.*
  FROM public.parlay_log pl
  WHERE pl.placed
    AND (CASE WHEN p_group = 'x' THEN pl.mode IN ('xspecial','xdaily') WHEN p_group = 's' THEN pl.mode = 'single' ELSE pl.mode IN ('suggest','round','special') END)
  ORDER BY pl.day DESC, pl.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'mode', r.mode,
  'ptype', r.ptype,
  'scope', r.scope,
  'result', r.result,
  'ret', r.ret,
  'is_user', (r.user_legs IS NOT NULL),
  'placed', true,
  'p', round((CASE WHEN r.user_legs IS NOT NULL AND r.user_p IS NOT NULL THEN r.user_p ELSE r.system_p END)::numeric, 4),
  'n_legs', r.n_legs,
  'day', r.day,
  'legs', (
    SELECT jsonb_agg(jsonb_build_object(
      'home', l.leg->>'home',
      'away', l.leg->>'away',
      'kickoff', l.leg->>'kickoff',
      'type', l.leg->>'type',
      'line', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric),
      'odds', CASE WHEN r.user_legs IS NOT NULL AND u.e IS NOT NULL THEN (u.e->>'odds')::numeric ELSE (l.leg->>'odds')::numeric END,
      'ht', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN s.ht_home || '-' || s.ht_away END,
      'ft', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN s.ft_home || '-' || s.ft_away END,
      'sc', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN public.cfi_parlay_leg_score(l.leg->>'type', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric), s.ht_home, s.ht_away, s.ft_home, s.ft_away) END
    ) ORDER BY l.ord)
    FROM jsonb_array_elements(r.legs) WITH ORDINALITY AS l(leg, ord)
    LEFT JOIN LATERAL (
      SELECT e FROM jsonb_array_elements(COALESCE(r.user_legs, '[]'::jsonb)) e WHERE (e->>'i')::int = l.ord - 1 LIMIT 1
    ) u ON true
    LEFT JOIN public.suggest_pick_log s ON s.fixture_id = (l.leg->>'fixture_id')::uuid
  )
) ORDER BY r.day DESC, r.created_at DESC), '[]'::jsonb)
FROM r;
$function$;

REVOKE ALL ON FUNCTION public.cfi_parlay_stats(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_parlay_recent(integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_parlay_placed(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_stats(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_recent(integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_placed(integer, text) TO service_role;
