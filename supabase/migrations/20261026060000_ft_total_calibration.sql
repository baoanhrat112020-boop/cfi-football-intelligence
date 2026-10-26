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
  IF position('lc double precision' IN d) > 0 THEN
    RAISE NOTICE 'ft total calibration already applied';
    RETURN;
  END IF;
  nd := replace(
    d,
    'p_o25 double precision := 1.0 - exp(-lft) * (1.0 + lft + lft * lft / 2.0);',
    'lc double precision := power(3.2, 0.4) * power(greatest(lft, 0.1), 0.6);' || E'\n  ' ||
    'p_o25 double precision := 1.0 - exp(-lc) * (1.0 + lc + lc * lc / 2.0);'
  );
  IF nd = d THEN
    RAISE EXCEPTION 'cfi_score_pred p_o25 pattern not found';
  END IF;
  d := nd;
  nd := replace(d, 'f2 double precision := lft * lft / 2.0 * exp(-lft);', 'f2 double precision := lc * lc / 2.0 * exp(-lc);');
  IF nd = d THEN
    RAISE EXCEPTION 'cfi_score_pred f2 pattern not found';
  END IF;
  d := nd;
  nd := replace(d, 'f3 double precision := lft * lft * lft / 6.0 * exp(-lft);', 'f3 double precision := lc * lc * lc / 6.0 * exp(-lc);');
  IF nd = d THEN
    RAISE EXCEPTION 'cfi_score_pred f3 pattern not found';
  END IF;
  EXECUTE nd;
END
$do$;
