CREATE OR REPLACE FUNCTION public.cfi_report(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET enable_nestloop TO off
AS $function$
WITH snap AS (
  SELECT DISTINCT ON ((m->>'fixture_id')::uuid) (m->>'fixture_id')::uuid AS fid, m->>'competition' AS comp
  FROM public.suggest_snapshot s
  CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
  CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
  WHERE s.snapshot_date BETWEEN p_from - 1 AND p_to + 1 AND m ? 'fixture_id'
  ORDER BY (m->>'fixture_id')::uuid, s.snapshot_date DESC
),
junk AS MATERIALIZED (
  SELECT fid FROM snap WHERE comp ~* '\m(U1[0-8]|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\M'
),
pk AS (
  SELECT l.fixture_id, l.home_team, l.away_team, l.kickoff_at, l.top_market, l.top_market_prob,
         l.settled_at, l.void_reason, l.ht_home, l.ht_away, l.ft_home, l.ft_away, l.hit_top_market
  FROM public.suggest_pick_log l
  WHERE (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
    AND (l.home_team || ' ' || l.away_team) !~* '\mU1[0-8]\M'
    AND COALESCE(l.top_market, '') !~ '^over_[01]\d*_ft$'
    AND COALESCE(l.top_market, '') !~ '^over_0_?[0-6]?\d*_ht$'
    AND NOT EXISTS (SELECT 1 FROM junk j WHERE j.fid = l.fixture_id)
),
pks AS (
  SELECT * FROM pk WHERE settled_at IS NOT NULL AND void_reason IS NULL AND ft_home IS NOT NULL
),
pl AS (
  SELECT * FROM public.parlay_log WHERE day BETWEEN p_from AND p_to
),
legs AS (
  SELECT DISTINCT ON ((leg->>'fixture_id'), (leg->>'type'), (leg->>'line'))
         (leg->>'fixture_id')::uuid AS fid, leg->>'type' AS ltype, (leg->>'line')::numeric AS line
  FROM pl, jsonb_array_elements(pl.legs) leg
  WHERE leg->>'fixture_id' ~ '^[0-9a-f-]{36}$'
),
legs_s AS (
  SELECT g.fid, g.ltype, g.line, s.home_team, s.away_team, s.kickoff_at, s.ht_home, s.ht_away, s.ft_home, s.ft_away,
         public.cfi_parlay_leg_score(g.ltype, g.line, s.ht_home, s.ht_away, s.ft_home, s.ft_away) AS sc
  FROM legs g JOIN pks s ON s.fixture_id = g.fid
  WHERE NOT (g.ltype = 'ou_ft' AND g.line < 2) AND NOT (g.ltype = 'ou_ht' AND g.line < 0.75)
),
preds0 AS (
  SELECT fixture_id AS fid, home_team, away_team, kickoff_at, ft_home, ft_away, ht_home, ht_away,
         COALESCE(hit_top_market, false) AS hit, jsonb_build_object('m', top_market) AS lab, 0 AS pri,
         CASE WHEN top_market = 'btts_yes' THEN 'btts'
              WHEN top_market ~ '^over_\d_?\d*_(ht|ft)$' THEN
                'ou_' || substring(top_market from '(ht|ft)$') || '|' ||
                trim_scale((substring(top_market from '^over_(\d)') || CASE WHEN substring(top_market from '^over_\d_?(\d*)_') = '' THEN '' ELSE '.' || substring(top_market from '^over_\d_?(\d*)_') END)::numeric)::text
              ELSE top_market END AS ck
  FROM pks WHERE top_market IS NOT NULL AND hit_top_market IS NOT NULL
  UNION ALL
  SELECT fid, home_team, away_team, kickoff_at, ft_home, ft_away, ht_home, ht_away, sc > 0,
         jsonb_build_object('t', ltype, 'l', line), 1,
         CASE WHEN line IS NULL THEN ltype ELSE ltype || '|' || trim_scale(line)::text END
  FROM legs_s WHERE sc IS NOT NULL AND sc <> 0
),
preds AS (
  SELECT DISTINCT ON (fid, ck) fid, home_team, away_team, kickoff_at, ft_home, ft_away, ht_home, ht_away, hit, lab
  FROM preds0 ORDER BY fid, ck, pri
),
tm AS (
  SELECT preds.fid, max(sn.comp) AS comp, max(home_team) AS home, max(away_team) AS away, max(kickoff_at) AS ko,
         max(ht_home) AS hh, max(ht_away) AS ha, max(ft_home) AS fh, max(ft_away) AS fa,
         count(*) AS n, count(*) FILTER (WHERE hit) AS h,
         jsonb_agg(lab || jsonb_build_object('ok', hit) ORDER BY hit DESC) AS pr
  FROM preds LEFT JOIN snap sn ON sn.fid = preds.fid GROUP BY preds.fid
),
teams AS (
  SELECT team, sum(n)::int AS n, sum(h)::int AS h, count(*)::int AS matches,
         jsonb_agg(jsonb_build_object('home', home, 'away', away, 'ft', fh || '-' || fa, 'h', h, 'n', n) ORDER BY ko DESC) AS ms
  FROM (SELECT home AS team, home, away, fh, fa, n, h, ko FROM tm UNION ALL SELECT away, home, away, fh, fa, n, h, ko FROM tm) x
  GROUP BY team
),
mk AS (
  SELECT top_market, count(*) AS n, count(*) FILTER (WHERE hit_top_market) AS h, avg(top_market_prob) AS p
  FROM pks WHERE top_market IS NOT NULL AND hit_top_market IS NOT NULL GROUP BY top_market
),
mkw AS (
  SELECT top_market, n, h, p, h::numeric / n AS r,
         (h::numeric / n + 1.9208 / n - 1.96 * sqrt((h::numeric / n) * (1 - h::numeric / n) / n + 0.9604 / (n * n))) / (1 + 3.8416 / n) AS lo,
         (h::numeric / n + 1.9208 / n + 1.96 * sqrt((h::numeric / n) * (1 - h::numeric / n) / n + 0.9604 / (n * n))) / (1 + 3.8416 / n) AS hi
  FROM mk WHERE n >= GREATEST(p_min_n, 1)
),
lg AS (
  SELECT sn.comp AS comp, count(*) AS n, count(*) FILTER (WHERE s.hit_top_market) AS h
  FROM pks s JOIN snap sn ON sn.fid = s.fixture_id
  WHERE s.top_market IS NOT NULL AND s.hit_top_market IS NOT NULL AND sn.comp IS NOT NULL
  GROUP BY sn.comp
),
lgw AS (
  SELECT comp, n, h, h::numeric / n AS r,
         (h::numeric / n + 1.9208 / n - 1.96 * sqrt((h::numeric / n) * (1 - h::numeric / n) / n + 0.9604 / (n * n))) / (1 + 3.8416 / n) AS lo
  FROM lg WHERE n >= GREATEST(p_min_n, 1)
),
pm AS (
  SELECT mode, count(*) AS n, count(*) FILTER (WHERE result IS NOT NULL AND result <> 'VOID') AS settled,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         count(*) FILTER (WHERE result IN ('LOSS','HALF_LOSS')) AS losses
  FROM pl GROUP BY mode
),
pt AS (
  SELECT mode, ptype, count(*) AS n, count(*) FILTER (WHERE result = 'WIN') AS wins,
         count(ret) AS n_odds, round(avg(ret - 1)::numeric, 4) AS roi
  FROM pl WHERE result IN ('WIN','LOSS','HALF_LOSS') GROUP BY mode, ptype
),
pw AS (
  SELECT mode, ptype, n_legs, system_p, ret, legs FROM pl WHERE result = 'WIN'
  ORDER BY ret DESC NULLS LAST, n_legs DESC, system_p ASC LIMIT 5
),
pp AS (
  SELECT count(*) AS n, count(*) FILTER (WHERE result = 'WIN') AS wins, round(avg(ret - 1)::numeric, 4) AS roi, count(ret) AS n_odds
  FROM pl WHERE placed AND result IN ('WIN','LOSS','HALF_LOSS')
),
ex AS (
  SELECT count(*) FILTER (WHERE ht_home + ht_away >= 3) AS x3ht,
         count(*) FILTER (WHERE ht_home >= 4 OR ht_away >= 4) AS xoht,
         count(*) FILTER (WHERE ft_home >= 5 OR ft_away >= 5) AS xoft,
         count(*) FILTER (WHERE ft_home + ft_away >= 7) AS x7ft
  FROM pks WHERE ht_home IS NOT NULL
)
SELECT jsonb_build_object(
  'from', p_from, 'to', p_to,
  'picks', jsonb_build_object(
    'predicted', (SELECT count(*) FROM pk WHERE top_market IS NOT NULL),
    'settled', (SELECT count(*) FROM pks WHERE top_market IS NOT NULL AND hit_top_market IS NOT NULL),
    'hits', (SELECT count(*) FROM pks WHERE hit_top_market),
    'avg_p', (SELECT round(avg(top_market_prob)::numeric, 4) FROM pks WHERE hit_top_market IS NOT NULL)
  ),
  'parlays', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'n', n, 'settled', settled, 'wins', wins, 'losses', losses)) FROM pm), '[]'::jsonb),
  'parlay_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'type', ptype, 'n', n, 'wins', wins, 'n_odds', n_odds, 'roi', roi) ORDER BY (n_odds >= 30 AND roi IS NOT NULL) DESC, CASE WHEN n_odds >= 30 THEN roi END DESC NULLS LAST, wins::numeric / n DESC, n DESC)
      FROM pt WHERE n >= GREATEST(p_min_n, 1)), '[]'::jsonb),
  'top_parlays', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'type', ptype, 'n_legs', n_legs, 'p', system_p, 'ret', ret,
      'legs', (SELECT jsonb_agg(jsonb_build_object('name', (l->>'home') || ' - ' || (l->>'away'), 't', l->>'type', 'l', l->'line',
                 'ft', CASE WHEN s.ft_home IS NULL THEN NULL ELSE s.ft_home || '-' || s.ft_away END))
               FROM jsonb_array_elements(legs) l
               LEFT JOIN pks s ON l->>'fixture_id' ~ '^[0-9a-f-]{36}$' AND s.fixture_id = (l->>'fixture_id')::uuid))) FROM pw), '[]'::jsonb),
  'placed', (SELECT to_jsonb(pp) FROM pp),
  'markets', COALESCE((SELECT jsonb_agg(jsonb_build_object('market', top_market, 'n', n, 'hits', h, 'hit', round(r, 4), 'p', round(p::numeric, 4),
      'ms', (SELECT jsonb_agg(jsonb_build_object('home', home_team, 'away', away_team, 'ft', ft_home || '-' || ft_away, 'ok', hit_top_market))
             FROM (SELECT * FROM pks x WHERE x.top_market = t.top_market AND x.hit_top_market IS NOT NULL ORDER BY x.kickoff_at DESC LIMIT 20) q)) ORDER BY lo DESC, n DESC)
      FROM (SELECT * FROM mkw ORDER BY lo DESC, n DESC LIMIT 5) t), '[]'::jsonb),
  'worst_markets', COALESCE((SELECT jsonb_agg(jsonb_build_object('market', top_market, 'n', n, 'hits', h, 'hit', round(r, 4), 'p', round(p::numeric, 4),
      'ms', (SELECT jsonb_agg(jsonb_build_object('home', home_team, 'away', away_team, 'ft', ft_home || '-' || ft_away, 'ok', hit_top_market))
             FROM (SELECT * FROM pks x WHERE x.top_market = t.top_market AND x.hit_top_market IS NOT NULL ORDER BY x.kickoff_at DESC LIMIT 20) q)) ORDER BY hi ASC, n DESC)
      FROM (SELECT * FROM mkw WHERE r < p ORDER BY hi ASC, n DESC LIMIT 3) t), '[]'::jsonb),
  'leagues', COALESCE((SELECT jsonb_agg(jsonb_build_object('comp', comp, 'n', n, 'hits', h, 'hit', round(r, 4),
      'ms', (SELECT jsonb_agg(jsonb_build_object('home', home_team, 'away', away_team, 'ft', ft_home || '-' || ft_away, 'ok', hit_top_market))
             FROM (SELECT x.* FROM pks x JOIN snap sn ON sn.fid = x.fixture_id WHERE sn.comp = t.comp AND x.hit_top_market IS NOT NULL ORDER BY x.kickoff_at DESC LIMIT 20) q)) ORDER BY lo DESC, n DESC)
      FROM (SELECT * FROM lgw ORDER BY lo DESC, n DESC LIMIT 5) t), '[]'::jsonb),
  'top_teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('team', team, 'hits', h, 'n', n, 'matches', matches, 'ms', ms) ORDER BY h DESC, n ASC)
      FROM (SELECT * FROM teams WHERE h > 0 ORDER BY h DESC, n ASC LIMIT 10) t), '[]'::jsonb),
  'top_matches', COALESCE((SELECT jsonb_agg(jsonb_build_object('home', home, 'away', away, 'kickoff', to_char(ko AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
      'comp', comp, 'ht', hh || '-' || ha, 'ft', fh || '-' || fa, 'hits', h, 'n', n, 'pr', pr) ORDER BY h DESC, n ASC)
      FROM (SELECT * FROM tm WHERE h > 0 ORDER BY h DESC, n ASC, ko LIMIT 10) t), '[]'::jsonb),
  'extreme', (SELECT to_jsonb(ex) FROM ex)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_report(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_report(date, date, integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.cfi_league_tiers (
  pattern text PRIMARY KEY,
  tier smallint NOT NULL CHECK (tier IN (1, 2))
);

ALTER TABLE public.cfi_league_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfi_league_tiers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cfi_league_tiers TO service_role;

INSERT INTO public.cfi_league_tiers (pattern, tier) VALUES
  ('^England · Premier League( ·|:|$)', 1),
  ('^Spain · (LaLiga|La Liga)( ·|:|$)', 1),
  ('^Italy · Serie A( ·|:|$)', 1),
  ('^Germany · Bundesliga( ·|:|$)', 1),
  ('^France · Ligue 1( ·|:|$)', 1),
  ('^(UEFA )?(Champions League|Europa League|Conference League)( ·|:|$)', 1),
  ('^Netherlands · Eredivisie( ·|:|$)', 1),
  ('^Portugal · (Liga Portugal|Primeira Liga)( ·|:|$)', 1),
  ('^Belgium · Belgian Pro League( ·|:|$)', 1),
  ('^Turkey · (Super Lig|Süper Lig|Trendyol Super Lig)( ·|:|$)', 1),
  ('^Scotland · Premiership( ·|:|$)', 1),
  ('^(World Cup|Euro Championship|European Championship)( ·|:|$)', 1),
  ('^England · (Championship|EFL Championship|FA Cup|League Cup|EFL Cup)( ·|:|$)', 2),
  ('^Spain · (LaLiga 2|Segunda Division|Copa del Rey)( ·|:|$)', 2),
  ('^Italy · (Serie B|Coppa Italia)( ·|:|$)', 2),
  ('^Germany · (2\. Bundesliga|DFB[ -]Pokal)( ·|:|$)', 2),
  ('^France · (Ligue 2|Coupe de France)( ·|:|$)', 2),
  ('^(USA|United States) · (MLS|Major League Soccer)( ·|:|$)', 2),
  ('^Mexico · Liga MX( ·|:|$)', 2),
  ('^Brazil · (Serie A|Brasileirao)( ·|:|$)', 2),
  ('^Argentina · (Liga Profesional|Primera Division)( ·|:|$)', 2),
  ('^Japan · J1 League( ·|:|$)', 2),
  ('^(South Korea|Korea Republic|Korea) · K League 1( ·|:|$)', 2),
  ('^Saudi Arabia · Saudi Professional League( ·|:|$)', 2),
  ('^Australia · A-League( ·|:|$)', 2),
  ('^Russia · Premier League( ·|:|$)', 2),
  ('^Switzerland · Super League( ·|:|$)', 2),
  ('^Austria · (Bundesliga|Admiral Bundesliga)( ·|:|$)', 2),
  ('^Greece · Super League( ·|:|$)', 2),
  ('^Denmark · Superliga( ·|:|$)', 2),
  ('^Norway · Eliteserien( ·|:|$)', 2),
  ('^Sweden · Allsvenskan( ·|:|$)', 2),
  ('^Poland · Ekstraklasa( ·|:|$)', 2),
  ('^Czech Republic · (First League|Fortuna Liga)( ·|:|$)', 2),
  ('^Croatia · (HNL|SuperSport HNL)( ·|:|$)', 2),
  ('^Ukraine · Premier League( ·|:|$)', 2),
  ('^(CONMEBOL )?(Copa )?(Libertadores|Sudamericana)( ·|:|$)', 2),
  ('^(Nations League|World Cup Qualification|Euro Qualification)( ·|:|$)', 2)
ON CONFLICT (pattern) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cfi_league_tier(p_comp text)
RETURNS smallint
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_comp IS NULL THEN 3::smallint
    WHEN p_comp ~* '(\mWomen\M|\mFeminin|\mU\d\d\M|\mYouth\M|\mReserves?\M)' THEN 3::smallint
    ELSE COALESCE((SELECT min(t.tier) FROM public.cfi_league_tiers t WHERE p_comp ~* t.pattern), 3)::smallint
  END
$function$;

REVOKE ALL ON FUNCTION public.cfi_league_tier(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_league_tier(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_market_hit(p_market text, p_ht_h integer, p_ht_a integer, p_ft_h integer, p_ft_a integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_market IS NULL OR p_ft_h IS NULL OR p_ft_a IS NULL THEN NULL
    WHEN p_market = 'btts_yes' THEN p_ft_h >= 1 AND p_ft_a >= 1
    WHEN p_market = '1x2_ht_home' THEN CASE WHEN p_ht_h IS NOT NULL AND p_ht_a IS NOT NULL THEN p_ht_h > p_ht_a END
    WHEN p_market = '1x2_ft_home' THEN p_ft_h > p_ft_a
    ELSE (
      SELECT CASE
        WHEN x.r IS NULL AND p_market <> 'over_2_5_ft' THEN NULL
        WHEN (CASE WHEN p_market = 'over_2_5_ft' THEN 'ft' ELSE x.r[3] END) = 'ht' AND (p_ht_h IS NULL OR p_ht_a IS NULL) THEN NULL
        ELSE CASE public.ou_result(
          CASE WHEN (CASE WHEN p_market = 'over_2_5_ft' THEN 'ft' ELSE x.r[3] END) = 'ht' THEN p_ht_h + p_ht_a ELSE p_ft_h + p_ft_a END,
          CASE WHEN p_market = 'over_2_5_ft' THEN 2.5
               WHEN x.r[2] = '' THEN x.r[1]::numeric
               ELSE (x.r[1] || '.' || x.r[2])::numeric END
        )
          WHEN 'WIN' THEN true
          WHEN 'HALF_WIN' THEN true
          WHEN 'LOSS' THEN false
          WHEN 'HALF_LOSS' THEN false
          ELSE NULL
        END
      END
      FROM (SELECT regexp_match(p_market, '^over_(\d)(\d*)_(ht|ft)$') AS r) x
    )
  END
$function$;

REVOKE ALL ON FUNCTION public.cfi_market_hit(text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_market_hit(text, integer, integer, integer, integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.best_choice_daily (
  day date NOT NULL,
  fixture_id uuid NOT NULL,
  rank smallint NOT NULL,
  provider_id text,
  kickoff_at timestamptz NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  competition text,
  tier smallint NOT NULL,
  has_odds boolean NOT NULL DEFAULT false,
  market text NOT NULL,
  p_model numeric(5, 4) NOT NULL,
  p_win numeric(5, 4) NOT NULL,
  hist_n integer,
  locked_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  void boolean NOT NULL DEFAULT false,
  hit boolean,
  ht_home smallint,
  ht_away smallint,
  ft_home smallint,
  ft_away smallint,
  PRIMARY KEY (day, fixture_id)
);

CREATE INDEX IF NOT EXISTS best_choice_daily_unsettled_idx ON public.best_choice_daily (kickoff_at) WHERE settled_at IS NULL;

ALTER TABLE public.best_choice_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.best_choice_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.best_choice_daily TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_best_choice_build(p_day date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_from timestamptz := (COALESCE(p_day, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text || ' 06:00:00+07')::timestamptz;
  v_to timestamptz;
  v_epoch timestamptz;
  v_cnt integer;
BEGIN
  v_to := v_from + interval '1 day';
  IF NOT p_force AND EXISTS (SELECT 1 FROM public.best_choice_daily WHERE day = v_day) THEN
    SELECT count(*) INTO v_cnt FROM public.best_choice_daily WHERE day = v_day;
    RETURN v_cnt;
  END IF;
  IF p_force THEN
    DELETE FROM public.best_choice_daily WHERE day = v_day;
  END IF;
  SELECT (c.value #>> '{}')::timestamptz INTO v_epoch FROM public.cfi_config c WHERE c.key = 'ft_total_cal_at';
  IF v_epoch IS NULL
     AND position('lc double precision' IN pg_get_functiondef('public.cfi_score_pred(double precision,double precision)'::regprocedure)) > 0 THEN
    v_epoch := now();
    INSERT INTO public.cfi_config (key, value, updated_at) VALUES ('ft_total_cal_at', to_jsonb(v_epoch), now())
    ON CONFLICT (key) DO NOTHING;
  END IF;
  WITH snap AS (
    SELECT s.payload FROM public.suggest_snapshot s WHERE s.snapshot_date = v_today ORDER BY s.generated_at DESC LIMIT 1
  ), cand AS (
    SELECT (m->>'fixture_id')::uuid AS fixture_id,
           m->>'provider_id' AS provider_id,
           (m->>'kickoff')::timestamptz AS kickoff_at,
           m->>'home' AS home,
           m->>'away' AS away,
           m->>'competition' AS comp,
           m->>'top_market' AS market,
           (m->>'top_market_prob')::numeric AS p_model,
           COALESCE((m->>'no_stats')::boolean, false) AS no_stats,
           COALESCE(jsonb_typeof(m->'market_odds') = 'array' AND jsonb_array_length(m->'market_odds') > 0, false) AS has_odds
    FROM snap s
    CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
    CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
    WHERE m ? 'fixture_id' AND m->>'top_market' IS NOT NULL AND m->>'top_market_prob' IS NOT NULL
  ), hist AS (
    SELECT l.top_market AS m, floor(l.top_market_prob::numeric * 20) / 20 AS band, count(*) AS n, avg(l.hit_top_market::int)::numeric AS r
    FROM public.suggest_pick_log l
    WHERE l.settled_at IS NOT NULL AND l.void_reason IS NULL AND l.hit_top_market IS NOT NULL AND l.top_market_prob IS NOT NULL
      AND l.kickoff_at >= now() - interval '45 days'
      AND (l.top_market !~ '^over_[0-9_]+_ft$' OR l.kickoff_at >= COALESCE(v_epoch, '-infinity'::timestamptz))
    GROUP BY 1, 2
  ), scored AS (
    SELECT c.*, h.n AS hist_n, public.cfi_league_tier(c.comp) AS tier,
           CASE WHEN h.n >= 20 THEN (h.n * h.r + 40 * c.p_model) / (h.n + 40) ELSE c.p_model END AS p_win
    FROM cand c
    LEFT JOIN hist h ON h.m = c.market AND h.band = floor(c.p_model * 20) / 20
    WHERE c.kickoff_at >= v_from AND c.kickoff_at < v_to AND c.kickoff_at > now()
      AND NOT c.no_stats
      AND c.provider_id IS NOT NULL
      AND (COALESCE(c.comp, '') || ' ' || COALESCE(c.home, '') || ' ' || COALESCE(c.away, '')) !~* '(\mU1[0-8]\M|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)'
  ), ranked AS (
    SELECT s.*, least(s.tier + CASE WHEN s.has_odds THEN 0 ELSE 1 END, 3) AS ptier,
           row_number() OVER (PARTITION BY s.comp ORDER BY s.p_win DESC) AS rn_lg
    FROM scored s
    WHERE s.p_win >= 0.60
  ), pool AS (
    SELECT r.*, row_number() OVER (ORDER BY (CASE WHEN r.p_win >= 0.70 THEN 0 ELSE 1 END), r.ptier, r.p_win DESC) AS ord,
           count(*) FILTER (WHERE r.p_win >= 0.70) OVER () AS n_strong
    FROM ranked r
    WHERE r.rn_lg <= 3
  ), chosen AS (
    SELECT p.*, row_number() OVER (ORDER BY p.p_win DESC, p.ptier, p.ord) AS rk
    FROM pool p
    WHERE p.ord <= least(20, greatest(10, p.n_strong))
  )
  INSERT INTO public.best_choice_daily (day, fixture_id, rank, provider_id, kickoff_at, home_team, away_team, competition, tier, has_odds, market, p_model, p_win, hist_n)
  SELECT v_day, c.fixture_id, c.rk, c.provider_id, c.kickoff_at, c.home, c.away, c.comp, c.tier, c.has_odds, c.market,
         round(c.p_model, 4), round(c.p_win, 4), c.hist_n
  FROM chosen c
  ON CONFLICT (day, fixture_id) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.best_choice_daily WHERE day = v_day;
  RETURN v_cnt;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_build(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_build(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_best_choice_settle()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cnt integer := 0;
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
  WITH v AS (
    UPDATE public.best_choice_daily SET settled_at = now(), void = true
    WHERE settled_at IS NULL AND kickoff_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_void FROM v;
  RETURN v_cnt + v_void;
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
    'by_tier', COALESCE((SELECT jsonb_agg(jsonb_build_object('tier', tier, 'n', n, 'hits', hits, 'avg_p', avg_p) ORDER BY tier) FROM t), '[]'::jsonb)
  )
$function$;

REVOKE ALL ON FUNCTION public.cfi_best_choice_report(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_best_choice_report(date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.cfi_report_cached(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_ver constant integer := 3;
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
      'best_choice', public.cfi_best_choice_report(p_from, p_to)
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
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('cfi-best-choice-build', 'cfi-best-choice-build-retry', 'cfi-best-choice-settle') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('cfi-best-choice-build', '5 23 * * *', $cron$SELECT public.cfi_best_choice_build()$cron$);
SELECT cron.schedule('cfi-best-choice-build-retry', '35 23 * * *', $cron$SELECT public.cfi_best_choice_build()$cron$);
SELECT cron.schedule('cfi-best-choice-settle', '17,47 * * * *', $cron$SELECT public.cfi_best_choice_settle()$cron$);
