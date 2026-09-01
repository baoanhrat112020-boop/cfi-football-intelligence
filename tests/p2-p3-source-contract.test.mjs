import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P2 settlement evaluator is immutable-snapshot based and fail-closed for legacy snapshots',()=>{
  const s=readFileSync(new URL('../supabase/functions/cfi-multimarket-settlement-eval/index.ts',import.meta.url),'utf8');
  for(const token of ['CFI_MULTI_MARKET_SETTLEMENT_V2','IMMUTABLE_PREDICTION_SNAPSHOT_PLUS_SETTLED_ACTUAL','skippedLegacy','decisionUse:false','CFI_MULTI_MARKET_V1']) assert.ok(s.includes(token),token);
  assert.ok(!s.includes('buildPrediction('),'must never reconstruct prediction');
});

test('P3 backfill adds verified missing divisions and reuses existing cron',()=>{
  const s=readFileSync(new URL('../supabase/functions/cfi-historical-backfill/index.ts',import.meta.url),'utf8');
  for(const division of ['EC','SC1','SC2','SC3']) assert.match(s,new RegExp(`division_code:\\s*["']${division}["']`),`division_code:${division}`);
  for(const token of ['CFI_BIGDB_SOURCE_EXPANSION_V1','cfi_mm_historical_v2_runs','cfi-multimarket-settlement-eval']) assert.ok(s.includes(token),token);
});
