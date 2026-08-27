import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../supabase/functions/cfi-multimarket-settlement-eval/index.ts',import.meta.url),'utf8');

test('Champion Fusion settlement is paired, immutable and non-reconstructive',()=>{
  assert.match(src,/IMMUTABLE_CHAMPION_FUSION_SNAPSHOT_PLUS_SETTLED_ACTUAL/);
  assert.match(src,/championFusionEvaluation/);
  assert.match(src,/championFusionPair/);
  assert.match(src,/pairedFusionEvaluation:true/);
  assert.match(src,/noPredictionReconstruction:true/);
  assert.match(src,/decisionUse:false/);
});
