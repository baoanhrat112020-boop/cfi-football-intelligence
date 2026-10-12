CREATE OR REPLACE FUNCTION public.cfi_cleanup_prediction_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.cfi_prediction_snapshots s
  WHERE s.created_at < now() - interval '180 days'
    AND NOT EXISTS (SELECT 1 FROM public.cfi_prediction_settlements x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_result_resolutions x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_decision_snapshots x WHERE x.prediction_snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_k048_shadow_snapshots x WHERE x.prediction_snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_mm_fusion_v2_prospective_samples x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_mm_fusion_v3_prospective_samples x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_pc_result_recovery_queue x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_prediction_audit_selection x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_prediction_terminal_resolutions x WHERE x.snapshot_id = s.snapshot_id)
    AND NOT EXISTS (SELECT 1 FROM public.cfi_user_bets x WHERE x.prediction_snapshot_id = s.snapshot_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.cfi_cleanup_prediction_snapshots() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.cfi_cleanup_prediction_snapshots() IS 'Lần đầu 0 dòng. Bắt đầu xoá từ 16/2/2027 (180 ngày sau ngày tạo 16/8/2026)';

SELECT cron.schedule(
  'cfi-prediction-snapshots-retention',
  '0 4 * * *',
  $$SELECT public.cfi_cleanup_prediction_snapshots()$$
);
