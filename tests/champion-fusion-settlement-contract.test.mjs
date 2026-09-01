import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../supabase/functions/cfi-multimarket-settlement-eval/index.ts',import.meta.url),'utf8');

test('Champion Fusion settlement is paired, immutable and Top-1-only for new evidence',()=>{
  assert.match(src,/CFI_CHAMPION_FUSION_SETTLEMENT_V2_TOP1/);
  assert.match(src,/TOP1_HT_PLUS_TOP1_FT/);
  assert.match(src,/IMMUTABLE_CHAMPION_FUSION_SNAPSHOT_PLUS_SETTLED_ACTUAL/);
  assert.match(src,/championFusionEvaluation/);
  assert.match(src,/championFusionPair/);
  assert.match(src,/pairedFusionEvaluation:true/);
  assert.match(src,/noPredictionReconstruction:true/);
  assert.match(src,/legacySnapshotsReadOnlyCompatibility:true/);
  assert.match(src,/top1Only:true/);
  assert.match(src,/decisionUse:false/);
  assert.doesNotMatch(src,/buildPrediction\s*\(/);
  assert.doesNotMatch(src,/marketBrier\['Champion-Fusion-Multi-Market'\][\s\S]*?top3\s*:/);
});

test('legacy ranked snapshots may only be read as first-rank Top-1 compatibility',()=>{
  assert.match(src,/LEGACY_SNAPSHOT_FIRST_RANK_AS_TOP1/);
  assert.match(src,/INCUMBENT_LEGACY_FIRST_RANK_AS_TOP1/);
  assert.match(src,/legacyCompatibilityUsed/);
  assert.match(src,/const legacy=c\?\.\[period==='ht'\?'top3HT':'top3FT'\]/);
});
