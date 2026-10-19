CREATE OR REPLACE FUNCTION public.cfi_report(p_from date, p_to date, p_min_n integer DEFAULT 3)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH pk AS (
  SELECT l.fixture_id, l.home_team, l.away_team, l.kickoff_at, l.top_market, l.top_market_prob,
         l.settled_at, l.void_reason, l.ht_home, l.ht_away, l.ft_home, l.ft_away, l.hit_top_market
  FROM public.suggest_pick_log l
  WHERE (l.kickoff_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN p_from AND p_to
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
),
preds AS (
  SELECT fixture_id AS fid, home_team, away_team, kickoff_at, ft_home, ft_away, ht_home, ht_away,
         COALESCE(hit_top_market, false) AS hit
  FROM pks WHERE top_market IS NOT NULL AND hit_top_market IS NOT NULL
  UNION ALL
  SELECT fid, home_team, away_team, kickoff_at, ft_home, ft_away, ht_home, ht_away, sc > 0
  FROM legs_s WHERE sc IS NOT NULL AND sc <> 0
),
tm AS (
  SELECT fid, max(home_team) AS home, max(away_team) AS away, max(kickoff_at) AS ko,
         max(ht_home) AS hh, max(ht_away) AS ha, max(ft_home) AS fh, max(ft_away) AS fa,
         count(*) AS n, count(*) FILTER (WHERE hit) AS h
  FROM preds GROUP BY fid
),
teams AS (
  SELECT team, sum(n)::int AS n, sum(h)::int AS h, count(*)::int AS matches
  FROM (SELECT home AS team, n, h FROM tm UNION ALL SELECT away, n, h FROM tm) x
  GROUP BY team
),
mk AS (
  SELECT top_market, count(*) AS n, count(*) FILTER (WHERE hit_top_market) AS h, round(avg(top_market_prob)::numeric, 4) AS p
  FROM pks WHERE top_market IS NOT NULL AND hit_top_market IS NOT NULL GROUP BY top_market
),
pm AS (
  SELECT mode, count(*) AS n, count(*) FILTER (WHERE result IS NOT NULL AND result <> 'VOID') AS settled,
         count(*) FILTER (WHERE result = 'WIN') AS wins,
         count(*) FILTER (WHERE result IN ('LOSS','HALF_LOSS')) AS losses
  FROM pl GROUP BY mode
),
pt AS (
  SELECT mode, ptype, count(*) AS n, count(*) FILTER (WHERE result = 'WIN') AS wins
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
  'parlay_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'type', ptype, 'n', n, 'wins', wins) ORDER BY wins::numeric / n DESC, n DESC) FROM pt WHERE n >= GREATEST(p_min_n, 1)), '[]'::jsonb),
  'top_parlays', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', mode, 'type', ptype, 'n_legs', n_legs, 'p', system_p, 'ret', ret,
      'legs', (SELECT jsonb_agg((l->>'home') || ' - ' || (l->>'away')) FROM jsonb_array_elements(legs) l))) FROM pw), '[]'::jsonb),
  'placed', (SELECT to_jsonb(pp) FROM pp),
  'markets', COALESCE((SELECT jsonb_agg(jsonb_build_object('market', top_market, 'n', n, 'hits', h, 'hit', round(h::numeric / n, 4), 'p', p) ORDER BY h::numeric / n DESC, n DESC)
      FROM (SELECT * FROM mk WHERE n >= GREATEST(p_min_n, 1) ORDER BY h::numeric / n DESC, n DESC LIMIT 5) t), '[]'::jsonb),
  'top_teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('team', team, 'hits', h, 'n', n, 'matches', matches) ORDER BY h DESC, n ASC)
      FROM (SELECT * FROM teams WHERE h > 0 ORDER BY h DESC, n ASC LIMIT 10) t), '[]'::jsonb),
  'top_matches', COALESCE((SELECT jsonb_agg(jsonb_build_object('home', home, 'away', away, 'kickoff', to_char(ko AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
      'ht', hh || '-' || ha, 'ft', fh || '-' || fa, 'hits', h, 'n', n) ORDER BY h DESC, n ASC)
      FROM (SELECT * FROM tm WHERE h > 0 ORDER BY h DESC, n ASC, ko LIMIT 10) t), '[]'::jsonb),
  'extreme', (SELECT to_jsonb(ex) FROM ex)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_report(date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_report(date, date, integer) TO service_role;
