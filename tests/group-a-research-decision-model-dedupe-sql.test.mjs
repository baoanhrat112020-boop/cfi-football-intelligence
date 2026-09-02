import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/sql/cfi_group_a_research_decision_model_dedupe_v1.sql',import.meta.url),'utf8');

test('Group A decision dedupe delta only replaces the existing trigger function',()=>{
  assert.match(sql,/create or replace function public\.cfi_decision_snapshot_temporal_guard\(\)/i);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/set search_path=public/i);
  assert.doesNotMatch(sql,/\b(create|alter|drop)\s+table\b/i);
  assert.doesNotMatch(sql,/\bcreate\s+policy\b/i);
  assert.doesNotMatch(sql,/\balter\s+policy\b/i);
  assert.doesNotMatch(sql,/\binsert\s+into\s+public\.cfi_prediction_snapshots\b/i);
  assert.doesNotMatch(sql,/\bupdate\s+public\.cfi_prediction_snapshots\b/i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.cfi_prediction_snapshots\b/i);
});

test('research uniqueness is per verified fixture plus model fingerprint',()=>{
  assert.match(sql,/join public\.cfi_research_prematch_snapshots rp on rp\.snapshot_id=d\.research_prediction_snapshot_id/i);
  assert.match(sql,/m\.verified_fixture_id=m_verified[\s\S]*rp\.model_fingerprint=r\.model_fingerprint/i);
  assert.match(sql,/CFI_VERIFIED_FIXTURE_MODEL_DECISION_ALREADY_EXISTS/);
  assert.match(sql,/CFI_RESEARCH_MODEL_FINGERPRINT_REQUIRED/);
});

test('strict-prior, temporal, fixture and production-lineage guards remain intact',()=>{
  for(const code of [
    'CFI_VERIFIED_FIXTURE_MARKET_REQUIRED',
    'CFI_CLOSING_PRICE_NOT_ALLOWED_FOR_PREMATCH_DECISION',
    'CFI_DECISION_MUST_PRECEDE_KICKOFF',
    'CFI_RESEARCH_PREDICTION_NOT_READY',
    'CFI_RESEARCH_PREDICTION_TEMPORAL_INVALID',
    'CFI_DECISION_FIXTURE_MISMATCH',
    'CFI_STRICT_PRIOR_PREDICTION_REQUIRED',
    'CFI_PREDICTION_MUST_PRECEDE_KICKOFF',
    'CFI_VERIFIED_FIXTURE_DECISION_ALREADY_EXISTS',
  ]) assert.match(sql,new RegExp(code));
  assert.match(sql,/d\.prediction_snapshot_id is not null/i);
  assert.match(sql,/revoke execute on function public\.cfi_decision_snapshot_temporal_guard\(\) from public,anon,authenticated/i);
});
