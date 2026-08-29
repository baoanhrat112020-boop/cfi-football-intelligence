import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const worker=readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');
const instructions=readFileSync(new URL('../gpt-action/CFI_GPT_INSTRUCTIONS.md',import.meta.url),'utf8');
const schemaText=readFileSync(new URL('../gpt-action/openapi.yaml',import.meta.url),'utf8');
const schema=parse(schemaText);

test('zero exact-team evidence fails closed before normal prediction rendering',()=>{
  assert.match(worker,/ZERO_EXACT_TEAM_EVIDENCE/);
  assert.match(worker,/INSUFFICIENT_DATA/);
  assert.match(worker,/zeroEvidenceGuard/);
  assert.match(worker,/return Response\.json\(body,\{status:422\}\)/);
});

test('countdown remains prematch and direct prediction requires target_date',()=>{
  assert.match(instructions,/Countdown\/warm-up\/lineups = PREMATCH/);
  assert.match(instructions,/resolve target_date nếu đủ thông tin/);
  assert.match(instructions,/Chỉ gọi cfiPredictLive khi có running minute/);
  const predict=schema.paths['/api/predict'].post.requestBody.content['application/json'].schema;
  assert.deepEqual(predict.required,['home','away','target_date']);
});

test('live action is exposed separately from prematch',()=>{
  assert.equal(schema.paths['/api/predict-live'].post.operationId,'cfiPredictLive');
  assert.deepEqual(schema.paths['/api/predict-live'].post.requestBody.content['application/json'].schema.required,['home','away','target_date','live']);
});
