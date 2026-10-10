CREATE OR REPLACE FUNCTION public.ou_result(goals integer, line numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN goals IS NULL OR line IS NULL THEN NULL
    ELSE (
      SELECT CASE (sign(goals - b.lo) + sign(goals - b.hi))
        WHEN 2 THEN 'WIN'
        WHEN 1 THEN 'HALF_WIN'
        WHEN 0 THEN 'PUSH'
        WHEN -1 THEN 'HALF_LOSS'
        ELSE 'LOSS'
      END
      FROM (
        SELECT CASE WHEN (line * 4)::int % 2 = 1 THEN line - 0.25 ELSE line END AS lo,
               CASE WHEN (line * 4)::int % 2 = 1 THEN line + 0.25 ELSE line END AS hi
      ) b
    )
  END
$function$;
