CREATE OR REPLACE FUNCTION public.cfi_round_hit_rates()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT lower(f.country || ' · ' || f.competition_name) AS k, f.round,
         (f.ht_home + f.ht_away) AS ht, (f.ft_home + f.ft_away) AS ft,
         (f.ft_home > 0 AND f.ft_away > 0) AS btts
  FROM public.fixtures f
  WHERE f.round IS NOT NULL AND f.country IS NOT NULL AND f.competition_name IS NOT NULL
    AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL
    AND f.match_date >= (date_trunc('year', current_date - interval '6 months') + interval '6 months')::date
),
ranked AS (
  SELECT b.*, dense_rank() OVER (PARTITION BY b.k ORDER BY b.round DESC) AS rk FROM base b
),
agg AS (
  SELECT k,
         count(*) AS n_s,
         avg((ht >= 1)::int) AS s_o05_ht, avg((ht >= 2)::int) AS s_o15_ht,
         avg((ft >= 1)::int) AS s_o05_ft, avg((ft >= 2)::int) AS s_o15_ft,
         avg((ft >= 3)::int) AS s_o25_ft, avg((ft >= 4)::int) AS s_o35_ft,
         avg(btts::int) AS s_btts_ft,
         count(*) FILTER (WHERE rk <= 3) AS n_r,
         count(*) FILTER (WHERE rk <= 3 AND ht >= 1) AS r_o05_ht,
         count(*) FILTER (WHERE rk <= 3 AND ht >= 2) AS r_o15_ht,
         count(*) FILTER (WHERE rk <= 3 AND ft >= 1) AS r_o05_ft,
         count(*) FILTER (WHERE rk <= 3 AND ft >= 2) AS r_o15_ft,
         count(*) FILTER (WHERE rk <= 3 AND ft >= 3) AS r_o25_ft,
         count(*) FILTER (WHERE rk <= 3 AND ft >= 4) AS r_o35_ft,
         count(*) FILTER (WHERE rk <= 3 AND btts) AS r_btts_ft
  FROM ranked GROUP BY k
  HAVING count(*) FILTER (WHERE rk <= 3) >= 8
)
SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object(
  'n', n_r,
  'o05_ht', round(((r_o05_ht + 5 * s_o05_ht) / (n_r + 5))::numeric, 4),
  'o15_ht', round(((r_o15_ht + 5 * s_o15_ht) / (n_r + 5))::numeric, 4),
  'o05_ft', round(((r_o05_ft + 5 * s_o05_ft) / (n_r + 5))::numeric, 4),
  'o15_ft', round(((r_o15_ft + 5 * s_o15_ft) / (n_r + 5))::numeric, 4),
  'o25_ft', round(((r_o25_ft + 5 * s_o25_ft) / (n_r + 5))::numeric, 4),
  'o35_ft', round(((r_o35_ft + 5 * s_o35_ft) / (n_r + 5))::numeric, 4),
  'btts_ft', round(((r_btts_ft + 5 * s_btts_ft) / (n_r + 5))::numeric, 4)
)), '{}'::jsonb)
FROM agg;
$function$;

REVOKE ALL ON FUNCTION public.cfi_round_hit_rates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_round_hit_rates() TO service_role;
