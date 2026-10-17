CREATE OR REPLACE FUNCTION public.cfi_parlay_placed(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH r AS (
  SELECT pl.*
  FROM public.parlay_log pl
  WHERE pl.placed
  ORDER BY pl.day DESC, pl.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'mode', r.mode,
  'ptype', r.ptype,
  'scope', r.scope,
  'result', r.result,
  'ret', r.ret,
  'is_user', (r.user_legs IS NOT NULL),
  'placed', true,
  'p', round((CASE WHEN r.user_legs IS NOT NULL AND r.user_p IS NOT NULL THEN r.user_p ELSE r.system_p END)::numeric, 4),
  'n_legs', r.n_legs,
  'day', r.day,
  'legs', (
    SELECT jsonb_agg(jsonb_build_object(
      'home', l.leg->>'home',
      'away', l.leg->>'away',
      'kickoff', l.leg->>'kickoff',
      'type', l.leg->>'type',
      'line', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric),
      'odds', CASE WHEN r.user_legs IS NOT NULL AND u.e IS NOT NULL THEN (u.e->>'odds')::numeric ELSE (l.leg->>'odds')::numeric END,
      'ht', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN s.ht_home || '-' || s.ht_away END,
      'ft', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN s.ft_home || '-' || s.ft_away END,
      'sc', CASE WHEN s.settled_at IS NOT NULL AND s.ft_home IS NOT NULL THEN public.cfi_parlay_leg_score(l.leg->>'type', COALESCE((u.e->>'line')::numeric, (l.leg->>'line')::numeric), s.ht_home, s.ht_away, s.ft_home, s.ft_away) END
    ) ORDER BY l.ord)
    FROM jsonb_array_elements(r.legs) WITH ORDINALITY AS l(leg, ord)
    LEFT JOIN LATERAL (
      SELECT e FROM jsonb_array_elements(COALESCE(r.user_legs, '[]'::jsonb)) e WHERE (e->>'i')::int = l.ord - 1 LIMIT 1
    ) u ON true
    LEFT JOIN public.suggest_pick_log s ON s.fixture_id = (l.leg->>'fixture_id')::uuid
  )
) ORDER BY r.day DESC, r.created_at DESC), '[]'::jsonb)
FROM r;
$function$;

REVOKE ALL ON FUNCTION public.cfi_parlay_placed(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_parlay_placed(integer) TO service_role;
