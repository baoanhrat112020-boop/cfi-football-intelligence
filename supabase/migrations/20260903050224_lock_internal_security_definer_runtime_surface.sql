-- CFI live-readiness security hotfix: restrict internal mutation/automation RPCs.
-- No data/model/prediction/settlement semantics are changed.

REVOKE EXECUTE ON FUNCTION public.cfi_promote_forward_capture_v2(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_promote_forward_capture_v2(uuid, jsonb, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cfi_run_forward_market_v2_automation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_run_forward_market_v2_automation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v2() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v3() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v3() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v3_research() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_settle_forward_market_ready_v3_research() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cfi_upsert_team_alias(text, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_upsert_team_alias(text, text, text, numeric) TO service_role;

-- Trigger helpers are not RPC surfaces; remove accidental public execute grants.
REVOKE EXECUTE ON FUNCTION public.cfi_mm_fusion_v2_mark_settled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cfi_mm_fusion_v2_register_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_mm_fusion_v2_mark_settled() TO service_role;
GRANT EXECUTE ON FUNCTION public.cfi_mm_fusion_v2_register_snapshot() TO service_role;

-- Readiness is internal operational telemetry. Run with invoker rights and expose only to service role.
ALTER VIEW public.cfi_forward_market_readiness_v1 SET (security_invoker = true);
REVOKE ALL ON TABLE public.cfi_forward_market_readiness_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cfi_forward_market_readiness_v1 TO service_role;

-- Pin search_path on helper functions flagged by the database security linter.
ALTER FUNCTION public.cfi_mm_v22_binary_metric(double precision, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.cfi_mm_v22_score_grid_metric(jsonb, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cfi_mm_v22_node_metrics(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cfi_k048_forbid_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.cfi_k048_build_joint_json(jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.cfi_normalize_team_name(text) SET search_path = public, pg_temp;
