import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('selected settlement dispatcher rotates backlog every 20 minutes', async () => {
  const src = await read('supabase/functions/cfi-result-collector-selected/index.ts');
  assert.match(src, /CFI_RESULT_COLLECTOR_SELECTED_DISPATCH_R3_20M_ROTATION/);
  assert.match(src, /Math\.floor\(localMinute\s*\/\s*20\)/);
  assert.match(src, /selected_for_match_audit/);
  assert.match(src, /settlement_status[^\n]*PENDING/);
});

test('live calibration learner is settlement-only, terminal-aware and unique-fixture weighted', async () => {
  const src = await read('supabase/functions/cfi-calibration-learn/index.ts');
  assert.match(src, /CFI_CAL_LEARNER_V3_3_1_UNIQUE_FIXTURE_FIX/);
  assert.match(src, /SETTLED_PRODUCTION/);
  assert.match(src, /cfi_prediction_fixture_identity_v1/);
  assert.match(src, /fixture_identity_key/);
  assert.match(src, /selected_representative_snapshot_id/);
  assert.match(src, /NO_NEW_UNIQUE_FIXTURE_SETTLEMENTS/);
  assert.match(src, /UNIQUE_FIXTURE_DAILY_AUDIT/);
  assert.match(src, /RECENT_SETTLEMENT_COVERAGE_INCOMPLETE/);
  assert.match(src, /partialLabelsBlockedFromPromotion:true/);
  assert.match(src, /terminalAwareCoverage:true/);
  assert.match(src, /uniqueFixtureWeighting:true/);
  assert.match(src, /rawSettledProductionSnapshots/);
  assert.match(src, /dedupedSettledSnapshots/);
});

test('feedback-loop migration schedules settlement retry, daily audit and learner', async () => {
  const sql = await read('supabase/migrations/20260904010449_restore_settlement_learning_feedback_loop.sql');
  assert.match(sql, /cfi_daily_prediction_audit_runs/);
  assert.match(sql, /cfi_capture_daily_prediction_audit/);
  assert.match(sql, /11,31,51 \* \* \* \*/);
  assert.match(sql, /cfi-prediction-daily-audit-hourly/);
  assert.match(sql, /16 \* \* \* \*/);
  assert.match(sql, /cfi-calibration-live-feedback-hourly/);
  assert.match(sql, /37 \* \* \* \*/);
  assert.match(sql, /revoke execute on function public\.cfi_capture_daily_prediction_audit\(date\) from public, anon, authenticated/i);
});

test('terminal result ledger is immutable-service-only evidence', async () => {
  const sql = await read('supabase/migrations/20260904055304_add_prediction_terminal_resolution_ledger.sql');
  assert.match(sql, /cfi_prediction_terminal_resolutions/);
  assert.match(sql, /POSTPONED/);
  assert.match(sql, /CANCELLED/);
  assert.match(sql, /ABANDONED/);
  assert.match(sql, /source_count integer not null check \(source_count >= 2\)/i);
  assert.match(sql, /immutable boolean not null default true/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all[^\n]*anon, authenticated/i);
});

test('daily audit excludes terminal fixtures from effective pending denominator', async () => {
  const sql = await read('supabase/migrations/20260904081757_make_daily_prediction_audit_terminal_aware.sql');
  assert.match(sql, /terminalExcluded/);
  assert.match(sql, /effectiveEligible/);
  assert.match(sql, /activePending/);
  assert.match(sql, /v_eligible := greatest\(v_selected-v_terminal,0\)/);
  assert.match(sql, /v_pending=0 and v_settled=v_eligible/);
});

test('verified alias identity groups only resolved canonical teams', async () => {
  const sql = await read('supabase/migrations/20260904095843_add_verified_alias_fixture_identity_v1.sql');
  assert.match(sql, /cfi_prediction_fixture_identity_v1/);
  assert.match(sql, /security_invoker\s*=\s*true/i);
  assert.match(sql, /cfi_resolve_team_name/);
  assert.match(sql, /fixture_identity_key/);
  assert.match(sql, /identity_resolved/);
  assert.match(sql, /selected_snapshot_count_for_fixture/);
  assert.match(sql, /selected_representative_snapshot_id/);
  assert.match(sql, /SNAPSHOT\|/);
});

test('daily audit is unique-fixture aware while preserving snapshot lineage', async () => {
  const sql = await read('supabase/migrations/20260904100012_make_prediction_audit_unique_fixture_aware.sql');
  assert.match(sql, /auditUnit','UNIQUE_FIXTURE'/);
  assert.match(sql, /cfi_prediction_fixture_identity_v1/);
  assert.match(sql, /selected_representative_snapshot_id/);
  assert.match(sql, /duplicateSelectedSnapshots/);
  assert.match(sql, /rawSelectedSnapshots/);
  assert.match(sql, /uniqueSelectedFixtures/);
  assert.match(sql, /terminalExcluded/);
  assert.match(sql, /activePending/);
  assert.match(sql, /v_unique_pending=0 and v_unique_settled=v_unique_eligible/);
});

test('PC result recovery never reclaims immutable terminal fixtures', async () => {
  const sql = await read('supabase/migrations/20260904093821_terminal_aware_pc_result_recovery_queue.sql');
  assert.match(sql, /cfi_enqueue_pc_result_recovery/);
  assert.match(sql, /cfi_claim_pc_result_recovery/);
  assert.match(sql, /not exists \([\s\S]*cfi_prediction_terminal_resolutions/);
  assert.match(sql, /status='CANCELLED'/);
  assert.match(sql, /TERMINAL_EXCLUDED:/);
  assert.match(sql, /status='SETTLED'/);
});

test('multimarket float metrics have an explicit finite float8 overload', async () => {
  const sql = await read('supabase/migrations/20260904011325_add_float8_isfinite_compat.sql');
  assert.match(sql, /function public\.isfinite\(p double precision\)/i);
  assert.match(sql, /'NaN'::double precision/);
  assert.match(sql, /'Infinity'::double precision/);
  assert.match(sql, /'-Infinity'::double precision/);
  assert.match(sql, /immutable/i);
});
