import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');
const instructions=readFileSync(new URL('../gpt-action/CFI_GPT_INSTRUCTIONS.md',import.meta.url),'utf8');
const schema=readFileSync(new URL('../gpt-action/openapi.yaml',import.meta.url),'utf8');

test('zero exact-team evidence fails closed before normal prediction rendering',()=>{
  assert.match(worker,/ZERO_EXACT_TEAM_EVIDENCE/);
  assert.match(worker,/INSUFFICIENT_DATA/);
  assert.match(worker,/zeroEvidenceGuard/);
  assert.match(worker,/return Response\.json\(body,\{status:422\}\)/);
});

test('countdown is prematch and target_date must be supplied by the action layer',()=>{
  assert.match(instructions,/COUNTDOWN TO KICKOFF/);
  assert.match(instructions,/imminent fixture/i);
  assert.match(instructions,/current local calendar date/i);
  assert.match(instructions,/fixture several days away/i);
  assert.match(instructions,/do not send a `TARGET_DATE_REQUIRED` question/i);
  assert.match(schema,/required:\s*\[home, away, target_date\]/);
});

test('live action is exposed separately from prematch',()=>{
  assert.match(schema,/\/api\/predict-live:/);
  assert.match(schema,/operationId:\s*cfiPredictLive/);
});
