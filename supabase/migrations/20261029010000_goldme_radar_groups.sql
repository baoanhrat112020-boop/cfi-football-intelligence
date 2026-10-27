ALTER TABLE public.goldme_radar ADD COLUMN IF NOT EXISTS grp text NOT NULL DEFAULT 'main';

CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_build(p_day date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_model jsonb;
  v_n integer;
BEGIN
  IF NOT p_force AND EXISTS (SELECT 1 FROM public.goldme_radar WHERE day = v_day) THEN
    RETURN (SELECT count(*) FROM public.goldme_radar WHERE day = v_day)::integer;
  END IF;
  SELECT model INTO v_model FROM public.goldme_radar_model ORDER BY id DESC LIMIT 1;
  IF v_model IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suggest_snapshot WHERE snapshot_date = v_day) THEN
    RETURN 0;
  END IF;
  DELETE FROM public.goldme_radar WHERE day = v_day;
  WITH cand AS (
    SELECT DISTINCT ON ((m->>'fixture_id')::uuid)
           (m->>'fixture_id')::uuid AS fid, m->>'provider_id' AS pid, m->>'home' AS home, m->>'away' AS away, m->>'competition' AS comp,
           CASE WHEN COALESCE(m->>'competition', '') ~* '^England .*(Isthmian|Southern League|Northern Premier|FA Trophy|FA Cup: Qualification|FA Vase|Combined Counties|Spartan|Wessex|United Counties|Eastern Counties|Hellenic|Western League|North West Counties|Northern Counties|Midland League|Essex Senior|Kent League|Sussex County|Northern League)' THEN 'eng' ELSE 'main' END AS grp,
           v.canonical_home_team_id AS hid, v.canonical_away_team_id AS aid,
           COALESCE((m->>'kickoff')::timestamptz, v.kickoff_at) AS ko
    FROM public.suggest_snapshot s
    CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
    CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
    JOIN public.cfi_living_verified_fixtures v ON v.fixture_id = (m->>'fixture_id')::uuid
    WHERE s.snapshot_date = v_day AND m ? 'fixture_id'
      AND v.canonical_home_team_id IS NOT NULL AND v.canonical_away_team_id IS NOT NULL
      AND COALESCE(m->>'competition', '') !~* '\m(U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
    ORDER BY (m->>'fixture_id')::uuid
  ), fx AS (
    SELECT f.match_date, f.fixture_id, f.home_team_id, f.away_team_id, COALESCE(f.competition_key, 'UNK') AS lk, f.ft_home, f.ft_away,
           (f.ht_home + f.ht_away >= 3 OR f.ht_home >= 4 OR f.ht_away >= 4 OR f.ft_home >= 5 OR f.ft_away >= 5 OR f.ft_home + f.ft_away >= 7) AS gold
    FROM public.fixtures f
    WHERE f.match_date >= v_day - 120 AND f.match_date < v_day
      AND f.ht_home IS NOT NULL AND f.ft_home IS NOT NULL AND f.home_team_id IS NOT NULL AND f.away_team_id IS NOT NULL
      AND COALESCE(f.competition_name, '') !~* '\m(U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
  ), g60 AS (
    SELECT avg(gold::int)::numeric AS r FROM fx WHERE match_date >= v_day - 60
  ), l60 AS (
    SELECT lk, count(*) AS n, avg(gold::int)::numeric AS r FROM fx WHERE match_date >= v_day - 60 GROUP BY lk
  ), lrs AS (
    SELECT l60.lk, (l60.n * l60.r + 30 * g60.r) / (l60.n + 30) AS r FROM l60 CROSS JOIN g60
  ), tm AS (
    SELECT home_team_id AS tid, match_date, fixture_id, ft_home AS gf, ft_away AS ga, gold, lk FROM fx
    UNION ALL
    SELECT away_team_id, match_date, fixture_id, ft_away, ft_home, gold, lk FROM fx
  ), tr AS (
    SELECT tm.*, row_number() OVER (PARTITION BY tm.tid ORDER BY tm.match_date DESC, tm.fixture_id) AS rn
    FROM tm WHERE tm.tid IN (SELECT hid FROM cand UNION SELECT aid FROM cand)
  ), tf AS (
    SELECT tid, count(*) AS n, avg(gf) AS gf, avg(ga) AS ga, avg(gold::int) AS gr, mode() WITHIN GROUP (ORDER BY lk) AS lk
    FROM tr WHERE rn <= 10 GROUP BY tid HAVING count(*) >= 4
  ), sc AS (
    SELECT c.*, h.gf AS hgf, h.ga AS hga, h.gr AS hgr, a.gf AS agf, a.ga AS aga, a.gr AS agr,
           (COALESCE((SELECT r FROM lrs WHERE lrs.lk = h.lk), (SELECT r FROM g60)) + COALESCE((SELECT r FROM lrs WHERE lrs.lk = a.lk), (SELECT r FROM g60))) / 2 AS lrate
    FROM cand c JOIN tf h ON h.tid = c.hid JOIN tf a ON a.tid = c.aid
  ), fe AS (
    SELECT sc.*, (hgf + aga) / 2 + (agf + hga) / 2 AS exp_total, abs((hgf - hga) - (agf - aga)) AS gap, (hgr + agr) / 2 AS gold_pair FROM sc
  ), pr AS (
    SELECT fe.*,
           1 / (1 + exp(-((v_model->>'intercept')::double precision
             + (v_model#>>'{coef,lrate}')::double precision * ((fe.lrate)::double precision - (v_model#>>'{mean,lrate}')::double precision) / (v_model#>>'{std,lrate}')::double precision
             + (v_model#>>'{coef,hgf}')::double precision * ((fe.hgf)::double precision - (v_model#>>'{mean,hgf}')::double precision) / (v_model#>>'{std,hgf}')::double precision
             + (v_model#>>'{coef,hga}')::double precision * ((fe.hga)::double precision - (v_model#>>'{mean,hga}')::double precision) / (v_model#>>'{std,hga}')::double precision
             + (v_model#>>'{coef,agf}')::double precision * ((fe.agf)::double precision - (v_model#>>'{mean,agf}')::double precision) / (v_model#>>'{std,agf}')::double precision
             + (v_model#>>'{coef,aga}')::double precision * ((fe.aga)::double precision - (v_model#>>'{mean,aga}')::double precision) / (v_model#>>'{std,aga}')::double precision
             + (v_model#>>'{coef,exp_total}')::double precision * ((fe.exp_total)::double precision - (v_model#>>'{mean,exp_total}')::double precision) / (v_model#>>'{std,exp_total}')::double precision
             + (v_model#>>'{coef,gap}')::double precision * ((fe.gap)::double precision - (v_model#>>'{mean,gap}')::double precision) / (v_model#>>'{std,gap}')::double precision
             + (v_model#>>'{coef,gold_pair}')::double precision * ((fe.gold_pair)::double precision - (v_model#>>'{mean,gold_pair}')::double precision) / (v_model#>>'{std,gold_pair}')::double precision
           ))) AS p
    FROM fe
  ), ranked AS (
    SELECT pr.*, row_number() OVER (ORDER BY pr.p DESC, pr.fid) AS rk, row_number() OVER (PARTITION BY pr.grp ORDER BY pr.p DESC, pr.fid) AS grk, count(*) OVER (PARTITION BY pr.grp) AS gtot FROM pr
  )
  INSERT INTO public.goldme_radar (day, fixture_id, provider_id, home_team, away_team, home_team_id, away_team_id, kickoff_at, competition, grp, p, rank, flagged, feats)
  SELECT v_day, r.fid, r.pid, r.home, r.away, r.hid, r.aid, r.ko, r.comp, r.grp, round(r.p::numeric, 4), r.rk::integer,
         CASE WHEN r.grp = 'eng' THEN r.grk <= LEAST(10, GREATEST(3, ceil(0.2 * r.gtot)::integer))
              ELSE r.grk <= LEAST(25, GREATEST(5, ceil(0.07 * r.gtot)::integer)) END,
         jsonb_build_object('lrate', round(r.lrate, 3), 'exp_total', round(r.exp_total, 2), 'hgf', round(r.hgf, 2), 'hga', round(r.hga, 2),
                            'agf', round(r.agf, 2), 'aga', round(r.aga, 2), 'gap', round(r.gap, 2), 'gold_pair', round(r.gold_pair, 3))
  FROM ranked r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_build(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_build(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_latest(p_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_model jsonb;
BEGIN
  PERFORM public.cfi_goldme_radar_build(v_day, false);
  SELECT model INTO v_model FROM public.goldme_radar_model ORDER BY id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'day', v_day,
    'base', v_model->'base_rate',
    'test', v_model->'test',
    'n', (SELECT count(*) FROM public.goldme_radar WHERE day = v_day),
    'n_main', (SELECT count(*) FROM public.goldme_radar WHERE day = v_day AND grp = 'main'),
    'n_eng', (SELECT count(*) FROM public.goldme_radar WHERE day = v_day AND grp = 'eng'),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fid', r.fixture_id, 'pid', r.provider_id, 'home', r.home_team, 'away', r.away_team, 't', r.kickoff_at, 'c', r.competition, 'p', r.p, 'rk', r.rank, 'f', r.feats) ORDER BY r.p DESC)
      FROM public.goldme_radar r WHERE r.day = v_day AND r.flagged AND r.grp = 'main'), '[]'::jsonb),
    'eng_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fid', r.fixture_id, 'pid', r.provider_id, 'home', r.home_team, 'away', r.away_team, 't', r.kickoff_at, 'c', r.competition, 'p', r.p, 'rk', r.rank, 'f', r.feats) ORDER BY r.p DESC)
      FROM public.goldme_radar r WHERE r.day = v_day AND r.flagged AND r.grp = 'eng'), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_latest(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_latest(date) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH s AS (
  SELECT * FROM public.goldme_radar WHERE day BETWEEN p_from AND p_to AND settled_at IS NOT NULL AND gold IS NOT NULL
), b AS (
  SELECT CASE WHEN p < 0.15 THEN 0 WHEN p < 0.25 THEN 1 WHEN p < 0.40 THEN 2 ELSE 3 END AS k,
         count(*) AS n, count(*) FILTER (WHERE gold) AS hits, avg(p) AS avg_p
  FROM s WHERE grp = 'main' GROUP BY 1
)
SELECT jsonb_build_object(
  'all', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s WHERE grp = 'main'),
  'flagged', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s WHERE flagged AND grp = 'main'),
  'all_eng', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s WHERE grp = 'eng'),
  'flagged_eng', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s WHERE flagged AND grp = 'eng'),
  'buckets', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n, 'hits', hits, 'avg_p', round(avg_p, 4)) ORDER BY k) FROM b), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_report(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_report(date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_report_cached(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_ver constant integer := 7;
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
      'goldme', public.cfi_goldme_range(p_from, p_to),
      'radar', public.cfi_goldme_radar_report(p_from, p_to)
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

SELECT public.cfi_goldme_radar_build(NULL, true);
