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
    ('over_1_ht', (j->>'s_over1_ht')::numeric),
    ('over_125_ht', (j->>'s_over125_ht')::numeric),
    ('over_15_ht', (j->>'s_over15_ht')::numeric)
  ) v(market, p) WHERE v.p IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.cfi_bc_probs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_bc_probs(jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.best_choice_ht (LIKE public.best_choice_daily INCLUDING ALL);

ALTER TABLE public.best_choice_ht ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.best_choice_ht FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.best_choice_ht TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_best_choice_ht_build(p_day date DEFAULT NULL, p_force boolean DEFAULT false)
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
  IF NOT p_force AND EXISTS (SELECT 1 FROM public.best_choice_ht WHERE day = v_day) THEN
    SELECT count(*) INTO v_cnt FROM public.best_choice_ht WHERE day = v_day;
    RETURN v_cnt;
  END IF;
  IF p_force THEN
    DELETE FROM public.best_choice_ht WHERE day = v_day;
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
           lm.market,
           (m->>lm.key)::numeric AS p_model,
           COALESCE((m->>'no_stats')::boolean, false) AS no_stats
    FROM snap s
    CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
    CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
    JOIN LATERAL (
      SELECT mo.line::numeric AS ln
      FROM public.match_odds mo
      WHERE mo.verified_fixture_id = (m->>'fixture_id')::uuid
        AND mo.market_family = 'OVER_UNDER' AND mo.period = 'HT'
        AND mo.line IS NOT NULL AND mo.odds_over > 1 AND mo.odds_under > 1
      ORDER BY abs(mo.odds_over - mo.odds_under), (mo.source = 'bongdawap') DESC, mo.last_seen_at DESC
      LIMIT 1
    ) ml ON true
    JOIN (VALUES
      (0.75, 'over_075_ht', 's_over075_ht'),
      (1.0, 'over_1_ht', 's_over1_ht'),
      (1.25, 'over_125_ht', 's_over125_ht'),
      (1.5, 'over_15_ht', 's_over15_ht')
    ) lm(ln, market, key) ON lm.ln = ml.ln
    WHERE m ? 'fixture_id' AND (m->>lm.key) IS NOT NULL
  ), scored AS (
    SELECT c.*, h.n AS hist_n, public.cfi_league_tier(c.comp) AS tier,
           (h.n * h.r + 40 * c.p_model) / (h.n + 40) AS p_win
    FROM cand c
    JOIN public.best_choice_hist h ON h.market = c.market AND h.band = floor(c.p_model * 20) / 20 AND h.n >= 20
    WHERE c.kickoff_at >= v_from AND c.kickoff_at < v_to AND c.kickoff_at > now()
      AND NOT c.no_stats
      AND c.provider_id IS NOT NULL
      AND (COALESCE(c.comp, '') || ' ' || COALESCE(c.home, '') || ' ' || COALESCE(c.away, '')) !~* '(\mU1[0-8]\M|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)'
  ), ranked AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.comp ORDER BY s.p_win DESC) AS rn_lg
    FROM scored s
    WHERE s.p_win >= 0.50
  ), chosen AS (
    SELECT r.*, row_number() OVER (ORDER BY r.p_win DESC, r.tier, r.kickoff_at) AS rk
    FROM ranked r
    WHERE r.rn_lg <= 2
  )
  INSERT INTO public.best_choice_ht (day, fixture_id, rank, provider_id, kickoff_at, home_team, away_team, competition, tier, has_odds, market, p_model, p_win, hist_n)
  SELECT v_day, c.fixture_id, c.rk, c.provider_id, c.kickoff_at, c.home, c.away, c.comp, c.tier, true, c.market,
         round(c.p_model, 4), round(c.p_win, 4), c.hist_n
  FROM chosen c
  WHERE c.rk <= 5
  ON CONFLICT (day, fixture_id) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.best_choice_ht WHERE day = v_day;
  RETURN v_cnt;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_ht_build(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_ht_build(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_best_choice_settle()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cnt integer := 0;
  v_ht integer := 0;
  v_void integer := 0;
BEGIN
  WITH u AS (
    UPDATE public.best_choice_daily b SET
      settled_at = now(),
      ht_home = l.ht_home,
      ht_away = l.ht_away,
      ft_home = l.ft_home,
      ft_away = l.ft_away,
      hit = public.cfi_market_hit(b.market, l.ht_home, l.ht_away, l.ft_home, l.ft_away),
      void = public.cfi_market_hit(b.market, l.ht_home, l.ht_away, l.ft_home, l.ft_away) IS NULL
    FROM public.suggest_pick_log l
    WHERE l.fixture_id = b.fixture_id
      AND b.settled_at IS NULL
      AND l.settled_at IS NOT NULL
      AND l.ft_home IS NOT NULL AND l.ft_away IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_cnt FROM u;
  WITH u AS (
    UPDATE public.best_choice_ht b SET
      settled_at = now(),
      ht_home = l.ht_home,
      ht_away = l.ht_away,
      ft_home = l.ft_home,
      ft_away = l.ft_away,
      hit = public.cfi_market_hit(b.market, l.ht_home, l.ht_away, l.ft_home, l.ft_away),
      void = public.cfi_market_hit(b.market, l.ht_home, l.ht_away, l.ft_home, l.ft_away) IS NULL
    FROM public.suggest_pick_log l
    WHERE l.fixture_id = b.fixture_id
      AND b.settled_at IS NULL
      AND l.settled_at IS NOT NULL
      AND l.ft_home IS NOT NULL AND l.ft_away IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_ht FROM u;
  WITH v AS (
    UPDATE public.best_choice_daily SET settled_at = now(), void = true
    WHERE settled_at IS NULL AND kickoff_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_void FROM v;
  UPDATE public.best_choice_ht SET settled_at = now(), void = true
  WHERE settled_at IS NULL AND kickoff_at < now() - interval '7 days';
  RETURN v_cnt + v_ht + v_void;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_settle() TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_best_choice_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT * FROM public.best_choice_daily WHERE day BETWEEN p_from AND p_to
  ), t AS (
    SELECT tier, count(*) FILTER (WHERE settled_at IS NOT NULL AND NOT void) AS n,
           count(*) FILTER (WHERE hit) AS hits,
           round(avg(p_win) FILTER (WHERE settled_at IS NOT NULL AND NOT void), 4) AS avg_p
    FROM b GROUP BY tier
  )
  SELECT jsonb_build_object(
    'days', (SELECT count(DISTINCT day) FROM b),
    'picks', (SELECT count(*) FROM b),
    'settled', (SELECT count(*) FROM b WHERE settled_at IS NOT NULL AND NOT void),
    'hits', (SELECT count(*) FROM b WHERE hit),
    'avg_p', (SELECT round(avg(p_win), 4) FROM b WHERE settled_at IS NOT NULL AND NOT void),
    'by_tier', COALESCE((SELECT jsonb_agg(jsonb_build_object('tier', tier, 'n', n, 'hits', hits, 'avg_p', avg_p) ORDER BY tier) FROM t), '[]'::jsonb),
    'ht', (SELECT jsonb_build_object(
        'picks', count(*),
        'settled', count(*) FILTER (WHERE settled_at IS NOT NULL AND NOT void),
        'hits', count(*) FILTER (WHERE hit),
        'avg_p', round(avg(p_win) FILTER (WHERE settled_at IS NOT NULL AND NOT void), 4))
      FROM public.best_choice_ht WHERE day BETWEEN p_from AND p_to)
  )
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_report(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_report(date, date) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('cfi-best-choice-ht-build', 'cfi-best-choice-ht-build-retry') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-best-choice-ht-build', '7 17 * * *', $cron$SELECT public.cfi_best_choice_ht_build()$cron$);
SELECT cron.schedule('cfi-best-choice-ht-build-retry', '37 17 * * *', $cron$SELECT public.cfi_best_choice_ht_build()$cron$);
