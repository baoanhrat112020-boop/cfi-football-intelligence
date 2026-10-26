ALTER TABLE public.goldme_top_teams ADD COLUMN IF NOT EXISTS grp text NOT NULL DEFAULT 'main';
ALTER TABLE public.goldme_top_teams ADD COLUMN IF NOT EXISTS league_name text;
ALTER TABLE public.goldme_top_teams ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.goldme_top_teams ADD COLUMN IF NOT EXISTS league_rate numeric;
ALTER TABLE public.goldme_top_teams ADD COLUMN IF NOT EXISTS excess numeric;
ALTER TABLE public.goldme_top_teams DROP CONSTRAINT IF EXISTS goldme_top_teams_pkey;
ALTER TABLE public.goldme_top_teams ADD PRIMARY KEY (as_of, grp, rank);
DELETE FROM public.goldme_top_teams;

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
  WITH mm AS (
    SELECT f.match_date, f.home_team_id, f.away_team_id,
           COALESCE(f.competition_key, 'UNK') AS lk, f.competition_name AS ln, f.country,
           (f.ht_home + f.ht_away >= 3 OR f.ht_home >= 4 OR f.ht_away >= 4 OR f.ft_home >= 5 OR f.ft_away >= 5 OR f.ft_home + f.ft_away >= 7) AS gold
    FROM public.fixtures f
    WHERE f.match_date >= v_day - 60 AND f.match_date < v_day
      AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL AND f.home_team_id IS NOT NULL AND f.away_team_id IS NOT NULL
      AND COALESCE(f.competition_name, '') !~* '\m(U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
  ), gr AS (
    SELECT avg(gold::int)::numeric AS r FROM mm
  ), lr AS (
    SELECT lk, count(*) AS n, avg(gold::int)::numeric AS r FROM mm GROUP BY lk
  ), lrs AS (
    SELECT lr.lk, (lr.n * lr.r + 30 * gr.r) / (lr.n + 30) AS r FROM lr CROSS JOIN gr
  ), tm AS (
    SELECT home_team_id AS tid, match_date, lk, ln, country, gold FROM mm
    UNION ALL
    SELECT away_team_id, match_date, lk, ln, country, gold FROM mm
  ), t AS (
    SELECT tm.tid,
           count(*)::integer AS n,
           (count(*) FILTER (WHERE tm.gold))::integer AS hits,
           sum(lrs.r) AS exp,
           (array_agg(tm.lk ORDER BY tm.match_date DESC))[1] AS lk,
           (array_agg(tm.ln ORDER BY tm.match_date DESC))[1] AS ln,
           (array_agg(tm.country ORDER BY tm.match_date DESC))[1] AS country
    FROM tm JOIN lrs ON lrs.lk = tm.lk
    GROUP BY tm.tid
    HAVING count(*) >= 8
  ), tc AS (
    SELECT t.*,
           (COALESCE(t.country, 'England') = 'England'
            AND COALESCE(t.ln, '') ~* '(Isthmian|Southern League|Northern Premier|FA Trophy|FA Cup: Qualification|FA Vase|Combined Counties|Spartan|Wessex|United Counties|Eastern Counties|Hellenic|Western League|North West Counties|Northern Counties|Midland League|Essex Senior|Kent League|Sussex County|Northern League)') AS eng,
           (SELECT r FROM lrs WHERE lrs.lk = t.lk) AS lrate
    FROM t
    LEFT JOIN public.teams tt ON tt.team_id = t.tid
    WHERE COALESCE(tt.canonical_name, '') !~* '\mU1[0-8]\M'
  ), mainr AS (
    SELECT tc.*, (tc.hits - tc.exp) / (tc.n + 10) AS ex,
           row_number() OVER (PARTITION BY tc.lk ORDER BY (tc.hits - tc.exp) / (tc.n + 10) DESC, tc.n DESC, tc.tid) AS lrk
    FROM tc WHERE NOT tc.eng
  ), mainf AS (
    SELECT mainr.*, row_number() OVER (ORDER BY mainr.ex DESC, mainr.n DESC, mainr.tid) AS rk
    FROM mainr WHERE mainr.lrk <= 2
  ), engr AS (
    SELECT tc.*, (tc.hits - tc.exp) / (tc.n + 10) AS ex,
           row_number() OVER (ORDER BY tc.hits::numeric / tc.n DESC, tc.n DESC, tc.tid) AS rk
    FROM tc WHERE tc.eng
  ), pick AS (
    SELECT 'main'::text AS grp, rk, tid, n, hits, ex, lrate, ln, country FROM mainf WHERE rk <= 20
    UNION ALL
    SELECT 'eng'::text, rk, tid, n, hits, ex, lrate, ln, country FROM engr WHERE rk <= 30
  )
  INSERT INTO public.goldme_top_teams (as_of, grp, rank, team_id, team_name, n, hits, rate, att, def, league_name, country, league_rate, excess)
  SELECT v_day, p.grp, p.rk::integer, p.tid,
         COALESCE(
           (SELECT l.home_team FROM public.suggest_pick_log l WHERE l.home_team_id = p.tid ORDER BY l.kickoff_at DESC LIMIT 1),
           (SELECT l.away_team FROM public.suggest_pick_log l WHERE l.away_team_id = p.tid ORDER BY l.kickoff_at DESC LIMIT 1),
           (SELECT x.canonical_name FROM public.teams x WHERE x.team_id = p.tid),
           p.tid::text),
         p.n, p.hits, round(p.hits::numeric / p.n, 4),
         (SELECT count(*) FROM public.fixtures f WHERE f.home_team_id = p.tid AND f.match_date >= v_day - 60 AND f.match_date < v_day AND f.ft_home >= 4)::integer
           + (SELECT count(*) FROM public.fixtures f WHERE f.away_team_id = p.tid AND f.match_date >= v_day - 60 AND f.match_date < v_day AND f.ft_away >= 4)::integer,
         (SELECT count(*) FROM public.fixtures f WHERE f.home_team_id = p.tid AND f.match_date >= v_day - 60 AND f.match_date < v_day AND f.ft_away >= 4)::integer
           + (SELECT count(*) FROM public.fixtures f WHERE f.away_team_id = p.tid AND f.match_date >= v_day - 60 AND f.match_date < v_day AND f.ft_home >= 4)::integer,
         p.ln, p.country, round(p.lrate, 4), round(p.ex, 4)
  FROM pick p;
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
    'min_n', 8,
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rk', t.rank, 'id', t.team_id, 'name', t.team_name, 'n', t.n, 'hits', t.hits, 'rate', t.rate, 'att', t.att, 'def', t.def, 'league', t.league_name, 'country', t.country, 'lrate', t.league_rate, 'excess', t.excess) ORDER BY t.rank)
      FROM public.goldme_top_teams t WHERE t.as_of = v_as AND t.grp = 'main'), '[]'::jsonb),
    'eng', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rk', t.rank, 'id', t.team_id, 'name', t.team_name, 'n', t.n, 'hits', t.hits, 'rate', t.rate, 'att', t.att, 'def', t.def, 'league', t.league_name, 'country', t.country, 'lrate', t.league_rate, 'excess', t.excess) ORDER BY t.rank)
      FROM public.goldme_top_teams t WHERE t.as_of = v_as AND t.grp = 'eng'), '[]'::jsonb));
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
  WHERE EXISTS (SELECT 1 FROM public.goldme_top_teams t WHERE t.as_of = b.d AND t.grp = 'main' AND t.team_id IN (b.home_team_id, b.away_team_id))
),
stare AS (
  SELECT count(*)::integer AS n, (count(*) FILTER (WHERE b.x3ht OR b.xoht OR b.xoft OR b.x7ft))::integer AS hits
  FROM base b
  WHERE EXISTS (SELECT 1 FROM public.goldme_top_teams t WHERE t.as_of = b.d AND t.grp = 'eng' AND t.team_id IN (b.home_team_id, b.away_team_id))
),
latest AS (
  SELECT max(as_of) AS as_of FROM public.goldme_top_teams WHERE as_of <= p_to
)
SELECT jsonb_build_object(
  'all', (SELECT to_jsonb(allg) FROM allg),
  'star', (SELECT to_jsonb(star) FROM star),
  'star_eng', (SELECT to_jsonb(stare) FROM stare),
  'types', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type', k, 'n', n, 'hits', hits,
      'rate', CASE WHEN n > 0 THEN round(hits::numeric / n, 4) END,
      'p_all', round(p_all, 4), 'flag_n', flag_n, 'flag_hits', flag_hits) ORDER BY k) FROM summ), '[]'::jsonb),
  'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rk', t.rank, 'name', t.team_name, 'n', t.n, 'hits', t.hits, 'rate', t.rate, 'league', t.league_name) ORDER BY t.rank)
      FROM public.goldme_top_teams t WHERE t.as_of = (SELECT as_of FROM latest) AND t.grp = 'main'), '[]'::jsonb),
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
  v_ver constant integer := 5;
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
DECLARE d date;
BEGIN
  FOR d IN SELECT g::date FROM generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 21, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, interval '1 day') g LOOP
    PERFORM public.cfi_goldme_top_build(d, true);
  END LOOP;
END $$;
