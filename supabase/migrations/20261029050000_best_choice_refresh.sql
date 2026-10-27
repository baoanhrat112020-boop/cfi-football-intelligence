CREATE OR REPLACE FUNCTION public.cfi_best_choice_refresh(p_day date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_cnt integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp.bc_keep;
  DROP TABLE IF EXISTS pg_temp.bc_keep_ht;
  CREATE TEMP TABLE bc_keep ON COMMIT DROP AS
    SELECT * FROM public.best_choice_daily WHERE day = v_day AND kickoff_at <= now();
  CREATE TEMP TABLE bc_keep_ht ON COMMIT DROP AS
    SELECT * FROM public.best_choice_ht WHERE day = v_day AND kickoff_at <= now();
  PERFORM public.cfi_best_choice_build(v_day, true);
  DELETE FROM public.best_choice_daily WHERE day = v_day AND fixture_id IN (SELECT fixture_id FROM bc_keep);
  INSERT INTO public.best_choice_daily SELECT * FROM bc_keep;
  UPDATE public.best_choice_daily b SET rank = r.rk
  FROM (
    SELECT fixture_id, row_number() OVER (ORDER BY p_win DESC, kickoff_at) AS rk
    FROM public.best_choice_daily WHERE day = v_day
  ) r
  WHERE b.day = v_day AND b.fixture_id = r.fixture_id;
  PERFORM public.cfi_best_choice_ht_build(v_day, true);
  DELETE FROM public.best_choice_ht WHERE day = v_day AND fixture_id IN (SELECT fixture_id FROM bc_keep_ht);
  INSERT INTO public.best_choice_ht SELECT * FROM bc_keep_ht;
  UPDATE public.best_choice_ht b SET rank = r.rk
  FROM (
    SELECT fixture_id, row_number() OVER (ORDER BY p_win DESC, kickoff_at) AS rk
    FROM public.best_choice_ht WHERE day = v_day
  ) r
  WHERE b.day = v_day AND b.fixture_id = r.fixture_id;
  SELECT count(*) INTO v_cnt FROM public.best_choice_daily WHERE day = v_day;
  RETURN v_cnt;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_refresh(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_refresh(date) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('cfi-best-choice-refresh-1', 'cfi-best-choice-refresh-2', 'cfi-best-choice-refresh-3') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-best-choice-refresh-1', '50 1 * * *', $cron$SELECT public.cfi_best_choice_refresh()$cron$);
SELECT cron.schedule('cfi-best-choice-refresh-2', '50 7 * * *', $cron$SELECT public.cfi_best_choice_refresh()$cron$);
SELECT cron.schedule('cfi-best-choice-refresh-3', '50 11 * * *', $cron$SELECT public.cfi_best_choice_refresh()$cron$);
