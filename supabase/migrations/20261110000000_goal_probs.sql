CREATE TABLE IF NOT EXISTS public.goal_probs (
  fixture_id uuid PRIMARY KEY,
  kickoff_at timestamptz NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  nk text NOT NULL,
  h1_home numeric(5,4) NOT NULL,
  h1_away numeric(5,4) NOT NULL,
  ft_home numeric(5,4) NOT NULL,
  ft_away numeric(5,4) NOT NULL,
  conf text NOT NULL DEFAULT 'low',
  home_id text,
  away_id text,
  g_h1_home integer,
  g_h1_away integer,
  g_ft_home integer,
  g_ft_away integer,
  settled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goal_probs_kickoff_idx ON public.goal_probs (kickoff_at);
CREATE INDEX IF NOT EXISTS goal_probs_nk_idx ON public.goal_probs (nk);

ALTER TABLE public.goal_probs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goal_probs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.goal_probs TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goal_probs_upsert(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) = 'array' AND jsonb_array_length(p_rows) > 0 THEN
    WITH ins AS (
      INSERT INTO public.goal_probs (fixture_id, kickoff_at, home_team, away_team, nk, h1_home, h1_away, ft_home, ft_away, conf, home_id, away_id, updated_at)
      SELECT r.fixture_id, r.kickoff_at, r.home_team, r.away_team, r.nk, r.h1_home, r.h1_away, r.ft_home, r.ft_away, COALESCE(r.conf, 'low'), r.home_id, r.away_id, now()
      FROM jsonb_to_recordset(p_rows) AS r(fixture_id uuid, kickoff_at timestamptz, home_team text, away_team text, nk text, h1_home numeric, h1_away numeric, ft_home numeric, ft_away numeric, conf text, home_id text, away_id text)
      WHERE r.fixture_id IS NOT NULL AND r.kickoff_at IS NOT NULL AND r.nk IS NOT NULL
        AND r.h1_home BETWEEN 0 AND 1 AND r.h1_away BETWEEN 0 AND 1 AND r.ft_home BETWEEN 0 AND 1 AND r.ft_away BETWEEN 0 AND 1
      ON CONFLICT (fixture_id) DO UPDATE SET
        kickoff_at = EXCLUDED.kickoff_at, home_team = EXCLUDED.home_team, away_team = EXCLUDED.away_team, nk = EXCLUDED.nk,
        h1_home = EXCLUDED.h1_home, h1_away = EXCLUDED.h1_away, ft_home = EXCLUDED.ft_home, ft_away = EXCLUDED.ft_away,
        conf = EXCLUDED.conf, home_id = EXCLUDED.home_id, away_id = EXCLUDED.away_id, updated_at = now()
      WHERE public.goal_probs.kickoff_at > now()
      RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
  END IF;
  DELETE FROM public.goal_probs WHERE kickoff_at < now() - interval '120 days';
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goal_probs_upsert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goal_probs_upsert(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goal_probs_range(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'f', g.fixture_id, 'k', g.nk,
    'h', jsonb_build_array(g.h1_home, g.h1_away),
    't', jsonb_build_array(g.ft_home, g.ft_away),
    'c', g.conf)), '[]'::jsonb)
  FROM public.goal_probs g
  WHERE g.kickoff_at >= p_from AND g.kickoff_at < p_to
$function$;

REVOKE ALL ON FUNCTION public.cfi_goal_probs_range(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goal_probs_range(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goal_probs_settle()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH cand AS (
    SELECT g.fixture_id, f.ht_home, f.ht_away, f.ft_home, f.ft_away
    FROM public.goal_probs g
    JOIN LATERAL (
      SELECT fx.ht_home, fx.ht_away, fx.ft_home, fx.ft_away
      FROM public.fixtures fx
      WHERE fx.home_team_id::text = g.home_id AND fx.away_team_id::text = g.away_id
        AND fx.match_date BETWEEN ((g.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1) AND ((g.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1)
        AND fx.status IN ('CANONICAL', 'COMPLETE')
        AND fx.ft_home IS NOT NULL AND fx.ft_away IS NOT NULL
      ORDER BY abs(fx.match_date - (g.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
      LIMIT 1
    ) f ON true
    WHERE g.settled_at IS NULL AND g.kickoff_at < now() - interval '3 hours' AND g.home_id IS NOT NULL AND g.away_id IS NOT NULL
  ), upd AS (
    UPDATE public.goal_probs g SET
      g_ft_home = c.ft_home, g_ft_away = c.ft_away,
      g_h1_home = CASE WHEN c.ht_home IS NOT NULL AND c.ht_away IS NOT NULL AND c.ft_home >= c.ht_home AND c.ft_away >= c.ht_away THEN c.ht_home END,
      g_h1_away = CASE WHEN c.ht_home IS NOT NULL AND c.ht_away IS NOT NULL AND c.ft_home >= c.ht_home AND c.ft_away >= c.ht_away THEN c.ht_away END,
      settled_at = now()
    FROM cand c
    WHERE g.fixture_id = c.fixture_id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goal_probs_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goal_probs_settle() TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'cfi-goal-probs-settle' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-goal-probs-settle', '27,57 * * * *', $cron$SELECT public.cfi_goal_probs_settle()$cron$);
