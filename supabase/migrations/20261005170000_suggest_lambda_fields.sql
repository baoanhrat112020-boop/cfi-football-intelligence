DO $do$
DECLARE
  d text := pg_get_functiondef('public.cfi_suggest_upcoming(integer)'::regprocedure);
  n text := replace(
    d,
    '|| cfi_score_pred(f.lh, f.la))',
    '|| cfi_score_pred(f.lh, f.la) || jsonb_build_object(''lambda_home_ft'', ROUND(f.lh::numeric, 4), ''lambda_away_ft'', ROUND(f.la::numeric, 4)))'
  );
BEGIN
  IF n = d THEN
    RAISE EXCEPTION 'cfi_score_pred merge clause not found';
  END IF;
  EXECUTE n;
END
$do$;
