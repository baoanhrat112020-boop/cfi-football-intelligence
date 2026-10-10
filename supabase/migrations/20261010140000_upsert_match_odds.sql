CREATE OR REPLACE FUNCTION cfi_upsert_match_odds(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_row jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO match_odds (
      verified_fixture_id, source, market_family, period, line,
      odds_over, odds_under, odds_home, odds_draw, odds_away,
      odds_over_open, odds_under_open, odds_home_open, odds_draw_open, odds_away_open,
      p_implied_over, raw_line, handicap_side, league
    ) VALUES (
      (v_row->>'verified_fixture_id')::uuid,
      COALESCE(v_row->>'source', 'bongdawap'),
      v_row->>'market_family',
      v_row->>'period',
      NULLIF(v_row->>'line', '')::numeric,
      NULLIF(v_row->>'odds_over', '')::numeric,
      NULLIF(v_row->>'odds_under', '')::numeric,
      NULLIF(v_row->>'odds_home', '')::numeric,
      NULLIF(v_row->>'odds_draw', '')::numeric,
      NULLIF(v_row->>'odds_away', '')::numeric,
      NULLIF(v_row->>'odds_over', '')::numeric,
      NULLIF(v_row->>'odds_under', '')::numeric,
      NULLIF(v_row->>'odds_home', '')::numeric,
      NULLIF(v_row->>'odds_draw', '')::numeric,
      NULLIF(v_row->>'odds_away', '')::numeric,
      NULLIF(v_row->>'p_implied_over', '')::numeric,
      v_row->>'raw_line',
      v_row->>'handicap_side',
      v_row->>'league'
    )
    ON CONFLICT (verified_fixture_id, source, market_family, period, line)
    DO UPDATE SET
      odds_over = EXCLUDED.odds_over,
      odds_under = EXCLUDED.odds_under,
      odds_home = EXCLUDED.odds_home,
      odds_draw = EXCLUDED.odds_draw,
      odds_away = EXCLUDED.odds_away,
      p_implied_over = EXCLUDED.p_implied_over,
      raw_line = EXCLUDED.raw_line,
      handicap_side = EXCLUDED.handicap_side,
      last_seen_at = now(),
      n_fetches = match_odds.n_fetches + 1;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION cfi_upsert_match_odds(jsonb) FROM anon, authenticated, PUBLIC;
