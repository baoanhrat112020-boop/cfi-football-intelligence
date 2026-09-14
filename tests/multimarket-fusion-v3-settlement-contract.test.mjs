import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../supabase/functions/cfi-multimarket-settlement-eval/index.ts',import.meta.url),'utf8');

test('Fusion V3 settlement requires immutable strict-prior shadow snapshot',()=>{
  assert.match(src,/CFI_MULTI_MARKET_FUSION_V3_SETTLEMENT_V1_TOP1/);
  assert.match(src,/CFI_MULTI_MARKET_FUSION_V3/);
  assert.match(src,/pred\?\.multiMarketFusionV3/);
  assert.match(src,/IMMUTABLE_MULTI_MARKET_FUSION_V3_SNAPSHOT_PLUS_SETTLED_ACTUAL/);
  assert.match(src,/researchOnly!==true/);
  assert.match(src,/decisionUse!==false/);
  assert.match(src,/productionEligible!==false/);
  assert.match(src,/strictPrior\?\.verified!==true/);
  assert.match(src,/trajectory\?\.status!=='PASS'/);
  assert.match(src,/coherence\?\.status!=='PASS'/);
  assert.match(src,/reconstructed=false/);
  assert.doesNotMatch(src,/buildMultiMarketFusionV3\s*\(/);
  assert.doesNotMatch(src,/buildPrediction\s*\(/);
});

test('Fusion V3 settlement produces paired incumbent V1 V2 deltas without decision authority',()=>{
  assert.match(src,/multiMarketFusionV3Evaluation/);
  assert.match(src,/multiMarketFusionV3Pair/);
  assert.match(src,/deltaVsIncumbent/);
  assert.match(src,/deltaVsV1/);
  assert.match(src,/deltaVsV2/);
  assert.match(src,/pairedFusionV3Evaluation:true/);
  assert.match(src,/fusionV3ProspectiveOnly:true/);
  assert.match(src,/decisionUse:false/);
  assert.match(src,/scorelineContract:'TOP1_HT_PLUS_TOP1_FT'/);
});
