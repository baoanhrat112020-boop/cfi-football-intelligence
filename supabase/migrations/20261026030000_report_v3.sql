CREATE OR REPLACE FUNCTION public.cfi_report(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH snap AS (
  SELECT DISTINCT ON ((m->>'fixture_id')::uuid) (m->>'fixture_id')::uuid AS fid, m->>'competition' AS comp
  FROM public.suggest_snapshot s
  CROSS JOIN LATERAL jsonb_array_elements(s.payload->'slots') sl
  CROSS JOIN LATERAL jsonb_array_elements(sl->'matches') m
  WHERE (p_to - p_from) <= 35 AND s.snapshot_date BETWEEN p_from - 1 AND p_to + 1 AND m ? 'fixture_id'
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
  WHERE (p_to - p_from) <= 35 AND leg->>'fixture_id' ~ '^[0-9a-f-]{36}$'
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
  'parlay_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'type', ptype, 'n', n, 'wins', wins, 'n_odds', n_odds, 'roi', roi) ORDER BY wins::numeric / n DESC, n DESC)
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
