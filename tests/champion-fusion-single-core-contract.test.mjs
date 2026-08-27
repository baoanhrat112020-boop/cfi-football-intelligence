import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const finalEngine=fs.readFileSync(new URL('../src/prediction/final-engine.ts',import.meta.url),'utf8');
const v50=fs.readFileSync(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
const duplicateUrl=new URL('../src/prediction/multi-market-champion-fusion-v1.ts',import.meta.url);

test('Champion Fusion has exactly one production prediction entrypoint',()=>{
  assert.equal(fs.existsSync(duplicateUrl),false);
  assert.match(finalEngine,/buildMultiMarketChampionFusion\(/);
  assert.match(finalEngine,/championFusion/);
  assert.doesNotMatch(v50,/buildChampionFusionV1\(/);
  assert.doesNotMatch(v50,/buildMultiMarketChampionFusion\(/);
  assert.match(v50,/championFusion is produced inside buildPrediction/);
});
