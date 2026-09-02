import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src=readFileSync(new URL('../cloudflare-worker/src/index-gpt-core-v4.ts',import.meta.url),'utf8');

test('GPT Core V4 compact prediction exposes both Fusion V1 and V2 challenger',()=>{
  assert.match(src,/championFusion:compactFusion\(body\?\.championFusion\)/);
  assert.match(src,/championFusionChallenger:compactFusion\(body\?\.championFusionChallenger\)/);
});

test('compact trimming must not drop top-level Fusion V2 challenger',()=>{
  assert.doesNotMatch(src,/delete\s+compact\.championFusionChallenger/);
});

test('V2 compact projection reuses fail-closed Fusion projection semantics',()=>{
  assert.match(src,/decisionUse:value\.decisionUse===true/);
  assert.match(src,/productionEligible:value\.productionEligible===true/);
  assert.match(src,/promotionRequired:value\.promotionRequired===true/);
  assert.match(src,/scorelineContract:value\.scorelineContract\?\?null/);
  assert.match(src,/researchProtocol:value\.researchProtocol\?\?null/);
  assert.match(src,/strictPrior:value\.strictPrior\?\?value\.strictPriorAudit\?\?null/);
  assert.match(src,/coherence:value\.coherence\?\?value\?\.multiMarket\?\.consistencyGuard\?\?null/);
});
