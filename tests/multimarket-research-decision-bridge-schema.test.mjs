import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_research_decision_bridge_v1.sql',import.meta.url),'utf8');

test('research decision bridge is strict-prior, fixture-bound and backward compatible',()=>{
  assert.match(sql,/research_prediction_snapshot_id uuid null references public\.cfi_research_prematch_snapshots/i);
  assert.match(sql,/alter column prediction_snapshot_id drop not null/i);
  assert.match(sql,/num_nonnulls\(prediction_snapshot_id,research_prediction_snapshot_id\)=1/i);
  assert.match(sql,/CFI_RESEARCH_PREDICTION_NOT_READY/);
  assert.match(sql,/CFI_RESEARCH_PREDICTION_TEMPORAL_INVALID/);
  assert.match(sql,/CFI_DECISION_FIXTURE_MISMATCH/);
  assert.match(sql,/r\.max_evidence_date >= r\.target_date/i);
  assert.match(sql,/r\.created_at >= r\.kickoff_at/i);
  assert.match(sql,/revoke execute on function public\.cfi_decision_snapshot_temporal_guard\(\) from public,anon,authenticated/i);
});
