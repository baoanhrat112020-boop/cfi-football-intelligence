ALTER TABLE public.parlay_log ADD COLUMN IF NOT EXISTS rank_mode text NOT NULL DEFAULT 'prob' CHECK (rank_mode IN ('prob', 'edge'));

CREATE OR REPLACE VIEW public.parlay_log_prob AS SELECT * FROM public.parlay_log WHERE rank_mode = 'prob';
REVOKE ALL ON public.parlay_log_prob FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.parlay_log_prob TO service_role;

DO $do$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cfi_parlay_calibration', 'cfi_parlay_stats', 'cfi_parlay_recent'] LOOP
    FOR d IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = f LOOP
      IF d NOT LIKE '%public.parlay_log_prob%' THEN
        EXECUTE replace(d, 'public.parlay_log', 'public.parlay_log_prob');
      END IF;
    END LOOP;
  END LOOP;
END
$do$;

CREATE OR REPLACE FUNCTION public.cfi_league_base()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT lower(f.country || ' · ' || f.competition_name) AS k,
         (f.ht_home + f.ht_away) AS ht, (f.ft_home + f.ft_away) AS ft,
         (f.ft_home > 0 AND f.ft_away > 0) AS btts, (f.ht_home > 0 AND f.ht_away > 0) AS bttsh
  FROM public.fixtures f
  WHERE f.country IS NOT NULL AND f.competition_name IS NOT NULL
    AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL
    AND f.match_date >= (date_trunc('year', current_date - interval '6 months') + interval '6 months')::date
    AND f.match_date < current_date
),
agg AS (
  SELECT k, count(*) AS n,
         jsonb_build_array(round(avg((ft >= 1)::int), 4), round(avg((ft >= 2)::int), 4), round(avg((ft >= 3)::int), 4), round(avg((ft >= 4)::int), 4), round(avg((ft >= 5)::int), 4)) AS ft,
         jsonb_build_array(round(avg((ht >= 1)::int), 4), round(avg((ht >= 2)::int), 4), round(avg((ht >= 3)::int), 4)) AS ht,
         round(avg(btts::int), 4) AS btts, round(avg(bttsh::int), 4) AS btts_ht
  FROM base GROUP BY k HAVING count(*) >= 30
)
SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('n', n, 'ft', ft, 'ht', ht, 'btts', btts, 'btts_ht', btts_ht)), '{}'::jsonb) FROM agg;
$function$;

REVOKE ALL ON FUNCTION public.cfi_league_base() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_league_base() TO service_role;
