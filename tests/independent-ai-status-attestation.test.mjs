import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_CONTEXT,
  auditAttestationFromReport,
  statusPayloadFromReport,
} from '../tools/cfi-publish-ai-audit-status.mjs';

const baseSha = 'a'.repeat(40);
const diffSha256 = 'b'.repeat(64);

function passReport(overrides = {}) {
  return {
    verdict: 'PASS',
    reason: 'AI_AUDIT_CLEAR',
    baseSha,
    diffSha256,
    ...overrides,
  };
}

test('PASS status is cryptographically bound to exact base and diff hashes', () => {
  assert.deepEqual(auditAttestationFromReport(passReport()), { baseSha, diffSha256 });
  const payload = statusPayloadFromReport(passReport(), 'https://example.test/audit');
  assert.equal(payload.state, 'success');
  assert.equal(payload.context, STATUS_CONTEXT);
  assert.equal(payload.description, `PASS base=${baseSha} diff=${diffSha256}`);
  assert.equal(payload.target_url, 'https://example.test/audit');
  assert.ok(payload.description.length <= 140);
});

test('PASS without a complete attestation publishes error rather than success', () => {
  for (const report of [
    passReport({ baseSha: null }),
    passReport({ baseSha: 'abc' }),
    passReport({ diffSha256: null }),
    passReport({ diffSha256: 'abc' }),
  ]) {
    const payload = statusPayloadFromReport(report);
    assert.equal(payload.state, 'error');
    assert.equal(payload.description, 'PASS_ATTESTATION_INVALID');
  }
});

test('non-PASS verdict cannot become success even with a valid attestation', () => {
  const payload = statusPayloadFromReport(passReport({ verdict: 'BLOCK_PROMOTION', reason: 'STRICT_PRIOR:FAIL' }));
  assert.equal(payload.state, 'failure');
  assert.match(payload.description, /^BLOCK_PROMOTION base=/);
  assert.ok(payload.description.length <= 140);
});

test('attestation rejects non-hex or wrong-length hashes', () => {
  assert.equal(auditAttestationFromReport(passReport({ baseSha: 'g'.repeat(40) })), null);
  assert.equal(auditAttestationFromReport(passReport({ diffSha256: 'z'.repeat(64) })), null);
});
