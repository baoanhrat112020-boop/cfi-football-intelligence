import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../gpt-action/CFI_GPT_INSTRUCTIONS.md',import.meta.url),'utf8');
const policy=readFileSync(new URL('../gpt-action/COUNTDOWN_ROUTING_POLICY.md',import.meta.url),'utf8');

test('countdown is prematch and keeps historical retrieval',()=>{
  assert.match(main,/COUNTDOWN TO KICKOFF/);
  assert.match(main,/PREMATCH/);
  assert.match(main,/retrieve strict-prior historical HOME\/AWAY\/H2H evidence normally/);
  assert.match(policy,/Countdown does not disable historical retrieval/);
});

test('countdown resolves nearest imminent kickoff date rather than distant fixture',()=>{
  assert.match(policy,/nearest upcoming kickoff/);
  assert.match(policy,/current local date/);
  assert.match(policy,/crosses local midnight/);
  assert.match(policy,/Do not select a fixture several days away/);
});

test('live routing requires positive evidence play started',()=>{
  assert.match(policy,/positive evidence that play has started/);
  assert.match(policy,/running match minute\/period/);
});

test('0\/0\/0 exact-team evidence fails closed instead of global-prior output',()=>{
  assert.match(policy,/0\/0\/0/);
  assert.match(policy,/Do not silently replace match-specific evidence with global priors/);
});
