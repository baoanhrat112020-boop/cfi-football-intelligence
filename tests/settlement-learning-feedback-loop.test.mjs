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

test('live calibration learner is settlement-only and blocks promotion on partial coverage', async () => {
  const src = await read('supabase/functions/cfi-calibration-learn/index.ts');
  assert.match(src, /CFI_CAL_LEARNER_V3_1_LIVE_FEEDBACK/);
  assert.match(src, /SETTLED_PRODUCTION/);
  assert.match(src, /NO_NEW_SELECTED_SETTLEMENTS/);
  assert.match(src, /coverage>=\.90/);
  assert.match(src, /RECENT_SETTLEMENT_COVERAGE_INCOMPLETE/);
  assert.match(src, /partialLabelsBlockedFromPromotion:true/);
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
