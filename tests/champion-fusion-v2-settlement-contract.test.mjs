import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../supabase/functions/cfi-multimarket-settlement-eval/index.ts',import.meta.url),'utf8');

test('V2 challenger settlement requires immutable prematch challenger snapshot',()=>{
  assert.match(src,/CFI_CHAMPION_FUSION_V2_CHALLENGER_SETTLEMENT_V1_TOP1/);
  assert.match(src,/CFI_MULTI_MARKET_CHAMPION_FUSION_V2_CHALLENGER/);
  assert.match(src,/pred\?\.championFusionChallenger/);
  assert.match(src,/IMMUTABLE_CHAMPION_FUSION_V2_CHALLENGER_SNAPSHOT_PLUS_SETTLED_ACTUAL/);
  assert.match(src,/championFusionChallengerEvaluation/);
  assert.match(src,/championFusionChallengerPair/);
  assert.match(src,/prospectiveOnly:true/);
  assert.match(src,/reconstructed:false/);
  assert.match(src,/challengerProspectiveOnly:true/);
  assert.match(src,/sameCohortPromotionAllowed:false/);
  assert.doesNotMatch(src,/buildMultiMarketChampionFusionV2Challenger\s*\(/);
  assert.doesNotMatch(src,/buildPrediction\s*\(/);
});

test('V2 challenger settlement remains Top-1-only and decisionUse false',()=>{
  assert.match(src,/scorelineContract:'TOP1_HT_PLUS_TOP1_FT'/);
  assert.match(src,/decisionUse:false/);
  assert.match(src,/top1Only:true/);
  assert.doesNotMatch(src,/Champion-Fusion-V2-Challenger-Multi-Market'[\s\S]*?top3\s*:/);
});
