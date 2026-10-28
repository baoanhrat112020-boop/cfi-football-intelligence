CREATE OR REPLACE FUNCTION public.cfi_goldme_radar_day(p_day date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT * FROM public.goldme_radar WHERE day = p_day AND flagged
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'main', (SELECT jsonb_build_object(
        'total', count(*),
        'n', count(*) FILTER (WHERE settled_at IS NOT NULL AND gold IS NOT NULL),
        'hits', count(*) FILTER (WHERE gold),
        'avg_p', round(avg(p) FILTER (WHERE settled_at IS NOT NULL AND gold IS NOT NULL), 4))
      FROM r WHERE grp = 'main'),
    'eng', (SELECT jsonb_build_object(
        'total', count(*),
        'n', count(*) FILTER (WHERE settled_at IS NOT NULL AND gold IS NOT NULL),
        'hits', count(*) FILTER (WHERE gold),
        'avg_p', round(avg(p) FILTER (WHERE settled_at IS NOT NULL AND gold IS NOT NULL), 4))
      FROM r WHERE grp = 'eng'),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fid', fixture_id, 'home', home_team, 'away', away_team, 't', kickoff_at, 'c', competition, 'p', p, 'gold', gold, 'hh', ht_home, 'ha', ht_away, 'fh', ft_home, 'fa', ft_away) ORDER BY p DESC)
      FROM r WHERE grp = 'main'), '[]'::jsonb),
    'eng_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fid', fixture_id, 'home', home_team, 'away', away_team, 't', kickoff_at, 'c', competition, 'p', p, 'gold', gold, 'hh', ht_home, 'ha', ht_away, 'fh', ft_home, 'fa', ft_away) ORDER BY p DESC)
      FROM r WHERE grp = 'eng'), '[]'::jsonb)
  )
$function$;

REVOKE ALL ON FUNCTION public.cfi_goldme_radar_day(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_goldme_radar_day(date) TO service_role;
