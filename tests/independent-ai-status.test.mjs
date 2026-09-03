import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_CONTEXT, statusPayloadFromReport } from '../tools/cfi-publish-ai-audit-status.mjs';

const baseSha='a'.repeat(40);
const diffSha256='b'.repeat(64);

function report(verdict,reason){
  return {verdict,reason,baseSha,diffSha256};
}

test('attested PASS maps to successful PR-head status',()=>{
  const payload=statusPayloadFromReport(report('PASS','AI_AUDIT_CLEAR'),'https://example.test/run');
  assert.equal(payload.state,'success');
  assert.equal(payload.context,STATUS_CONTEXT);
  assert.equal(payload.target_url,'https://example.test/run');
  assert.equal(payload.description,`PASS base=${baseSha} diff=${diffSha256}`);
});

test('unattested PASS fails closed instead of publishing success',()=>{
  const payload=statusPayloadFromReport({verdict:'PASS',reason:'AI_AUDIT_CLEAR'});
  assert.equal(payload.state,'error');
  assert.equal(payload.context,STATUS_CONTEXT);
  assert.equal(payload.description,'PASS_ATTESTATION_INVALID');
});

test('FIX_REQUIRED and BLOCK_PROMOTION map to failure',()=>{
  assert.equal(statusPayloadFromReport(report('FIX_REQUIRED','P2_FIX_REQUIRED')).state,'failure');
  assert.equal(statusPayloadFromReport(report('BLOCK_PROMOTION','STRICT_PRIOR:FAIL')).state,'failure');
});

test('missing or unreadable report maps fail-closed to error',()=>{
  const payload=statusPayloadFromReport(null);
  assert.equal(payload.state,'error');
  assert.equal(payload.context,'CFI Independent AI Auditor V1');
  assert.match(payload.description,/MISSING/);
});

test('status description is bounded for GitHub API',()=>{
  const payload=statusPayloadFromReport(report('BLOCK_PROMOTION','X'.repeat(500)));
  assert.ok(payload.description.length<=140);
});
