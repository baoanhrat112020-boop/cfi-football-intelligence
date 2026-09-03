-- Refine replay guard to fixture-date semantics (UTC) and add exact VERIFIED kickoff protection.
-- This avoids false rejection of European fixtures that occur after midnight in Asia/Ho_Chi_Minh.
CREATE OR REPLACE FUNCTION public.cfi_record_prediction_snapshot(
  p_target_date date,
  p_home_team text,
  p_away_team text,
  p_engine_version text,
  p_language text,
  p_strict_prior boolean,
  p_prediction jsonb,
  p_prediction_hash text,
  p_source text DEFAULT 'GPT_ACTION'::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_runtime_date date := (now() AT TIME ZONE 'UTC')::date;
  v_home_id uuid;
  v_away_id uuid;
  v_home_resolution jsonb;
  v_away_resolution jsonb;
  v_verified_kickoff timestamptz;
  v_verified_fixture_count integer := 0;
BEGIN
  IF p_target_date IS NULL OR btrim(coalesce(p_home_team,''))='' OR btrim(coalesce(p_away_team,''))='' THEN
    RETURN jsonb_build_object('status','REJECTED','reason','TARGET_AND_TEAMS_REQUIRED');
  END IF;

  IF p_prediction IS NULL OR p_prediction_hash IS NULL OR btrim(p_prediction_hash)='' THEN
    RETURN jsonb_build_object('status','REJECTED','reason','PREDICTION_AND_HASH_REQUIRED');
  END IF;

  IF p_target_date < v_runtime_date THEN
    RETURN jsonb_build_object(
      'status','REJECTED',
      'reason','TARGET_DATE_ALREADY_PASSED',
      'targetDate',p_target_date,
      'runtimeDateUtc',v_runtime_date,
      'reconstructionBlocked',true
    );
  END IF;

  v_home_resolution := public.cfi_resolve_team_name(p_home_team);
  v_away_resolution := public.cfi_resolve_team_name(p_away_team);

  IF v_home_resolution->>'status'='RESOLVED' AND v_away_resolution->>'status'='RESOLVED' THEN
    v_home_id := (v_home_resolution->>'team_id')::uuid;
    v_away_id := (v_away_resolution->>'team_id')::uuid;

    SELECT count(*), min(kickoff_at)
      INTO v_verified_fixture_count, v_verified_kickoff
    FROM public.cfi_living_verified_fixtures
    WHERE target_date=p_target_date
      AND verification_status='VERIFIED'
      AND canonical_home_team_id=v_home_id
      AND canonical_away_team_id=v_away_id
      AND kickoff_at IS NOT NULL;

    IF v_verified_fixture_count > 1 THEN
      RETURN jsonb_build_object(
        'status','REJECTED',
        'reason','AMBIGUOUS_VERIFIED_FIXTURE_KICKOFF',
        'targetDate',p_target_date,
        'verifiedFixtureCount',v_verified_fixture_count,
        'reconstructionBlocked',true
      );
    END IF;

    IF v_verified_fixture_count = 1 AND v_verified_kickoff <= now() THEN
      RETURN jsonb_build_object(
        'status','REJECTED',
        'reason','VERIFIED_KICKOFF_ALREADY_PASSED',
        'targetDate',p_target_date,
        'verifiedKickoffAt',v_verified_kickoff,
        'reconstructionBlocked',true
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.fixtures f
      WHERE f.match_date=p_target_date
        AND f.home_team_id=v_home_id
        AND f.away_team_id=v_away_id
        AND (
          f.ht_home IS NOT NULL OR f.ht_away IS NOT NULL OR
          f.ft_home IS NOT NULL OR f.ft_away IS NOT NULL OR
          upper(coalesce(f.status,'')) IN ('FINISHED','FT','AET','PEN','COMPLETED')
        )
    ) THEN
      RETURN jsonb_build_object(
        'status','REJECTED',
        'reason','FIXTURE_ALREADY_HAS_RESULT',
        'targetDate',p_target_date,
        'reconstructionBlocked',true
      );
    END IF;
  END IF;

  INSERT INTO public.cfi_prediction_snapshots(
    target_date,home_team,away_team,engine_version,language,strict_prior,prediction,prediction_hash,source
  ) VALUES (
    p_target_date,btrim(p_home_team),btrim(p_away_team),p_engine_version,
    coalesce(nullif(p_language,''),'vi'),coalesce(p_strict_prior,true),p_prediction,p_prediction_hash,
    coalesce(nullif(p_source,''),'GPT_ACTION')
  )
  ON CONFLICT (target_date, lower(btrim(home_team)), lower(btrim(away_team)), prediction_hash)
  DO UPDATE SET prediction_hash=excluded.prediction_hash
  RETURNING snapshot_id INTO v_id;

  RETURN jsonb_build_object('status','RECORDED','snapshotId',v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cfi_record_prediction_snapshot(date,text,text,text,text,boolean,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_record_prediction_snapshot(date,text,text,text,text,boolean,jsonb,text,text) TO service_role;
