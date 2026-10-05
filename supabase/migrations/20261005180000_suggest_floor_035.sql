DO $do$
DECLARE
  d text := pg_get_functiondef('public.cfi_suggest_upcoming(integer)'::regprocedure);
  n text := replace(d, 'WHERE p_over075_ht >= 0.62', 'WHERE p_over075_ht >= 0.35');
BEGIN
  IF n = d THEN
    RAISE EXCEPTION 'filter clause not found';
  END IF;
  EXECUTE n;
END
$do$;
