CREATE OR REPLACE FUNCTION public.cfi_best_choice_build(p_day date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_day date;
  v_from timestamptz;
  v_to timestamptz;
  v_cnt integer;
BEGIN
  v_day := COALESCE(p_day, v_today);
  v_from := (v_day::text || ' 00:00:00+07')::timestamptz;
  v_to := v_from + interval '1 day';
  IF NOT p_force AND EXISTS (SELECT 1 FROM public.best_choice_daily WHERE day = v_day) THEN
    SELECT count(*) INTO v_cnt FROM public.best_choice_daily WHERE day = v_day;
    RETURN v_cnt;
  END IF;
  IF p_force THEN
    DELETE FROM public.best_choice_daily WHERE day = v_day;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.best_choice_hist) THEN
    PERFORM public.cfi_bc_refresh_hist(4000, false);
  END IF;
  WITH snap AS (
    SELECT s.payload FROM public.suggest_snapshot s
    WHERE s.snapshot_date <= v_today
    ORDER BY s.snapshot_date DESC, s.generated_at DESC LIMIT 1
  ), cand AS (
    SELECT (m->>'fixture_id')::uuid AS fixture_id,
           m->>'provider_id' AS provider_id,
           (m->>'kickoff')::timestamptz AS kickoff_at,
           m->>'home' AS home,
           m->>'away' AS away,
           m->>'competition' AS comp,
           pr.market,
           pr.p AS p_model,
           COALESCE((m->>'no_stats')::boolean, false) AS no_stats,
           (COALESCE(jsonb_typeof(m->'market_odds') = 'array' AND jsonb_array_length(m->'market_odds') > 0, false)
            OR EXISTS (SELECT 1 FROM public.match_odds x WHERE x.verified_fixture_id = (m->>'fixture_id')::uuid)) AS has_odds
    FROM snap s
    CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
    CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
    LEFT JOIN LATERAL (
      SELECT mo.line::numeric AS ln
      FROM public.match_odds mo
      WHERE mo.verified_fixture_id = (m->>'fixture_id')::uuid
        AND mo.market_family = 'OVER_UNDER' AND mo.period = 'FT'
        AND mo.line IS NOT NULL AND mo.odds_over > 1 AND mo.odds_under > 1
      ORDER BY abs(mo.odds_over - mo.odds_under), (mo.source = 'bongdawap') DESC, mo.last_seen_at DESC
      LIMIT 1
    ) ml ON true
    LEFT JOIN (VALUES
      (2.0, 'over_2_ft', 's_over_2_ft'),
      (2.25, 'over_225_ft', 's_over_225_ft'),
      (2.5, 'over_25_ft', 's_over_25_ft'),
      (2.75, 'over_275_ft', 's_over_275_ft'),
      (3.0, 'over_3_ft', 's_over_3_ft'),
      (3.25, 'over_325_ft', 's_over_325_ft'),
      (3.5, 'over_35_ft', 's_over_35_ft')
    ) lm(ln, market, key) ON lm.ln = ml.ln
    CROSS JOIN LATERAL (VALUES
      ('1x2_ht_home', (m->'markets'->>'m_1x2_ht_home')::numeric),
      ('1x2_ft_home', (m->'markets'->>'m_1x2_ft_home')::numeric),
      ('btts_yes', (m->'markets'->>'m_btts_yes')::numeric),
      (CASE WHEN ml.ln IS NULL THEN 'over_25_ft' ELSE lm.market END, (m->>(CASE WHEN ml.ln IS NULL THEN 's_over_25_ft' ELSE lm.key END))::numeric),
      ('over_15_ht', (m->>'s_over15_ht')::numeric)
    ) pr(market, p)
    WHERE m ? 'fixture_id' AND pr.market IS NOT NULL AND pr.p IS NOT NULL
  ), scored AS (
    SELECT c.*, h.n AS hist_n, public.cfi_league_tier(c.comp) AS tier,
           (h.n * h.r + 40 * c.p_model) / (h.n + 40) AS p_win
    FROM cand c
    JOIN public.best_choice_hist h ON h.market = c.market AND h.band = floor(c.p_model * 20) / 20 AND h.n >= 20
    WHERE c.kickoff_at >= v_from AND c.kickoff_at < v_to AND c.kickoff_at > now()
      AND NOT c.no_stats
      AND c.provider_id IS NOT NULL
      AND (COALESCE(c.comp, '') || ' ' || COALESCE(c.home, '') || ' ' || COALESCE(c.away, '')) !~* '(\mU1[0-8]\M|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)'
  ), best AS (
    SELECT DISTINCT ON (s.fixture_id) s.*
    FROM scored s
    ORDER BY s.fixture_id, s.p_win DESC, s.market
  ), ranked AS (
    SELECT b.*, least(b.tier + CASE WHEN b.has_odds THEN 0 ELSE 1 END, 3) AS ptier,
           row_number() OVER (PARTITION BY b.comp ORDER BY b.p_win DESC) AS rn_lg
    FROM best b
    WHERE b.p_win >= 0.60
  ), pool AS (
    SELECT r.*, row_number() OVER (ORDER BY (CASE WHEN r.p_win >= 0.70 THEN 0 ELSE 1 END), r.ptier, r.p_win DESC) AS ord,
           count(*) FILTER (WHERE r.p_win >= 0.70) OVER () AS n_strong
    FROM ranked r
    WHERE r.rn_lg <= 3
  ), chosen AS (
    SELECT p.*, row_number() OVER (ORDER BY p.p_win DESC, p.ptier, p.ord) AS rk
    FROM pool p
    WHERE p.ord <= least(20, greatest(10, p.n_strong))
  )
  INSERT INTO public.best_choice_daily (day, fixture_id, rank, provider_id, kickoff_at, home_team, away_team, competition, tier, has_odds, market, p_model, p_win, hist_n)
  SELECT v_day, c.fixture_id, c.rk, c.provider_id, c.kickoff_at, c.home, c.away, c.comp, c.tier, c.has_odds, c.market,
         round(c.p_model, 4), round(c.p_win, 4), c.hist_n
  FROM chosen c
  ON CONFLICT (day, fixture_id) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.best_choice_daily WHERE day = v_day;
  RETURN v_cnt;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_build(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_build(date, boolean) TO service_role;
