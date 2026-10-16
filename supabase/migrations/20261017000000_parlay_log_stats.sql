CREATE TABLE IF NOT EXISTS public.parlay_log (
  mode text NOT NULL CHECK (mode IN ('suggest','round')),
  pkey text NOT NULL,
  day date NOT NULL,
  scope text NOT NULL,
  ptype text NOT NULL,
  n_legs smallint NOT NULL,
  system_p numeric NOT NULL,
  legs jsonb NOT NULL,
  user_legs jsonb,
  user_p numeric CHECK (user_p IS NULL OR (user_p >= 0 AND user_p <= 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  settled_at timestamptz,
  result text CHECK (result IN ('WIN','LOSS','HALF_LOSS','PUSH','VOID')),
  ret numeric,
  PRIMARY KEY (mode, pkey)
);

CREATE INDEX IF NOT EXISTS parlay_log_unsettled_idx ON public.parlay_log (day) WHERE settled_at IS NULL;
CREATE INDEX IF NOT EXISTS parlay_log_day_idx ON public.parlay_log (day);

ALTER TABLE public.parlay_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parlay_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cfi_parlay_leg_score(p_type text, p_line numeric, p_hh int, p_ha int, p_fh int, p_fa int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
SELECT CASE
  WHEN p_type = 'btts' THEN CASE WHEN p_fh > 0 AND p_fa > 0 THEN 1 ELSE -1 END
  WHEN p_type = 'btts_ht' THEN CASE WHEN p_hh > 0 AND p_ha > 0 THEN 1 ELSE -1 END
  WHEN p_line IS NULL THEN NULL
  ELSE (
    WITH t AS (SELECT CASE WHEN p_type = 'ou_ht' THEN p_hh + p_ha ELSE p_fh + p_fa END AS g)
    SELECT CASE WHEN abs(p_line * 4 - round(p_line * 4)) < 1e-9 AND (p_line * 4)::int % 2 = 1
      THEN ((CASE WHEN g > p_line - 0.25 THEN 1 WHEN g = p_line - 0.25 THEN 0 ELSE -1 END)
          + (CASE WHEN g > p_line + 0.25 THEN 1 WHEN g = p_line + 0.25 THEN 0 ELSE -1 END)) / 2.0
      ELSE (CASE WHEN g > p_line THEN 1 WHEN g = p_line THEN 0 ELSE -1 END)::numeric
    END FROM t
  )
END;
$function$;

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
        odds := (ul->>'odds')::numeric;
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

CREATE OR REPLACE FUNCTION public.cfi_parlay_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT mode, ptype, result, ret,
         (user_legs IS NOT NULL) AS is_user,
         CASE WHEN user_legs IS NOT NULL AND user_p IS NOT NULL THEN user_p ELSE system_p END AS p,
         n_legs, day, scope, legs, pkey
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
recent AS (
  SELECT mode, ptype, scope, result, ret, is_user, round(p::numeric, 4) AS p, n_legs, day
  FROM base ORDER BY day DESC, scope DESC LIMIT 30
)
SELECT jsonb_build_object(
  'days', p_days,
  'groups', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM grp g), '[]'::jsonb),
  'totals', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM tot t), '[]'::jsonb),
  'recent', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM recent r), '[]'::jsonb),
  'pending', (SELECT count(*) FROM public.parlay_log WHERE settled_at IS NULL)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_parlay_leg_score(text, numeric, int, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_parlay_settle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_parlay_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_leg_score(text, numeric, int, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_settle() TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_stats(integer) TO service_role;
