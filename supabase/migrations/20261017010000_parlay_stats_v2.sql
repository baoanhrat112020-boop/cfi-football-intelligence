ALTER TABLE public.parlay_log ADD COLUMN IF NOT EXISTS placed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.cfi_parlay_settle()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT pl.mode, pl.pkey, pl.legs, pl.user_legs
    FROM public.parlay_log pl
    WHERE pl.settled_at IS NULL AND pl.day <= current_date + 1
  LOOP
    DECLARE
      leg jsonb;
      i int := 0;
      ul jsonb;
      fid uuid;
      s record;
      sc numeric;
      line numeric;
      odds numeric;
      mult numeric := 1;
      all_odds boolean := true;
      any_loss boolean := false;
      any_half boolean := false;
      all_push boolean := true;
      pending boolean := false;
      voided boolean := false;
    BEGIN
      FOR leg IN SELECT * FROM jsonb_array_elements(r.legs) LOOP
        i := i + 1;
        ul := NULL;
        IF r.user_legs IS NOT NULL THEN
          SELECT e INTO ul FROM jsonb_array_elements(r.user_legs) e WHERE (e->>'i')::int = i - 1 LIMIT 1;
        END IF;
        fid := (leg->>'fixture_id')::uuid;
        SELECT * INTO s FROM public.suggest_pick_log WHERE fixture_id = fid;
        IF NOT FOUND OR s.settled_at IS NULL THEN pending := true; EXIT; END IF;
        IF s.void_reason IS NOT NULL OR s.ft_home IS NULL THEN voided := true; EXIT; END IF;
        line := COALESCE((ul->>'line')::numeric, (leg->>'line')::numeric);
        sc := public.cfi_parlay_leg_score(leg->>'type', line, s.ht_home, s.ht_away, s.ft_home, s.ft_away);
        IF sc IS NULL THEN voided := true; EXIT; END IF;
        IF ul IS NOT NULL THEN odds := (ul->>'odds')::numeric; ELSE odds := (leg->>'odds')::numeric; END IF;
        IF odds IS NULL OR odds <= 1 THEN all_odds := false;
        ELSIF sc >= 0 THEN mult := mult * (1 + sc * (odds - 1));
        ELSE mult := mult * (1 + sc);
        END IF;
        IF sc = -1 THEN any_loss := true; END IF;
        IF sc = -0.5 THEN any_half := true; END IF;
        IF sc <> 0 THEN all_push := false; END IF;
      END LOOP;
      IF pending THEN CONTINUE; END IF;
      UPDATE public.parlay_log SET
        settled_at = now(),
        result = CASE WHEN voided THEN 'VOID' WHEN any_loss THEN 'LOSS' WHEN any_half THEN 'HALF_LOSS' WHEN all_push THEN 'PUSH' ELSE 'WIN' END,
        ret = CASE WHEN voided OR NOT all_odds THEN NULL ELSE round(mult, 4) END
      WHERE mode = r.mode AND pkey = r.pkey;
      n := n + 1;
    END;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cfi_parlay_calibration()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH g AS (
  SELECT mode, ptype, count(*) AS n,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         avg(system_p) AS avg_p
  FROM public.parlay_log
  WHERE settled_at IS NOT NULL AND result IN ('WIN','LOSS','HALF_LOSS')
    AND user_legs IS NULL AND day >= current_date - 90
  GROUP BY mode, ptype
  HAVING count(*) >= 30 AND avg(system_p) > 0
)
SELECT COALESCE(jsonb_object_agg(mode || '|' || ptype, jsonb_build_object(
  'r', round(LEAST(1.3, GREATEST(0.5, (wins + 20 * avg_p) / ((n + 20) * avg_p)))::numeric, 3),
  'n', n,
  'avg_p', round(avg_p::numeric, 4),
  'hit', round((wins::numeric / n), 4)
)), '{}'::jsonb)
FROM g;
$function$;

CREATE OR REPLACE FUNCTION public.cfi_parlay_stats(p_days integer DEFAULT 30)
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
  'pending', (SELECT count(*) FROM public.parlay_log WHERE settled_at IS NULL)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_parlay_calibration() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_calibration() TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_settle() TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_stats(integer) TO service_role;
