CREATE TABLE IF NOT EXISTS public.goldme_top_teams (
  as_of date NOT NULL,
  rank integer NOT NULL,
  team_id uuid NOT NULL,
  team_name text NOT NULL,
  n integer NOT NULL,
  hits integer NOT NULL,
  rate numeric NOT NULL,
  att integer NOT NULL DEFAULT 0,
  def integer NOT NULL DEFAULT 0,
  PRIMARY KEY (as_of, rank)
);
CREATE INDEX IF NOT EXISTS goldme_top_teams_team_idx ON public.goldme_top_teams (team_id, as_of);
ALTER TABLE public.goldme_top_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goldme_top_teams FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.goldme_top_teams TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_top_build(p_day date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_n integer;
BEGIN
  IF NOT p_force AND EXISTS (SELECT 1 FROM public.goldme_top_teams WHERE as_of = v_day) THEN
    RETURN (SELECT count(*) FROM public.goldme_top_teams WHERE as_of = v_day)::integer;
  END IF;
  DELETE FROM public.goldme_top_teams WHERE as_of = v_day;
  WITH f AS (
    SELECT home_team_id AS tid, ht_home AS hh, ht_away AS ha, ft_home AS fh, ft_away AS fa
    FROM public.fixtures
    WHERE match_date >= v_day - 60 AND match_date < v_day
      AND ht_home IS NOT NULL AND ft_home IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    UNION ALL
    SELECT away_team_id, ht_away, ht_home, ft_away, ft_home
    FROM public.fixtures
    WHERE match_date >= v_day - 60 AND match_date < v_day
      AND ht_home IS NOT NULL AND ft_home IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
  ), g AS (
    SELECT tid,
           count(*)::integer AS n,
           (count(*) FILTER (WHERE hh + ha >= 3 OR hh >= 4 OR ha >= 4 OR fh >= 5 OR fa >= 5 OR fh + fa >= 7))::integer AS hits,
           (count(*) FILTER (WHERE fh >= 4))::integer AS att,
           (count(*) FILTER (WHERE fa >= 4))::integer AS def
    FROM f GROUP BY tid HAVING count(*) >= 5
  ), ranked AS (
    SELECT g.*, row_number() OVER (ORDER BY g.hits::numeric / g.n DESC, g.n DESC, g.tid) AS rk
    FROM g
    LEFT JOIN public.teams t ON t.team_id = g.tid
    WHERE COALESCE(t.canonical_name, '') !~* '\mU1[0-8]\M'
  )
  INSERT INTO public.goldme_top_teams (as_of, rank, team_id, team_name, n, hits, rate, att, def)
  SELECT v_day, r.rk::integer, r.tid,
         COALESCE(
           (SELECT l.home_team FROM public.suggest_pick_log l WHERE l.home_team_id = r.tid ORDER BY l.kickoff_at DESC LIMIT 1),
           (SELECT l.away_team FROM public.suggest_pick_log l WHERE l.away_team_id = r.tid ORDER BY l.kickoff_at DESC LIMIT 1),
           (SELECT t.canonical_name FROM public.teams t WHERE t.team_id = r.tid),
           r.tid::text),
         r.n, r.hits, round(r.hits::numeric / r.n, 4), r.att, r.def
  FROM ranked r
  WHERE r.rk <= 20;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_top_build(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_top_build(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_top_latest()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_as date;
BEGIN
  PERFORM public.cfi_goldme_top_build(NULL, false);
  SELECT max(as_of) INTO v_as FROM public.goldme_top_teams;
  RETURN jsonb_build_object(
    'as_of', v_as,
    'lookback_days', 60,
    'min_n', 5,
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rk', t.rank, 'id', t.team_id, 'name', t.team_name, 'n', t.n, 'hits', t.hits, 'rate', t.rate, 'att', t.att, 'def', t.def) ORDER BY t.rank)
      FROM public.goldme_top_teams t WHERE t.as_of = v_as), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_top_latest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_top_latest() TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_range(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH snap AS (
  SELECT DISTINCT ON ((m->>'fixture_id')::uuid) (m->>'fixture_id')::uuid AS fid, m
  FROM public.suggest_snapshot s
  CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
  CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
  WHERE s.snapshot_date BETWEEN p_from - 1 AND p_to + 1 AND m ? 'fixture_id'
    AND COALESCE(m->>'competition', '') !~* '\m(U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
  ORDER BY (m->>'fixture_id')::uuid, s.snapshot_date DESC
),
base AS (
  SELECT l.home_team_id, l.away_team_id, (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d, sn.m,
         (l.ht_home + l.ht_away >= 3) AS x3ht,
         (l.ht_home >= 4 OR l.ht_away >= 4) AS xoht,
         (l.ft_home >= 5 OR l.ft_away >= 5) AS xoft,
         (l.ft_home + l.ft_away >= 7) AS x7ft
  FROM public.suggest_pick_log l
  JOIN snap sn ON sn.fid = l.fixture_id
  WHERE l.settled_at IS NOT NULL AND l.void_reason IS NULL
    AND l.ht_home IS NOT NULL AND l.ft_home IS NOT NULL
    AND (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
),
types AS (
  SELECT * FROM (VALUES ('x3ht', '3+ HT'), ('xoht', 'Other HT'), ('xoft', 'Other FT'), ('x7ft', '7+ FT')) t(k, name)
),
summ AS (
  SELECT t.k, t.name,
    count(*) AS n,
    count(*) FILTER (WHERE (to_jsonb(b)->>t.k)::boolean) AS hits,
    avg((b.m->'probs'->>t.name)::numeric) AS p_all,
    count(*) FILTER (WHERE b.m->'hit_markets' ? t.name) AS flag_n,
    count(*) FILTER (WHERE b.m->'hit_markets' ? t.name AND (to_jsonb(b)->>t.k)::boolean) AS flag_hits
  FROM base b CROSS JOIN types t
  GROUP BY t.k, t.name
),
allg AS (
  SELECT count(*)::integer AS n, (count(*) FILTER (WHERE x3ht OR xoht OR xoft OR x7ft))::integer AS hits FROM base
),
star AS (
  SELECT count(*)::integer AS n, (count(*) FILTER (WHERE b.x3ht OR b.xoht OR b.xoft OR b.x7ft))::integer AS hits
  FROM base b
  WHERE EXISTS (SELECT 1 FROM public.goldme_top_teams t WHERE t.as_of = b.d AND t.team_id IN (b.home_team_id, b.away_team_id))
),
latest AS (
  SELECT max(as_of) AS as_of FROM public.goldme_top_teams WHERE as_of <= p_to
)
SELECT jsonb_build_object(
  'all', (SELECT to_jsonb(allg) FROM allg),
  'star', (SELECT to_jsonb(star) FROM star),
  'types', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type', k, 'n', n, 'hits', hits,
      'rate', CASE WHEN n > 0 THEN round(hits::numeric / n, 4) END,
      'p_all', round(p_all, 4), 'flag_n', flag_n, 'flag_hits', flag_hits) ORDER BY k) FROM summ), '[]'::jsonb),
  'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rk', t.rank, 'name', t.team_name, 'n', t.n, 'hits', t.hits, 'rate', t.rate) ORDER BY t.rank)
      FROM public.goldme_top_teams t WHERE t.as_of = (SELECT as_of FROM latest)), '[]'::jsonb),
  'top_as_of', (SELECT as_of FROM latest)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_range(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_range(date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_report_cached(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_ver constant integer := 4;
  v_store boolean;
  v_out jsonb;
BEGIN
  v_store := p_to < v_today - 1 AND p_from >= v_today - 178;
  IF v_store THEN
    SELECT c.payload INTO v_out FROM public.report_cache c
    WHERE c.d_from = p_from AND c.d_to = p_to AND c.min_n = p_min_n AND c.ver = v_ver;
    IF v_out IS NOT NULL THEN
      RETURN v_out;
    END IF;
  END IF;
  v_out := public.cfi_report(p_from, p_to, p_min_n)
    || jsonb_build_object(
      'hours', COALESCE(public.cfi_report_hours(p_from, p_to), '[]'::jsonb),
      'partial', p_from < v_today - 178,
      'best_choice', public.cfi_best_choice_report(p_from, p_to),
      'goldme', public.cfi_goldme_range(p_from, p_to)
    );
  IF v_store THEN
    INSERT INTO public.report_cache (d_from, d_to, min_n, ver, payload)
    VALUES (p_from, p_to, p_min_n, v_ver, v_out)
    ON CONFLICT (d_from, d_to, min_n) DO UPDATE
      SET ver = EXCLUDED.ver, payload = EXCLUDED.payload, built_at = now();
  END IF;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_report_cached(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_report_cached(date, date, integer) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'cfi-goldme-top-build' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-goldme-top-build', '3 17 * * *', $cron$SELECT public.cfi_goldme_top_build(NULL, true)$cron$);

DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT g::date FROM generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 21, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, interval '1 day') g LOOP
    PERFORM public.cfi_goldme_top_build(d, true);
  END LOOP;
END $$;
