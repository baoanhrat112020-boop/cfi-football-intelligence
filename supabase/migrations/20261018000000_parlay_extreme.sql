ALTER TABLE public.parlay_log DROP CONSTRAINT IF EXISTS parlay_log_mode_check;
ALTER TABLE public.parlay_log ADD CONSTRAINT parlay_log_mode_check CHECK (mode IN ('suggest','round','special','xspecial','xdaily'));

CREATE OR REPLACE FUNCTION public.cfi_parlay_leg_score(p_type text, p_line numeric, p_hh int, p_ha int, p_fh int, p_fa int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
SELECT CASE
  WHEN p_type = 'btts' THEN CASE WHEN p_fh > 0 AND p_fa > 0 THEN 1 ELSE -1 END
  WHEN p_type = 'btts_ht' THEN CASE WHEN p_hh > 0 AND p_ha > 0 THEN 1 ELSE -1 END
  WHEN p_type = 'x3ht' THEN CASE WHEN p_hh + p_ha >= 3 THEN 1 ELSE -1 END
  WHEN p_type = 'xoht' THEN CASE WHEN p_hh >= 4 OR p_ha >= 4 THEN 1 ELSE -1 END
  WHEN p_type = 'xoft' THEN CASE WHEN p_fh >= 5 OR p_fa >= 5 THEN 1 ELSE -1 END
  WHEN p_type = 'x7ft' THEN CASE WHEN p_fh + p_fa >= 7 THEN 1 ELSE -1 END
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
