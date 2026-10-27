CREATE TABLE IF NOT EXISTS public.goldme_radar_model (
  id bigserial PRIMARY KEY,
  trained_at timestamptz NOT NULL DEFAULT now(),
  model jsonb NOT NULL
);
ALTER TABLE public.goldme_radar_model ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goldme_radar_model FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.goldme_radar_model TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.goldme_radar_model_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.goldme_radar (
  day date NOT NULL,
  fixture_id uuid NOT NULL,
  provider_id text,
  home_team text,
  away_team text,
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  kickoff_at timestamptz,
  competition text,
  p numeric NOT NULL,
  rank integer NOT NULL,
  flagged boolean NOT NULL DEFAULT false,
  feats jsonb,
  gold boolean,
  ht_home smallint,
  ht_away smallint,
  ft_home smallint,
  ft_away smallint,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, fixture_id)
);
CREATE INDEX IF NOT EXISTS goldme_radar_unsettled_idx ON public.goldme_radar (day) WHERE settled_at IS NULL;
ALTER TABLE public.goldme_radar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goldme_radar FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.goldme_radar TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_set_model(p jsonb)
RETURNS bigint
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.goldme_radar_model (model) VALUES (p) RETURNING id;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_set_model(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_set_model(jsonb) TO service_role;

INSERT INTO public.goldme_radar_model (model) VALUES ('{"features": ["lrate", "hgf", "hga", "agf", "aga", "exp_total", "gap", "gold_pair"], "mean": {"lrate": 0.183286, "hgf": 1.472981, "hga": 1.447874, "agf": 1.484343, "aga": 1.428303, "exp_total": 2.916751, "gap": 0.960062, "gold_pair": 0.177449}, "std": {"lrate": 0.071218, "hgf": 0.637398, "hga": 0.621095, "agf": 0.636981, "aga": 0.616541, "exp_total": 0.714576, "gap": 0.81541, "gold_pair": 0.13521}, "coef": {"lrate": 0.299517, "hgf": 0.104258, "hga": 0.022602, "agf": -0.000426, "aga": 0.062135, "exp_total": 0.082937, "gap": 0.097775, "gold_pair": 0.117678}, "intercept": -1.588244, "n_train": 36364, "base_rate": 0.1837, "league_days": 60, "form_days": 120, "form_n": 10, "min_form": 4, "test": {"auc": 0.6714, "logloss": 0.4719, "base_logloss": 0.5075, "prec_top5": 0.545, "prec_top10": 0.478, "prec_top20": 0.384}}'::jsonb);

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
    SELECT pr.*, row_number() OVER (ORDER BY pr.p DESC, pr.fid) AS rk, count(*) OVER () AS tot FROM pr
  )
  INSERT INTO public.goldme_radar (day, fixture_id, provider_id, home_team, away_team, home_team_id, away_team_id, kickoff_at, competition, p, rank, flagged, feats)
  SELECT v_day, r.fid, r.pid, r.home, r.away, r.hid, r.aid, r.ko, r.comp, round(r.p::numeric, 4), r.rk::integer,
         r.rk <= LEAST(30, GREATEST(5, ceil(0.07 * r.tot)::integer)),
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
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fid', r.fixture_id, 'pid', r.provider_id, 'home', r.home_team, 'away', r.away_team, 't', r.kickoff_at, 'c', r.competition, 'p', r.p, 'rk', r.rank, 'f', r.feats) ORDER BY r.rank)
      FROM public.goldme_radar r WHERE r.day = v_day AND r.flagged), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_latest(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_latest(date) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_settle()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH u AS (
    SELECT r.day, r.fixture_id, f.ht_home, f.ht_away, f.ft_home, f.ft_away
    FROM public.goldme_radar r
    JOIN LATERAL (
      SELECT x.ht_home, x.ht_away, x.ft_home, x.ft_away
      FROM public.fixtures x
      WHERE x.home_team_id = r.home_team_id AND x.away_team_id = r.away_team_id
        AND x.match_date BETWEEN r.day - 1 AND r.day + 1
        AND x.ft_home IS NOT NULL AND x.ht_home IS NOT NULL
      ORDER BY abs(x.match_date - r.day), x.fixture_id
      LIMIT 1
    ) f ON true
    WHERE r.settled_at IS NULL AND r.day >= current_date - 7
  )
  UPDATE public.goldme_radar r SET
    ht_home = u.ht_home, ht_away = u.ht_away, ft_home = u.ft_home, ft_away = u.ft_away,
    gold = (u.ht_home + u.ht_away >= 3 OR u.ht_home >= 4 OR u.ht_away >= 4 OR u.ft_home >= 5 OR u.ft_away >= 5 OR u.ft_home + u.ft_away >= 7),
    settled_at = now()
  FROM u WHERE r.day = u.day AND r.fixture_id = u.fixture_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_settle() TO service_role;

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
  FROM s GROUP BY 1
)
SELECT jsonb_build_object(
  'all', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s),
  'flagged', (SELECT jsonb_build_object('n', count(*), 'hits', count(*) FILTER (WHERE gold), 'avg_p', round(avg(p), 4)) FROM s WHERE flagged),
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
  v_ver constant integer := 6;
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

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('cfi-goldme-radar-build', 'cfi-goldme-radar-build-retry', 'cfi-goldme-radar-settle') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-goldme-radar-build', '8 17 * * *', $cron$SELECT public.cfi_goldme_radar_build(NULL, false)$cron$);
SELECT cron.schedule('cfi-goldme-radar-build-retry', '38 17 * * *', $cron$SELECT public.cfi_goldme_radar_build(NULL, false)$cron$);
SELECT cron.schedule('cfi-goldme-radar-settle', '23,53 * * * *', $cron$SELECT public.cfi_goldme_radar_settle()$cron$);
