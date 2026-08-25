import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/sql/cfi_k048_research_prediction_bridge_v2.sql',import.meta.url),'utf8');

test('K048 V2 bridge accepts exactly one immutable strict-prior research lineage',()=>{
  assert.match(sql,/research_prediction_snapshot_id uuid null\s+references public\.cfi_research_prematch_snapshots/i);
  assert.match(sql,/alter column prediction_snapshot_id drop not null/i);
  assert.match(sql,/num_nonnulls\(prediction_snapshot_id,research_prediction_snapshot_id\)=1/i);
  assert.match(sql,/CFI_K048_TRAJECTORY_JOINT_V2_FULL_SUPPORT/);
  assert.match(sql,/K048_RESEARCH_PREDICTION_NOT_READY/);
  assert.match(sql,/K048_RESEARCH_PREDICTION_TEMPORAL_INVALID/);
  assert.match(sql,/r\.created_at >= r\.kickoff_at/i);
  assert.match(sql,/r\.max_evidence_date >= r\.target_date/i);
  assert.match(sql,/K048_RESEARCH_PREDICTION_FIXTURE_MISMATCH/);
  assert.match(sql,/K048_MARKET_FIXTURE_LINEAGE_MISMATCH/);
  assert.match(sql,/m\.verified_fixture_id is distinct from r\.fixture_id/i);
  assert.match(sql,/m\.research_only is not true/i);
  assert.match(sql,/revoke execute on function public\.cfi_k048_snapshot_lineage_guard\(\) from public,anon,authenticated/i);
  assert.match(sql,/before insert or update on public\.cfi_k048_shadow_snapshots/i);
});
