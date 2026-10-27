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
  DELETE FROM public.goldme_top_leagues WHERE as_of = v_day;
  INSERT INTO public.goldme_top_leagues (as_of, rank, league_key, league_name, country, n, hits, rate, eng)
  SELECT v_day, x.rk::integer, x.lk, x.ln, x.country, x.n, x.hits, round(x.hits::numeric / x.n, 4), x.eng
  FROM (
    SELECT l.*, row_number() OVER (ORDER BY l.hits::numeric / l.n DESC, l.n DESC, l.lk) AS rk
    FROM (
      SELECT COALESCE(f.competition_key, 'UNK') AS lk, max(f.competition_name) AS ln, max(f.country) AS country,
             count(*)::integer AS n,
             (count(*) FILTER (WHERE f.ht_home + f.ht_away >= 3 OR f.ht_home >= 4 OR f.ht_away >= 4 OR f.ft_home >= 5 OR f.ft_away >= 5 OR f.ft_home + f.ft_away >= 7))::integer AS hits,
             (COALESCE(max(f.country), 'England') = 'England'
              AND COALESCE(max(f.competition_name), '') ~* '(Isthmian|Southern League|Northern Premier|FA Trophy|FA Cup: Qualification|FA Vase|Combined Counties|Spartan|Wessex|United Counties|Eastern Counties|Hellenic|Western League|North West Counties|Northern Counties|Midland League|Essex Senior|Kent League|Sussex County|Northern League)') AS eng
      FROM public.fixtures f
      WHERE f.match_date >= v_day - 60 AND f.match_date < v_day
        AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL AND f.competition_key IS NOT NULL
        AND COALESCE(f.competition_name, '') !~* '\m(U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
      GROUP BY COALESCE(f.competition_key, 'UNK')
      HAVING count(*) >= 80
    ) l
  ) x
  WHERE x.rk <= 20;
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
  ), lgm AS (
    SELECT lk, max(ln) AS ln, max(country) AS country FROM mm GROUP BY lk
  ), t0 AS (
    SELECT tm.tid,
           count(*)::integer AS n,
           (count(*) FILTER (WHERE tm.gold))::integer AS hits,
           sum(lrs.r) AS exp,
           mode() WITHIN GROUP (ORDER BY tm.lk) AS lk
    FROM tm JOIN lrs ON lrs.lk = tm.lk
    GROUP BY tm.tid
    HAVING count(*) >= 8
  ), t AS (
    SELECT t0.*, lgm.ln, lgm.country FROM t0 JOIN lgm ON lgm.lk = t0.lk
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

DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT g::date FROM generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 21, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, interval '1 day') g LOOP
    PERFORM public.cfi_goldme_top_build(d, true);
  END LOOP;
END $$;
