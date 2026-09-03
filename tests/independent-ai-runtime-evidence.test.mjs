import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const policy=fs.readFileSync('.github/cfi-independent-ai-review.md','utf8');
const aiWorkflow=fs.readFileSync('.github/workflows/cfi-independent-ai-auditor.yml','utf8');
const testWorkflow=fs.readFileSync('.github/workflows/test.yml','utf8');

test('AI review policy grounds compatibility findings in observed trusted runtime evidence',()=>{
  assert.match(policy,/CURRENT_NODE_BASELINE/);
  assert.match(policy,/actions\/setup-node@v4/);
  assert.match(policy,/node-version: 24/);
  assert.match(policy,/EVIDENCE_GROUNDING/);
  assert.match(policy,/successful current trusted execution evidence/i);
  assert.match(policy,/does not prove that unrelated deployment logic is correct/i);
});

test('trusted CFI test and AI auditor workflows remain on the Node 24 baseline named by policy',()=>{
  for(const workflow of [aiWorkflow,testWorkflow]){
    assert.match(workflow,/uses: actions\/setup-node@v4/);
    assert.match(workflow,/node-version: 24/);
  }
});
