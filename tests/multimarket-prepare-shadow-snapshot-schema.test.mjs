import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_prepare_shadow_snapshot_v1.sql',import.meta.url),'utf8');

test('prospective Multi-Market preparer is strict-prior, calibrated and research-only',()=>{
  assert.match(sql,/cfi_research_prepare_multimarket_shadow_snapshot/i);
  assert.match(sql,/scoreline,expectedGoals,ftHome/i);
  assert.match(sql,/scoreline,expectedGoals,ftAway/i);
  assert.match(sql,/futureEvidenceCount/i);
  assert.match(sql,/sameDateEvidenceCount/i);
  assert.match(sql,/STRICT_PRIOR_MAX_EVIDENCE_INVALID/);
  assert.match(sql,/CFI_MULTI_MARKET_FROZEN_CAL_V1/);
  assert.match(sql,/decisionUse',false/i);
  assert.match(sql,/POISSON_0_20/);
  assert.match(sql,/on conflict\(fixture_id,model_fingerprint\) do nothing/i);
  assert.match(sql,/revoke execute on function public\.cfi_research_prepare_multimarket_shadow_snapshot\(uuid,uuid\) from public,anon,authenticated/i);
});
