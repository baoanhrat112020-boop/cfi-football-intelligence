CREATE TABLE public.suggest_pick_log_daily (
  kickoff_date      date    NOT NULL,
  confidence_tier   text    NOT NULL,
  official          boolean NOT NULL,
  n_picks           integer NOT NULL,
  n_scored          integer NOT NULL,
  n_void            integer NOT NULL,
  sum_p_over05_ht   double precision NOT NULL DEFAULT 0,
  sum_p_over075_ht  double precision NOT NULL DEFAULT 0,
  sum_p_over1_ht    double precision NOT NULL DEFAULT 0,
  n_hit_o05_ht      integer NOT NULL DEFAULT 0,
  n_hit_o1_ht       integer NOT NULL DEFAULT 0,
  n_o075_win        integer NOT NULL DEFAULT 0,
  n_o075_half_win   integer NOT NULL DEFAULT 0,
  n_o075_loss       integer NOT NULL DEFAULT 0,
  n_top_market      integer NOT NULL DEFAULT 0,
  n_hit_top_market  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kickoff_date, confidence_tier, official)
);
ALTER TABLE public.suggest_pick_log_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suggest_pick_log_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.suggest_pick_log_daily TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_suggest_pick_log_retention(p_days integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_aggregated integer := 0;
  v_deleted integer := 0;
BEGIN
  WITH old AS (
    SELECT * FROM public.suggest_pick_log
    WHERE kickoff_at < now() - make_interval(days => p_days) AND settled_at IS NOT NULL
  ),
  agg AS (
    INSERT INTO public.suggest_pick_log_daily AS d (
      kickoff_date, confidence_tier, official, n_picks, n_scored, n_void,
      sum_p_over05_ht, sum_p_over075_ht, sum_p_over1_ht,
      n_hit_o05_ht, n_hit_o1_ht, n_o075_win, n_o075_half_win, n_o075_loss, n_top_market, n_hit_top_market
    )
    SELECT (kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, confidence_tier, official,
           count(*),
           count(*) FILTER (WHERE void_reason IS NULL),
           count(*) FILTER (WHERE void_reason IS NOT NULL),
           COALESCE(sum(p_over05_ht) FILTER (WHERE void_reason IS NULL), 0),
           COALESCE(sum(p_over075_ht) FILTER (WHERE void_reason IS NULL), 0),
           COALESCE(sum(p_over1_ht) FILTER (WHERE void_reason IS NULL), 0),
           count(*) FILTER (WHERE hit_o05_ht),
           count(*) FILTER (WHERE hit_o1_ht),
           count(*) FILTER (WHERE result_o075 = 'WIN'),
           count(*) FILTER (WHERE result_o075 = 'HALF_WIN'),
           count(*) FILTER (WHERE result_o075 = 'LOSS'),
           count(*) FILTER (WHERE hit_top_market IS NOT NULL),
           count(*) FILTER (WHERE hit_top_market)
    FROM old
    GROUP BY 1, 2, 3
    ON CONFLICT (kickoff_date, confidence_tier, official) DO UPDATE SET
      n_picks = d.n_picks + EXCLUDED.n_picks,
      n_scored = d.n_scored + EXCLUDED.n_scored,
      n_void = d.n_void + EXCLUDED.n_void,
      sum_p_over05_ht = d.sum_p_over05_ht + EXCLUDED.sum_p_over05_ht,
      sum_p_over075_ht = d.sum_p_over075_ht + EXCLUDED.sum_p_over075_ht,
      sum_p_over1_ht = d.sum_p_over1_ht + EXCLUDED.sum_p_over1_ht,
      n_hit_o05_ht = d.n_hit_o05_ht + EXCLUDED.n_hit_o05_ht,
      n_hit_o1_ht = d.n_hit_o1_ht + EXCLUDED.n_hit_o1_ht,
      n_o075_win = d.n_o075_win + EXCLUDED.n_o075_win,
      n_o075_half_win = d.n_o075_half_win + EXCLUDED.n_o075_half_win,
      n_o075_loss = d.n_o075_loss + EXCLUDED.n_o075_loss,
      n_top_market = d.n_top_market + EXCLUDED.n_top_market,
      n_hit_top_market = d.n_hit_top_market + EXCLUDED.n_hit_top_market
    RETURNING 1
  ),
  del AS (
    DELETE FROM public.suggest_pick_log WHERE fixture_id IN (SELECT fixture_id FROM old) RETURNING 1
  )
  SELECT (SELECT count(*) FROM agg), (SELECT count(*) FROM del) INTO v_aggregated, v_deleted;

  RETURN jsonb_build_object('status', 'OK', 'retention_days', p_days, 'daily_groups_written', v_aggregated, 'rows_deleted', v_deleted);
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_suggest_pick_log_retention(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_suggest_pick_log_retention(integer) TO service_role;

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'suggest-snapshot-refresh'),
  command := $cmd$
    WITH r AS (SELECT cfi_suggest_upcoming(2880) AS payload)
    INSERT INTO suggest_snapshot(snapshot_date, payload, match_count, generated_at)
    SELECT
      (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      payload,
      COALESCE((payload->>'match_count')::int, 0),
      now()
    FROM r
    ON CONFLICT (snapshot_date) DO UPDATE SET
      payload = EXCLUDED.payload,
      match_count = EXCLUDED.match_count,
      generated_at = now();
    DO $do$ BEGIN PERFORM public.cfi_log_suggest_picks(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'cfi_log_suggest_picks failed: %', SQLERRM; END $do$;
  $cmd$
);

SELECT cron.schedule('suggest-pick-settle', '7,37 * * * *', $$SELECT public.cfi_settle_suggest_picks()$$);
SELECT cron.schedule('suggest-pick-log-retention', '40 3 * * *', $$SELECT public.cfi_suggest_pick_log_retention(180)$$);
