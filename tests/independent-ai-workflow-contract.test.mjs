import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const testWorkflow=fs.readFileSync('.github/workflows/test.yml','utf8');
const aiWorkflow=fs.readFileSync('.github/workflows/cfi-independent-ai-auditor.yml','utf8');
const instructions=fs.readFileSync('.github/copilot-instructions.md','utf8');

test('PR workflow is secret-free and runs zero-AI deterministic CFI gate',()=>{
  assert.match(testWorkflow,/Zero-AI deterministic CFI gate/);
  assert.match(testWorkflow,/node tools\/cfi-audit\.mjs --full --no-cache/);
  assert.doesNotMatch(testWorkflow,/CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(testWorkflow,/independent-ai-review:/);
});

test('independent AI review is downstream of successful CFI Tests and checks out trusted default branch',()=>{
  assert.match(aiWorkflow,/workflow_run:/);
  assert.match(aiWorkflow,/workflows:\s*\["CFI Tests"\]/);
  assert.match(aiWorkflow,/workflow_run\.conclusion == 'success'/);
  assert.match(aiWorkflow,/Checkout trusted auditor from default branch/);
  assert.match(aiWorkflow,/ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(aiWorkflow,/persist-credentials:\s*false/);
  assert.match(aiWorkflow,/actions\/download-artifact@v4/);
});

test('independent AI job is read-only and uses Cloudflare Workers AI secrets without deploy authority',()=>{
  assert.match(aiWorkflow,/contents:\s*read/);
  assert.match(aiWorkflow,/pull-requests:\s*read/);
  assert.doesNotMatch(aiWorkflow,/contents:\s*write/);
  assert.doesNotMatch(aiWorkflow,/pull-requests:\s*write/);
  assert.match(aiWorkflow,/CLOUDFLARE_API_TOKEN/);
  assert.match(aiWorkflow,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(aiWorkflow,/@cf\/zai-org\/glm-4\.7-flash/);
  assert.doesNotMatch(aiWorkflow,/wrangler\s+deploy/);
  assert.doesNotMatch(aiWorkflow,/supabase\s+(db|functions)\s+(push|deploy)/);
});

test('independent review instructions lock CFI integrity and structured verdict fields',()=>{
  for(const token of [
    'STRICT_PRIOR','SETTLEMENT_INTEGRITY','SHADOW_ISOLATION','MULTI_MARKET',
    'ARCHITECTURE','TEST_EVIDENCE','BLOCK_PROMOTION','END_CFI_AI_AUDIT_V1',
    'NO_AUTO_PRODUCTION_PROMOTION',
  ]) assert.match(instructions,new RegExp(token));
  assert.match(instructions,/do not reconstruct historical predictions/i);
});
