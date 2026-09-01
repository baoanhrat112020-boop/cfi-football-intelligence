import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.github/workflows');
const researchFiles = fs.readdirSync(root)
  .filter(name => /^research-.*\.ya?ml$/i.test(name))
  .sort();

function source(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

test('research workflows are manual-only and cannot consume quota automatically', () => {
  assert.ok(researchFiles.length > 0, 'RESEARCH_WORKFLOWS_REQUIRED');
  for (const name of researchFiles) {
    const text = source(name);
    assert.match(text, /\bworkflow_dispatch\s*:/, `${name}: WORKFLOW_DISPATCH_REQUIRED`);
    assert.doesNotMatch(text, /^\s*(push|pull_request|schedule|workflow_run)\s*:/m, `${name}: AUTO_TRIGGER_FORBIDDEN`);
  }
});

test('research workflows cannot deploy or mutate production infrastructure', () => {
  const forbidden = [
    /\bwrangler\s+deploy\b/i,
    /\bwrangler\s+secret\s+put\b/i,
    /\bsupabase\s+functions\s+deploy\b/i,
    /\bsupabase\s+db\s+(push|reset)\b/i,
    /\bCFI_ACTION_KEY\b/,
    /\bCLOUDFLARE_API_TOKEN\b/,
    /\bCLOUDFLARE_ACCOUNT_ID\b/,
  ];
  for (const name of researchFiles) {
    const text = source(name);
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${name}: PRODUCTION_MUTATION_PATH_FORBIDDEN:${pattern}`);
    }
  }
});

test('research workflows keep minimal GitHub permissions', () => {
  for (const name of researchFiles) {
    const text = source(name);
    assert.match(text, /permissions:\s*\n\s*contents:\s*read\b/m, `${name}: CONTENTS_READ_ONLY_REQUIRED`);
    assert.doesNotMatch(text, /contents:\s*write\b/i, `${name}: CONTENTS_WRITE_FORBIDDEN`);
  }
});
