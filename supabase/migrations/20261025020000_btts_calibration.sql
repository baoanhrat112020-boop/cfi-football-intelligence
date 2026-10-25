DO $do$
DECLARE
  d text;
  nd text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'cfi_score_pred'
    AND pg_get_function_identity_arguments(p.oid) = 'lh double precision, la double precision';
  IF d IS NULL THEN
    RAISE EXCEPTION 'cfi_score_pred not found';
  END IF;
  IF position('power(greatest(lft, 0.1), -0.6)' IN d) > 0 THEN
    RAISE NOTICE 'btts calibration already applied';
    RETURN;
  END IF;
  nd := replace(
    d,
    'p_btts double precision := (1.0 - exp(-lh)) * (1.0 - exp(-la));',
    'p_btts double precision := (1.0 - exp(-lh * power(2.8, 0.6) * power(greatest(lft, 0.1), -0.6))) * (1.0 - exp(-la * power(2.8, 0.6) * power(greatest(lft, 0.1), -0.6)));'
  );
  IF nd = d THEN
    RAISE EXCEPTION 'cfi_score_pred btts pattern not found';
  END IF;
  EXECUTE nd;
END
$do$;
