CREATE OR REPLACE FUNCTION public.cfi_team_lambda_by_names(home_name text, away_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_home jsonb := public.cfi_resolve_team_name(home_name);
  v_away jsonb := public.cfi_resolve_team_name(away_name);
  v_home_id text := CASE WHEN v_home->>'status' = 'RESOLVED' THEN v_home->>'team_id' END;
  v_away_id text := CASE WHEN v_away->>'status' = 'RESOLVED' THEN v_away->>'team_id' END;
  hs public.team_stats%ROWTYPE;
  aws public.team_stats%ROWTYPE;
  v_hs_found boolean := false;
  v_aws_found boolean := false;
  lh double precision;
  la double precision;
BEGIN
  IF v_home_id IS NOT NULL THEN
    SELECT * INTO hs FROM public.team_stats WHERE team_id = v_home_id;
    v_hs_found := FOUND;
  END IF;
  IF v_away_id IS NOT NULL THEN
    SELECT * INTO aws FROM public.team_stats WHERE team_id = v_away_id;
    v_aws_found := FOUND;
  END IF;

  lh := (COALESCE(hs.attack_home, 1.53)::float + COALESCE(aws.defense_away, 1.53)::float) / 2.0;
  la := (COALESCE(aws.attack_away, 1.22)::float + COALESCE(hs.defense_home, 1.22)::float) / 2.0;

  RETURN jsonb_build_object(
    'lambda_home_ft', ROUND(lh::numeric, 4),
    'lambda_away_ft', ROUND(la::numeric, 4),
    'source', CASE WHEN v_hs_found AND v_aws_found THEN 'team_stats' WHEN v_hs_found OR v_aws_found THEN 'partial' ELSE 'default' END,
    'home_resolved', v_home_id IS NOT NULL,
    'away_resolved', v_away_id IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_team_lambda_by_names(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_team_lambda_by_names(text, text) TO service_role;
