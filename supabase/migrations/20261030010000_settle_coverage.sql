CREATE OR REPLACE FUNCTION public.cfi_upsert_livescore_fixtures(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_other_id integer := 0;
  v_clash_filled integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status', 'ERROR', 'reason', 'ROWS_ARRAY_REQUIRED');
  END IF;
  v_total := jsonb_array_length(p_rows);
  IF v_total > 500 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'reason', 'MAX_500_ROWS');
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (r.fixture_id) r.*
    FROM jsonb_to_recordset(p_rows) AS r(
      fixture_id uuid, match_date date, home_team_id uuid, away_team_id uuid,
      ht_home integer, ht_away integer, ft_home integer, ft_away integer,
      status text, competition_key text, competition_name text, tier text,
      round integer, round_label text, country text
    )
    ORDER BY r.fixture_id
  ),
  clash AS (
    SELECT s.fixture_id, x.fixture_id AS existing_id
    FROM src s
    JOIN public.fixtures x
      ON x.match_date = s.match_date
     AND x.home_team_id = s.home_team_id
     AND x.away_team_id = s.away_team_id
     AND x.fixture_id <> s.fixture_id
  ),
  fill AS (
    UPDATE public.fixtures x
       SET round = COALESCE(x.round, s.round),
           round_label = COALESCE(x.round_label, s.round_label),
           country = COALESCE(x.country, s.country),
           competition_name = COALESCE(x.competition_name, s.competition_name),
           competition_key = COALESCE(x.competition_key, s.competition_key),
           updated_at = now()
      FROM clash c
      JOIN src s ON s.fixture_id = c.fixture_id
     WHERE x.fixture_id = c.existing_id
       AND ((x.round IS NULL AND s.round IS NOT NULL)
         OR (x.round_label IS NULL AND s.round_label IS NOT NULL)
         OR (x.country IS NULL AND s.country IS NOT NULL)
         OR (x.competition_name IS NULL AND s.competition_name IS NOT NULL)
         OR (x.competition_key IS NULL AND s.competition_key IS NOT NULL))
    RETURNING 1
  ),
  up AS (
    INSERT INTO public.fixtures AS f (
      fixture_id, match_date, home_team_id, away_team_id,
      ht_home, ht_away, ft_home, ft_away,
      status, competition_key, tier, competition_name,
      round, round_label, country
    )
    SELECT s.fixture_id, s.match_date, s.home_team_id, s.away_team_id,
           s.ht_home, s.ht_away, s.ft_home, s.ft_away,
           COALESCE(s.status, 'CANONICAL'), s.competition_key, COALESCE(s.tier, 'minor'), s.competition_name,
           s.round, s.round_label, s.country
    FROM src s
    WHERE s.fixture_id NOT IN (SELECT fixture_id FROM clash)
    ON CONFLICT (fixture_id) DO UPDATE SET
      match_date = EXCLUDED.match_date,
      home_team_id = EXCLUDED.home_team_id,
      away_team_id = EXCLUDED.away_team_id,
      ht_home = COALESCE(EXCLUDED.ht_home, f.ht_home),
      ht_away = COALESCE(EXCLUDED.ht_away, f.ht_away),
      ft_home = EXCLUDED.ft_home,
      ft_away = EXCLUDED.ft_away,
      status = EXCLUDED.status,
      competition_key = EXCLUDED.competition_key,
      tier = EXCLUDED.tier,
      competition_name = EXCLUDED.competition_name,
      round = COALESCE(EXCLUDED.round, f.round),
      round_label = COALESCE(EXCLUDED.round_label, f.round_label),
      country = COALESCE(EXCLUDED.country, f.country),
      updated_at = now()
    WHERE (f.ht_home, f.ht_away, f.ft_home, f.ft_away, f.round, f.round_label, f.country)
          IS DISTINCT FROM
          (COALESCE(EXCLUDED.ht_home, f.ht_home), COALESCE(EXCLUDED.ht_away, f.ht_away), EXCLUDED.ft_home, EXCLUDED.ft_away,
           COALESCE(EXCLUDED.round, f.round), COALESCE(EXCLUDED.round_label, f.round_label), COALESCE(EXCLUDED.country, f.country))
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COALESCE(count(*) FILTER (WHERE inserted), 0),
         COALESCE(count(*) FILTER (WHERE NOT inserted), 0),
         (SELECT count(*) FROM clash),
         (SELECT count(*) FROM fill)
    INTO v_inserted, v_updated, v_other_id, v_clash_filled
  FROM up;

  RETURN jsonb_build_object(
    'status', 'OK',
    'received', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_total - v_inserted - v_updated,
    'skipped_other_fixture_id', v_other_id,
    'filled_on_clash', v_clash_filled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_upsert_livescore_fixtures(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_settle_suggest_picks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settled integer := 0;
  v_no_ht integer := 0;
  v_void integer := 0;
BEGIN
  WITH cand AS (
    SELECT l.fixture_id, l.top_market, f.ht_home AS fht_h, f.ht_away AS fht_a, f.ft_home AS fft_h, f.ft_away AS fft_a
    FROM public.suggest_pick_log l
    CROSS JOIN LATERAL (
      SELECT COALESCE(l.home_team_id, (SELECT t.team_id::text::uuid FROM public.teams t WHERE lower(t.canonical_name) = lower(l.home_team) LIMIT 1)) AS hid,
             COALESCE(l.away_team_id, (SELECT t.team_id::text::uuid FROM public.teams t WHERE lower(t.canonical_name) = lower(l.away_team) LIMIT 1)) AS aid
    ) ids
    JOIN LATERAL (
      SELECT fx.ht_home, fx.ht_away, fx.ft_home, fx.ft_away
      FROM public.fixtures fx
      WHERE fx.home_team_id = ids.hid
        AND fx.away_team_id = ids.aid
        AND fx.match_date BETWEEN l.target_date - 1 AND l.target_date + 1
        AND fx.status IN ('CANONICAL', 'COMPLETE')
        AND fx.ft_home IS NOT NULL AND fx.ft_away IS NOT NULL
      ORDER BY abs(fx.match_date - l.target_date)
      LIMIT 1
    ) f ON true
    WHERE l.settled_at IS NULL
      AND l.kickoff_at < now() - interval '3 hours'
      AND ids.hid IS NOT NULL AND ids.aid IS NOT NULL
  ),
  calc AS (
    SELECT c.*,
           (c.fht_h IS NOT NULL AND c.fht_a IS NOT NULL AND c.fft_h >= c.fht_h AND c.fft_a >= c.fht_a) AS ht_ok,
           m.period AS ou_period,
           m.line AS ou_line
    FROM cand c
    LEFT JOIN LATERAL (
      SELECT CASE WHEN c.top_market = 'over_2_5_ft' THEN 'ft' ELSE x.r[3] END AS period,
             CASE WHEN c.top_market = 'over_2_5_ft' THEN 2.5
                  WHEN x.r[2] = '' THEN x.r[1]::numeric
                  ELSE (x.r[1] || '.' || x.r[2])::numeric END AS line
      FROM (SELECT regexp_match(c.top_market, '^over_(\d)(\d*)_(ht|ft)$') AS r) x
      WHERE c.top_market = 'over_2_5_ft' OR x.r IS NOT NULL
    ) m ON true
  ),
  upd AS (
    UPDATE public.suggest_pick_log l SET
      settled_at = now(),
      void_reason = CASE WHEN c.ht_ok OR l.top_market !~ '_ht$' THEN NULL ELSE 'NO_HT' END,
      ht_home = CASE WHEN c.ht_ok THEN c.fht_h END,
      ht_away = CASE WHEN c.ht_ok THEN c.fht_a END,
      ft_home = c.fft_h,
      ft_away = c.fft_a,
      hit_o05_ht = CASE WHEN c.ht_ok THEN (c.fht_h + c.fht_a) >= 1 END,
      hit_o1_ht = CASE WHEN c.ht_ok THEN (c.fht_h + c.fht_a) >= 2 END,
      result_o075 = CASE WHEN NOT c.ht_ok THEN NULL
                         WHEN c.fht_h + c.fht_a >= 2 THEN 'WIN'
                         WHEN c.fht_h + c.fht_a = 1 THEN 'HALF_WIN'
                         ELSE 'LOSS' END,
      hit_top_market = CASE
        WHEN l.top_market = 'btts_yes' THEN c.fft_h >= 1 AND c.fft_a >= 1
        WHEN l.top_market = '1x2_ht_home' THEN CASE WHEN c.ht_ok THEN c.fht_h > c.fht_a END
        WHEN l.top_market = '1x2_ft_home' THEN c.fft_h > c.fft_a
        WHEN c.ou_period = 'ht' THEN CASE WHEN c.ht_ok THEN
          CASE public.ou_result(c.fht_h + c.fht_a, c.ou_line)
            WHEN 'WIN' THEN true WHEN 'HALF_WIN' THEN true
            WHEN 'LOSS' THEN false WHEN 'HALF_LOSS' THEN false
            ELSE NULL END
          END
        WHEN c.ou_period = 'ft' THEN
          CASE public.ou_result(c.fft_h + c.fft_a, c.ou_line)
            WHEN 'WIN' THEN true WHEN 'HALF_WIN' THEN true
            WHEN 'LOSS' THEN false WHEN 'HALF_LOSS' THEN false
            ELSE NULL END
        ELSE NULL END
    FROM calc c
    WHERE l.fixture_id = c.fixture_id
    RETURNING c.ht_ok
  )
  SELECT count(*), count(*) FILTER (WHERE NOT ht_ok) INTO v_settled, v_no_ht FROM upd;

  WITH v AS (
    UPDATE public.suggest_pick_log
    SET settled_at = now(), void_reason = 'NO_RESULT'
    WHERE settled_at IS NULL AND kickoff_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_void FROM v;

  RETURN jsonb_build_object('status', 'OK', 'settled', v_settled, 'settled_without_ht', v_no_ht, 'voided_no_result', v_void);
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_settle_suggest_picks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_settle_suggest_picks() TO service_role;

UPDATE public.suggest_pick_log
SET void_reason = NULL
WHERE void_reason = 'NO_HT' AND top_market !~ '_ht$' AND ft_home IS NOT NULL AND hit_top_market IS NOT NULL;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'cfi-parlay-settle' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-parlay-settle', '12,42 * * * *', $cron$SELECT public.cfi_parlay_settle()$cron$);
