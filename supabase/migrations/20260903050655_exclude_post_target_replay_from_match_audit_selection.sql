-- Preserve all historical snapshots, but make definite post-target replay snapshots ineligible
-- for selected-for-match audit/performance metrics.
CREATE OR REPLACE VIEW public.cfi_prediction_history
WITH (security_invoker=true)
AS
WITH ranked AS (
  SELECT
    s.snapshot_id,
    s.created_at,
    s.target_date,
    s.home_team,
    s.away_team,
    s.engine_version,
    s.language,
    s.strict_prior,
    s.prediction,
    s.prediction_hash,
    s.source,
    ((s.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= s.target_date) AS runtime_eligible,
    row_number() OVER (
      PARTITION BY s.target_date, lower(s.home_team), lower(s.away_team)
      ORDER BY
        CASE
          WHEN (s.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > s.target_date THEN 9
          WHEN sel.snapshot_id = s.snapshot_id THEN 0
          WHEN sel.snapshot_id IS NOT NULL THEN 2
          WHEN COALESCE(s.prediction->>'status','')='DATA_READY' THEN 0
          ELSE 1
        END,
        CASE
          WHEN (s.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > s.target_date THEN s.created_at
          WHEN sel.snapshot_id IS NULL THEN s.created_at
          ELSE NULL::timestamptz
        END DESC,
        s.created_at
    ) AS audit_rank
  FROM public.cfi_prediction_snapshots s
  LEFT JOIN public.cfi_prediction_audit_selection sel
    ON sel.match_key = s.target_date::text || '|' || lower(btrim(s.home_team)) || '|' || lower(btrim(s.away_team))
  WHERE s.strict_prior IS TRUE
), joined AS (
  SELECT
    r.snapshot_id,r.created_at,r.target_date,r.home_team,r.away_team,r.engine_version,r.language,
    r.strict_prior,r.prediction,r.prediction_hash,r.source,r.runtime_eligible,r.audit_rank,
    st.fixture_id,st.settled_at,st.actual_ht_home,st.actual_ht_away,st.actual_ft_home,st.actual_ft_away,
    st.actual_markets,st.market_brier,st.scoreline_hit_ht AS top1_ht_hit,
    st.scoreline_hit_ft AS top1_ft_hit,st.audit AS settlement_audit
  FROM ranked r
  LEFT JOIN public.cfi_prediction_settlements st ON st.snapshot_id=r.snapshot_id
)
SELECT
  snapshot_id,
  target_date,
  home_team,
  away_team,
  created_at,
  engine_version,
  source,
  prediction_hash,
  prediction->>'status' AS prediction_status,
  audit_rank,
  (audit_rank=1 AND runtime_eligible) AS selected_for_match_audit,
  prediction->>'verdict' AS verdict,
  prediction #>> '{markets,"3+ HT",methodA}'::text[] AS method_a_3plus_ht,
  prediction #>> '{markets,"3+ HT",methodB}'::text[] AS method_b_3plus_ht,
  prediction #>> '{markets,"3+ HT",final}'::text[] AS final_3plus_ht,
  prediction #>> '{markets,"7+ FT",methodA}'::text[] AS method_a_7plus_ft,
  prediction #>> '{markets,"7+ FT",methodB}'::text[] AS method_b_7plus_ft,
  prediction #>> '{markets,"7+ FT",final}'::text[] AS final_7plus_ft,
  prediction #>> '{markets,"Other HT",methodA}'::text[] AS method_a_other_ht,
  prediction #>> '{markets,"Other HT",methodB}'::text[] AS method_b_other_ht,
  prediction #>> '{markets,"Other HT",final}'::text[] AS final_other_ht,
  prediction #>> '{markets,"Other FT",methodA}'::text[] AS method_a_other_ft,
  prediction #>> '{markets,"Other FT",methodB}'::text[] AS method_b_other_ft,
  prediction #>> '{markets,"Other FT",final}'::text[] AS final_other_ft,
  CASE
    WHEN jsonb_typeof(prediction #> '{scoreline,ht}'::text[])='array' THEN prediction #> '{scoreline,ht}'::text[]
    WHEN jsonb_typeof(prediction #> '{scoreline,ht,final}'::text[])='array' THEN prediction #> '{scoreline,ht,final}'::text[]
    WHEN jsonb_typeof(prediction #> '{sixTargetMatrix,scoreline,"Top-3 HT",final}'::text[])='array' THEN prediction #> '{sixTargetMatrix,scoreline,"Top-3 HT",final}'::text[]
    ELSE '[]'::jsonb
  END AS top3_ht,
  CASE
    WHEN jsonb_typeof(prediction #> '{scoreline,ft}'::text[])='array' THEN prediction #> '{scoreline,ft}'::text[]
    WHEN jsonb_typeof(prediction #> '{scoreline,ft,final}'::text[])='array' THEN prediction #> '{scoreline,ft,final}'::text[]
    WHEN jsonb_typeof(prediction #> '{sixTargetMatrix,scoreline,"Top-3 FT",final}'::text[])='array' THEN prediction #> '{sixTargetMatrix,scoreline,"Top-3 FT",final}'::text[]
    ELSE '[]'::jsonb
  END AS top3_ft,
  COALESCE(prediction #>> '{scoreline,mostLikelyPath}'::text[],prediction #>> '{mostLikelyPath}'::text[],prediction #>> '{scoreline,path}'::text[]) AS most_likely_path,
  fixture_id,
  settled_at,
  CASE WHEN settled_at IS NULL THEN 'PENDING' ELSE 'SETTLED' END AS settlement_status,
  actual_ht_home,actual_ht_away,actual_ft_home,actual_ft_away,actual_markets,market_brier,
  top1_ht_hit,top1_ft_hit,settlement_audit
FROM joined;
