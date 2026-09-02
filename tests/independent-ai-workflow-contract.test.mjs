import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/test.yml','utf8');
const instructions=fs.readFileSync('.github/copilot-instructions.md','utf8');

test('independent AI review runs only after zero-AI deterministic CFI gate',()=>{
  assert.match(workflow,/Zero-AI deterministic CFI gate/);
  assert.match(workflow,/node tools\/cfi-audit\.mjs --full --no-cache/);
  assert.match(workflow,/independent-ai-review:/);
  assert.match(workflow,/needs: test/);
  assert.match(workflow,/tools\/cfi-independent-ai-auditor\.mjs/);
});

test('independent AI job has no production-content write or deploy step',()=>{
  assert.doesNotMatch(workflow,/contents:\s*write/);
  assert.doesNotMatch(workflow,/wrangler\s+deploy(?!\s+--dry-run)/);
  assert.doesNotMatch(workflow,/supabase\s+(db|functions)\s+(push|deploy)/);
  assert.match(workflow,/pull-requests:\s*write/);
});

test('Copilot review instructions lock CFI integrity and structured verdict fields',()=>{
  for(const token of [
    'STRICT_PRIOR',
    'SETTLEMENT_INTEGRITY',
    'SHADOW_ISOLATION',
    'MULTI_MARKET',
    'ARCHITECTURE',
    'TEST_EVIDENCE',
    'BLOCK_PROMOTION',
    'END_CFI_AI_AUDIT_V1',
    'NO_AUTO_PRODUCTION_PROMOTION',
  ]) assert.match(instructions,new RegExp(token));
  assert.match(instructions,/do not reconstruct historical predictions/i);
});
