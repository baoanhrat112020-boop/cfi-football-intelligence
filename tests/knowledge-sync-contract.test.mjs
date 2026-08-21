import test from 'node:test';
import assert from 'node:assert/strict';
import { CFI_KNOWLEDGE_SYNC_COMMAND, KNOWLEDGE_SYNC_CONTRACT, candidateDecision, evidenceTransition, promotionDecision } from '../research/knowledge-sync-contract.mjs';

test('knowledge sync command and guardrails are immutable research-only', () => {
  assert.match(CFI_KNOWLEDGE_SYNC_COMMAND, /HUNT.*LAB.*EVIDENCE/);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.researchOnly, true);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.r0Immutable, true);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.productionMutationAllowed, false);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.canonicalDbMutationAllowed, false);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.directPaperToProduction, false);
});

test('only sufficiently applicable and provenance-verified knowledge is queued', () => {
  assert.equal(candidateDecision({ applicability_score: 90, provenance_status: 'UNVERIFIED' }).candidate, false);
  const good = candidateDecision({ applicability_score: 82, provenance_status: 'SOURCE_VERIFIED' });
  assert.equal(good.candidate, true);
  assert.equal(good.queueStatus, 'QUEUED');
  assert.equal(good.baselineLock, 'R0_IMMUTABLE');
  assert.equal(good.productionMutationAllowed, false);
});

test('evidence feeds candidate lifecycle back without direct production promotion', () => {
  assert.equal(evidenceTransition('HARMFUL'), 'REJECTED');
  assert.equal(evidenceTransition('NO_BENEFIT'), 'REJECTED');
  assert.equal(evidenceTransition('SHADOW_ELIGIBLE'), 'SHADOW_ELIGIBLE');
  assert.equal(evidenceTransition('VERIFIED_CFI'), 'VERIFIED_CFI');
});

test('promotion score requires >=80 for shadow and hard failures override score', () => {
  assert.equal(promotionDecision(79.99, []), 'RESEARCH');
  assert.equal(promotionDecision(80, []), 'SHADOW_ELIGIBLE');
  assert.equal(promotionDecision(94, []), 'STRONG_CANDIDATE');
  assert.equal(promotionDecision(99, ['TEMPORAL_LEAKAGE']), 'HARD_FAIL');
});
