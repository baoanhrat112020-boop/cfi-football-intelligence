import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const yml=fs.readFileSync(new URL('../.github/workflows/research-hf-group-a-shadow.yml',import.meta.url),'utf8');

test('existing HF Group A workflow remains manual-only and routes prospective work through one E2E autopilot command',()=>{
  assert.match(yml,/^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(yml,/^\s*(push|pull_request|schedule|workflow_run)\s*:/m);
  assert.match(yml,/npm run cfi:research:group-a:auto --[\s\S]*--write[\s\S]*--no-settle/);
  assert.doesNotMatch(yml,/node --experimental-strip-types research\/group-a-prospective-runner-v1\.mjs/);
  assert.match(yml,/CFI_GROUP_A_PROSPECTIVE_MAX_FIXTURES:\s*'20'/);
  assert.match(yml,/settlementWriterIncluded!==false/);
  assert.match(yml,/cfi_settle_forward_market_ready_v3_research/);
  assert.match(yml,/CFI_FORWARD_MARKET_SETTLEMENT_V3_RESEARCH/);
});

test('workflow verifies frozen state before any E2E prospective write',()=>{
  const verify=yml.indexOf('Verify HF result contract');
  const capture=yml.indexOf('Run Group A pre-kickoff capture and immutable audit');
  assert.ok(verify>=0&&capture>verify);
  assert.match(yml,/CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1/);
  assert.match(yml,/trainedThrough!=='2026-08-19'/);
});

test('pre-kickoff workflow requires immutable audit and explicitly defers broad settlement RPC',()=>{
  assert.match(yml,/immutableAuditPassed!==true/);
  assert.match(yml,/preKickoffSettlementPolicy!=='DEFER_TO_POST_KICKOFF_EXISTING_RPC'/);
  assert.match(yml,/settlementRequested!==false/);
  assert.match(yml,/settlement\?\.status!=='NOT_RUN_PREKICKOFF_CAPTURE'/);
  assert.match(yml,/settlement\?\.researchOnly!==true/);
  assert.match(yml,/settlement\?\.decisionUse!==false/);
  assert.match(yml,/settlement\?\.productionMutation!==false/);
});

test('workflow keeps minimal GitHub permission and no deploy command',()=>{
  assert.match(yml,/permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(yml,/contents:\s*write/);
  assert.doesNotMatch(yml,/wrangler\s+deploy/i);
  assert.doesNotMatch(yml,/supabase\s+(db|functions)\s+(push|deploy|reset)/i);
});
