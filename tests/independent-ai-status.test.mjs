import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_CONTEXT, statusPayloadFromReport } from '../tools/cfi-publish-ai-audit-status.mjs';

test('PASS maps to successful PR-head status',()=>{
  const payload=statusPayloadFromReport({verdict:'PASS',reason:'AI_AUDIT_CLEAR'},'https://example.test/run');
  assert.equal(payload.state,'success');
  assert.equal(payload.context,STATUS_CONTEXT);
  assert.equal(payload.target_url,'https://example.test/run');
  assert.match(payload.description,/PASS/);
});

test('FIX_REQUIRED and BLOCK_PROMOTION map to failure',()=>{
  assert.equal(statusPayloadFromReport({verdict:'FIX_REQUIRED',reason:'P2_FIX_REQUIRED'}).state,'failure');
  assert.equal(statusPayloadFromReport({verdict:'BLOCK_PROMOTION',reason:'STRICT_PRIOR:FAIL'}).state,'failure');
});

test('missing or unreadable report maps fail-closed to error',()=>{
  const payload=statusPayloadFromReport(null);
  assert.equal(payload.state,'error');
  assert.equal(payload.context,'CFI Independent AI Auditor V1');
  assert.match(payload.description,/MISSING/);
});

test('status description is bounded for GitHub API',()=>{
  const payload=statusPayloadFromReport({verdict:'BLOCK_PROMOTION',reason:'X'.repeat(500)});
  assert.ok(payload.description.length<=140);
});
