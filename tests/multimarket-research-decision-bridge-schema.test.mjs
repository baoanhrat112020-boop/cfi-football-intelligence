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

test('research duplicate guard is per verified fixture and frozen model fingerprint',()=>{
  assert.match(sql,/select fixture_id,kickoff_at,status,strict_prior,created_at,max_evidence_date,target_date,model_name,model_fingerprint/i);
  assert.match(sql,/CFI_RESEARCH_MODEL_FINGERPRINT_REQUIRED/);
  assert.match(sql,/join public\.cfi_research_prematch_snapshots rp on rp\.snapshot_id=d\.research_prediction_snapshot_id/i);
  assert.match(sql,/m\.verified_fixture_id=m_verified[\s\S]*rp\.model_fingerprint=r\.model_fingerprint/i);
  assert.match(sql,/CFI_VERIFIED_FIXTURE_MODEL_DECISION_ALREADY_EXISTS/);
});

test('production lineage keeps one decision per verified fixture',()=>{
  assert.match(sql,/d\.prediction_snapshot_id is not null/i);
  assert.match(sql,/CFI_VERIFIED_FIXTURE_DECISION_ALREADY_EXISTS/);
});
