ALTER TABLE public.best_choice_ht ADD COLUMN IF NOT EXISTS p_raw numeric;

CREATE OR REPLACE FUNCTION public.cfi_bc_ht_bias()
RETURNS TABLE(market text, n numeric, b numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT x.market, count(*)::numeric,
         LEAST(0.2, GREATEST(-0.2, avg(x.hit::int) - avg(COALESCE(x.p_raw, x.p_win))))
  FROM public.best_choice_ht x
  WHERE x.settled_at IS NOT NULL AND NOT x.void AND x.hit IS NOT NULL
    AND x.day >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 45
  GROUP BY x.market
$function$;

REVOKE ALL ON FUNCTION public.cfi_bc_ht_bias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_bc_ht_bias() TO service_role;

DO $$
DECLARE
  r record;
  d text;
  o1 text := '(h.n * h.r + 40 * c.p_model) / (h.n + 40) AS p_win';
  n1 text := 'GREATEST(0.01, LEAST(0.99, (h.n * h.r + 40 * c.p_model) / (h.n + 40) + COALESCE((SELECT bb.n / (bb.n + 60.0) * bb.b FROM public.cfi_bc_ht_bias() bb WHERE bb.market = c.market), 0))) AS p_win,
           (h.n * h.r + 40 * c.p_model) / (h.n + 40) AS p_raw';
  o2 text := 'p_model, p_win, hist_n)';
  n2 text := 'p_model, p_win, hist_n, p_raw)';
  o3 text := 'round(c.p_model, 4), round(c.p_win, 4), c.hist_n';
  n3 text := 'round(c.p_model, 4), round(c.p_win, 4), c.hist_n, round(c.p_raw, 4)';
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'cfi_best_choice_ht_build' AND p.prokind = 'f' LOOP
    d := pg_get_functiondef(r.oid);
    IF position('cfi_bc_ht_bias' IN d) > 0 THEN CONTINUE; END IF;
    IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 OR position(o3 IN d) = 0 THEN RAISE EXCEPTION 'cfi_best_choice_ht_build: pattern not found'; END IF;
    EXECUTE replace(replace(replace(d, o1, n1), o2, n2), o3, n3);
  END LOOP;
END $$;
