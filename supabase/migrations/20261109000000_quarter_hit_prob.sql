DO $$
DECLARE
  r record;
  d text;
  o text := '''s_over_35_ft'', ROUND(q_ge4::numeric, 4),';
  n text := '''s_over_35_ft'', ROUND(q_ge4::numeric, 4),
    ''h_over_075_ht'', ROUND(q_ge1::numeric, 4),
    ''h_over_125_ht'', ROUND(q_ge2::numeric, 4),
    ''h_over_225_ft'', ROUND(p_o25::numeric, 4),
    ''h_over_275_ft'', ROUND(p_o25::numeric, 4),
    ''h_over_325_ft'', ROUND(q_ge4::numeric, 4),';
  c integer := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'cfi_score_pred' AND p.prokind = 'f' LOOP
    d := pg_get_functiondef(r.oid);
    IF position('''h_over_075_ht''' IN d) > 0 THEN CONTINUE; END IF;
    IF position(o IN d) = 0 THEN RAISE EXCEPTION 'cfi_score_pred: pattern not found'; END IF;
    EXECUTE replace(d, o, n);
    c := c + 1;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  d text;
  c integer := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'cfi_suggest_upcoming' AND p.prokind = 'f' LOOP
    d := pg_get_functiondef(r.oid);
    IF position('''h_'' || s.ht_market' IN d) > 0 THEN CONTINUE; END IF;
    IF position('(s.ht_market, s.ht_s)' IN d) = 0 OR position('(s.ft_market, s.ft_s)' IN d) = 0 THEN RAISE EXCEPTION 'cfi_suggest_upcoming: pattern not found'; END IF;
    d := replace(d, '(s.ht_market, s.ht_s)', '(s.ht_market, COALESCE((s.sp->>(''h_'' || s.ht_market))::numeric, s.ht_s))');
    d := replace(d, '(s.ft_market, s.ft_s)', '(s.ft_market, COALESCE((s.sp->>(''h_'' || s.ft_market))::numeric, s.ft_s))');
    EXECUTE d;
    c := c + 1;
  END LOOP;
END $$;
