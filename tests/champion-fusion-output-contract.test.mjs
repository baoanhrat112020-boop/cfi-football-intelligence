import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const compact=fs.readFileSync(new URL('../cloudflare-worker/src/discovery-compact.ts',import.meta.url),'utf8');
const v50=fs.readFileSync(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
const outputV3=fs.readFileSync(new URL('../src/presentation/cfi-output-v3.ts',import.meta.url),'utf8');

test('Champion Fusion is visible across single-match and compact discovery outputs',()=>{
  assert.match(v50,/CHAMPION FUSION V1:/);
  assert.match(compact,/championFusion:compactChampionFusion/);
  assert.match(outputV3,/championFusionView/);
  assert.match(outputV3,/CHAMPION FUSION:/);
  assert.match(outputV3,/decisionUse:false/);
});
