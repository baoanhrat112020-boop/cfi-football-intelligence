CREATE OR REPLACE FUNCTION public.cfi_ou_high(lft double precision)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    's_over_375_ft', ROUND((ge5 + 0.75 * p4)::numeric, 4),
    's_over_4_ft', ROUND((ge5 + 0.50 * p4)::numeric, 4),
    's_over_425_ft', ROUND((ge5 + 0.25 * p4)::numeric, 4),
    's_over_45_ft', ROUND(ge5::numeric, 4),
    's_over_475_ft', ROUND((ge6 + 0.75 * p5)::numeric, 4),
    's_over_5_ft', ROUND((ge6 + 0.50 * p5)::numeric, 4)
  )
  FROM (
    SELECT exp(-lft) * power(lft, 4) / 24.0 AS p4,
           exp(-lft) * power(lft, 5) / 120.0 AS p5,
           1.0 - exp(-lft) * (1.0 + lft + lft * lft / 2.0 + power(lft, 3) / 6.0 + power(lft, 4) / 24.0) AS ge5,
           1.0 - exp(-lft) * (1.0 + lft + lft * lft / 2.0 + power(lft, 3) / 6.0 + power(lft, 4) / 24.0 + power(lft, 5) / 120.0) AS ge6
  ) q
$function$;

REVOKE ALL ON FUNCTION public.cfi_ou_high(double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_ou_high(double precision) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_bc_probs(j jsonb)
RETURNS TABLE(market text, p numeric)
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT v.market, v.p FROM (VALUES
    ('1x2_ht_home', (j->'markets'->>'m_1x2_ht_home')::numeric),
    ('1x2_ft_home', (j->'markets'->>'m_1x2_ft_home')::numeric),
    ('btts_yes', (j->'markets'->>'m_btts_yes')::numeric),
    ('over_225_ft', (j->>'s_over_225_ft')::numeric),
    ('over_25_ft', (j->>'s_over_25_ft')::numeric),
    ('over_275_ft', (j->>'s_over_275_ft')::numeric),
    ('over_325_ft', (j->>'s_over_325_ft')::numeric),
    ('over_35_ft', (j->>'s_over_35_ft')::numeric),
    ('over_375_ft', (j->>'s_over_375_ft')::numeric),
    ('over_4_ft', (j->>'s_over_4_ft')::numeric),
    ('over_425_ft', (j->>'s_over_425_ft')::numeric),
    ('over_45_ft', (j->>'s_over_45_ft')::numeric),
    ('over_475_ft', (j->>'s_over_475_ft')::numeric),
    ('over_5_ft', (j->>'s_over_5_ft')::numeric),
    ('over_2_ft', (j->>'s_over_2_ft')::numeric),
    ('over_3_ft', (j->>'s_over_3_ft')::numeric),
    ('over_075_ht', (j->>'s_over075_ht')::numeric),
    ('over_125_ht', (j->>'s_over125_ht')::numeric),
    ('over_15_ht', (j->>'s_over15_ht')::numeric)
  ) v(market, p) WHERE v.p IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.cfi_bc_probs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_bc_probs(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_bc_refresh_hist(p_limit integer DEFAULT 4000, p_rebuild boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new integer;
BEGIN
  IF p_rebuild THEN
    DELETE FROM public.best_choice_hist_rows;
  END IF;
  DELETE FROM public.best_choice_hist_rows WHERE kickoff_at < now() - interval '45 days';
  WITH base AS MATERIALIZED (
    SELECT l.fixture_id, l.kickoff_at, l.ht_home, l.ht_away, l.ft_home, l.ft_away, l.lambda_home_ft, l.lambda_away_ft
    FROM public.suggest_pick_log l
    WHERE l.settled_at IS NOT NULL AND l.ft_home IS NOT NULL AND l.ft_away IS NOT NULL
      AND l.kickoff_at >= now() - interval '45 days'
      AND (l.home_team || ' ' || l.away_team) !~* '\mU1[0-8]\M'
      AND NOT EXISTS (SELECT 1 FROM public.best_choice_hist_rows r WHERE r.fixture_id = l.fixture_id)
    ORDER BY l.kickoff_at DESC
    LIMIT p_limit
  ), src AS MATERIALIZED (
    SELECT b.*, public.cfi_score_pred(b.lambda_home_ft::double precision, b.lambda_away_ft::double precision) AS sp
    FROM base b
  ), ins AS (
    INSERT INTO public.best_choice_hist_rows (fixture_id, kickoff_at, market, p, hit)
    SELECT s.fixture_id, s.kickoff_at, pr.market, pr.p, public.cfi_market_hit(pr.market, s.ht_home, s.ht_away, s.ft_home, s.ft_away)
    FROM src s
    CROSS JOIN LATERAL public.cfi_bc_probs(s.sp || COALESCE(public.cfi_ou_high((s.lambda_home_ft + s.lambda_away_ft)::double precision), '{}'::jsonb)) pr
    ON CONFLICT DO NOTHING
    RETURNING fixture_id
  )
  SELECT count(DISTINCT fixture_id) INTO v_new FROM ins;
  DELETE FROM public.best_choice_hist;
  INSERT INTO public.best_choice_hist (market, band, n, r)
  SELECT hr.market, floor(hr.p * 20) / 20, count(*), avg(hr.hit::int)::numeric
  FROM public.best_choice_hist_rows hr
  WHERE hr.hit IS NOT NULL
  GROUP BY 1, 2;
  RETURN v_new;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_bc_refresh_hist(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_bc_refresh_hist(integer, boolean) TO service_role;

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
      (3.5, 'over_35_ft', 's_over_35_ft'),
      (3.75, 'over_375_ft', 's_over_375_ft'),
      (4.0, 'over_4_ft', 's_over_4_ft'),
      (4.25, 'over_425_ft', 's_over_425_ft'),
      (4.5, 'over_45_ft', 's_over_45_ft'),
      (4.75, 'over_475_ft', 's_over_475_ft'),
      (5.0, 'over_5_ft', 's_over_5_ft')
    ) lm(ln, market, key) ON lm.ln = ml.ln
    CROSS JOIN LATERAL (SELECT m || COALESCE(public.cfi_ou_high(((m->>'lambda_home_ft')::double precision) + ((m->>'lambda_away_ft')::double precision)), '{}'::jsonb) AS mm) hx
    CROSS JOIN LATERAL (VALUES
      ('1x2_ht_home', (m->'markets'->>'m_1x2_ht_home')::numeric),
      ('1x2_ft_home', (m->'markets'->>'m_1x2_ft_home')::numeric),
      ('btts_yes', (m->'markets'->>'m_btts_yes')::numeric),
      (CASE WHEN ml.ln IS NULL THEN 'over_25_ft' ELSE lm.market END, (hx.mm->>(CASE WHEN ml.ln IS NULL THEN 's_over_25_ft' ELSE lm.key END))::numeric),
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
