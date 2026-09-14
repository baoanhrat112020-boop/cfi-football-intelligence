import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production prematch wrapper feeds already-verified BigDB payload into Fusion V3 shadow',async()=>{
  const source=await readFile(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
  assert.match(source,/const big=await fetchBigDb\(env,\{home,away,target_date:targetDate\}\)/);
  assert.match(source,/const temporal=temporalEvidenceAudit\(big,targetDate\)/);
  assert.match(source,/if\(!temporal\.verified\)/);
  assert.match(source,/buildPrediction\(\{home:predictionHome,away:predictionAway,targetDate,language:String\(input\?\.language\|\|'vi'\),homePayload,awayPayload,h2hPayload,bigDbContext:big\}\)/);
  assert.match(source,/multiMarketFusionV3:prediction\?\.multiMarketFusionV3\?\.version\?\?null/);
});

test('Fusion V3 remains absent from production decision authority',async()=>{
  const source=await readFile(new URL('../src/prediction/multi-market-fusion-v3.ts',import.meta.url),'utf8');
  assert.match(source,/researchOnly:true/);
  assert.match(source,/decisionUse:false/);
  assert.match(source,/productionEligible:false/);
  assert.match(source,/championMutation:false/);
});
