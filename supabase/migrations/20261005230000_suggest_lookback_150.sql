DO $do$
DECLARE
  d text := pg_get_functiondef('public.cfi_suggest_upcoming(integer)'::regprocedure);
  n text;
BEGIN
  n := replace(d, $q$v_lookback timestamptz := now() - interval '90 minutes';$q$, $q$v_lookback timestamptz := now() - interval '150 minutes';$q$);
  IF n = d THEN RAISE EXCEPTION 'lookback clause not found'; END IF;
  EXECUTE n;
END
$do$;
