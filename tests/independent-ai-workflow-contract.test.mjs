import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const testWorkflow=fs.readFileSync('.github/workflows/test.yml','utf8');
const aiWorkflow=fs.readFileSync('.github/workflows/cfi-independent-ai-auditor.yml','utf8');
const policy=fs.readFileSync('.github/cfi-independent-ai-review.md','utf8');

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

test('secret-bearing AI job cannot write contents or PRs and only writes a commit status',()=>{
  assert.match(aiWorkflow,/contents:\s*read/);
  assert.match(aiWorkflow,/pull-requests:\s*read/);
  assert.match(aiWorkflow,/statuses:\s*write/);
  assert.doesNotMatch(aiWorkflow,/contents:\s*write/);
  assert.doesNotMatch(aiWorkflow,/pull-requests:\s*write/);
  assert.match(aiWorkflow,/CLOUDFLARE_API_TOKEN/);
  assert.match(aiWorkflow,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(aiWorkflow,/@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(aiWorkflow,/cfi-publish-ai-audit-status\.mjs/);
  assert.doesNotMatch(aiWorkflow,/wrangler\s+deploy/);
  assert.doesNotMatch(aiWorkflow,/supabase\s+(db|functions)\s+(push|deploy)/);
});

test('bootstrap provider E2E is trusted-main only and automatically resolves the merged PR',()=>{
  assert.match(aiWorkflow,/push:/);
  assert.match(aiWorkflow,/branches:\s*\[main\]/);
  assert.match(aiWorkflow,/bootstrap-provider-e2e:/);
  assert.match(aiWorkflow,/github\.event_name == 'push'/);
  assert.match(aiWorkflow,/Re-run zero-AI deterministic gate on trusted main/);
  assert.match(aiWorkflow,/commits\/\$\{sha\}\/pulls/);
  assert.match(aiWorkflow,/ASSOCIATED_MERGED_PR_NOT_FOUND/);
  assert.match(aiWorkflow,/Enforce bootstrap AI verdict/);
});

test('independent review policy locks CFI integrity and structured verdict fields',()=>{
  for(const token of [
    'STRICT_PRIOR','SETTLEMENT_INTEGRITY','SHADOW_ISOLATION','MULTI_MARKET',
    'ARCHITECTURE','TEST_EVIDENCE','BLOCK_PROMOTION','END_CFI_AI_AUDIT_V1',
    'NO_AUTO_PRODUCTION_PROMOTION',
  ]) assert.match(policy,new RegExp(token));
  assert.match(policy,/reconstruct historical predictions/i);
});
