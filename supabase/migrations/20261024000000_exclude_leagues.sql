DO $do$
DECLARE
  re text := '\m(Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M';
  d text;
  nd text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'cfi_log_suggest_picks';
  IF d IS NULL OR position('Baller League' IN d) > 0 THEN RAISE NOTICE 'cfi_log_suggest_picks skipped'; ELSE
    nd := replace(d, 'WHERE m ? ''fixture_id'' AND m ? ''lambda_home_ft'' AND m ? ''p_over075_ht''', 'WHERE m ? ''fixture_id'' AND m ? ''lambda_home_ft'' AND m ? ''p_over075_ht'' AND COALESCE(m->>''competition'', '''') !~* ' || quote_literal(re));
    IF nd = d THEN RAISE EXCEPTION 'cfi_log_suggest_picks pattern not found'; END IF;
    EXECUTE nd;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'cfi_goldme';
  IF d IS NULL OR position('Baller League' IN d) > 0 THEN RAISE NOTICE 'cfi_goldme skipped'; ELSE
    nd := replace(d, 'AND m ? ''fixture_id''', 'AND m ? ''fixture_id'' AND COALESCE(m->>''competition'', '''') !~* ' || quote_literal(re));
    IF nd = d THEN RAISE EXCEPTION 'cfi_goldme pattern not found'; END IF;
    EXECUTE nd;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'cfi_report';
  IF d IS NULL OR position('Baller League' IN d) > 0 THEN RAISE NOTICE 'cfi_report skipped'; ELSE
    nd := replace(d, 'U1[0-8]|Oberliga', 'U1[0-8]|Baller League|Oberliga');
    IF nd = d THEN RAISE EXCEPTION 'cfi_report pattern not found'; END IF;
    EXECUTE nd;
  END IF;
END
$do$;
