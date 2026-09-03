import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUDIT_CONTEXT, latestAuditStatus, classifyAuditStatuses } from '../tools/cfi-main-merge-guard.mjs';

const workflow = fs.readFileSync('.github/workflows/cfi-main-merge-guard.yml', 'utf8');

test('main merge guard requires the exact independent AI context', () => {
  assert.equal(AUDIT_CONTEXT, 'CFI Independent AI Auditor V1');
  assert.equal(classifyAuditStatuses([]).outcome, 'WAIT');
  assert.equal(classifyAuditStatuses([{ context: 'Other Check', state: 'success' }]).outcome, 'WAIT');
});

test('main merge guard accepts only success and fails closed on failure/error', () => {
  assert.equal(classifyAuditStatuses([{ context: AUDIT_CONTEXT, state: 'success' }]).outcome, 'PASS');
  assert.equal(classifyAuditStatuses([{ context: AUDIT_CONTEXT, state: 'pending' }]).outcome, 'WAIT');
  assert.equal(classifyAuditStatuses([{ context: AUDIT_CONTEXT, state: 'failure' }]).outcome, 'FAIL');
  assert.equal(classifyAuditStatuses([{ context: AUDIT_CONTEXT, state: 'error' }]).outcome, 'FAIL');
});

test('latest status for the audited head wins', () => {
  const latest = latestAuditStatus([
    { context: AUDIT_CONTEXT, state: 'failure', created_at: '2026-09-03T00:00:00Z' },
    { context: AUDIT_CONTEXT, state: 'success', created_at: '2026-09-03T00:01:00Z' },
  ]);
  assert.equal(latest.state, 'success');
});

test('post-merge workflow is read-only and does not run another AI pipeline', () => {
  assert.match(workflow, /name:\s*CFI Main Merge Guard/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.match(workflow, /statuses:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /statuses:\s*write/);
  assert.doesNotMatch(workflow, /CLOUDFLARE/);
  assert.doesNotMatch(workflow, /cfi-independent-ai-auditor\.mjs/);
  assert.match(workflow, /cfi-main-merge-guard\.mjs/);
});
