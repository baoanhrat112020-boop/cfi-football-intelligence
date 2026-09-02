import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const yml=fs.readFileSync(new URL('../.github/workflows/research-hf-group-a-shadow.yml',import.meta.url),'utf8');

test('existing HF Group A workflow remains manual-only and performs research-only prospective capture',()=>{
  assert.match(yml,/^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(yml,/^\s*(push|pull_request|schedule|workflow_run)\s*:/m);
  assert.match(yml,/group-a-prospective-runner-v1\.mjs[\s\S]*--write/);
  assert.match(yml,/CFI_GROUP_A_PROSPECTIVE_MAX_FIXTURES:\s*'20'/);
  assert.match(yml,/settlementWriterIncluded!==false/);
  assert.match(yml,/EXISTING_APPEND_ONLY_CFI_MARKET_DECISION_SETTLEMENTS/);
});

test('workflow verifies frozen state before any prospective write',()=>{
  const verify=yml.indexOf('Verify HF result contract');
  const capture=yml.indexOf('Capture future Group A prospective cohort');
  assert.ok(verify>=0&&capture>verify);
  assert.match(yml,/CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1/);
  assert.match(yml,/trainedThrough!=='2026-08-19'/);
});

test('workflow keeps minimal GitHub permission and no deploy command',()=>{
  assert.match(yml,/permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(yml,/contents:\s*write/);
  assert.doesNotMatch(yml,/wrangler\s+deploy/i);
  assert.doesNotMatch(yml,/supabase\s+(db|functions)\s+(push|deploy|reset)/i);
});
