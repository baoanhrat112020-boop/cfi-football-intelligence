import test from 'node:test';
import assert from 'node:assert/strict';
import { CFI_KNOWLEDGE_SYNC_COMMAND, KNOWLEDGE_SYNC_CONTRACT, candidateDecision, evidenceTransition, promotionDecision } from '../research/knowledge-sync-contract.mjs';

const item=(overrides={})=>({
  knowledge_key:'CFI-L999',fingerprint:'fp-999',title:'Multi-market calibration',source:'paper',source_type:'PAPER',
  provenance_status:'SOURCE_VERIFIED',summary_vi:'verified lesson',applicability_score:82,multi_market_relevance_score:88,
  target_market:'P1_OVER_UNDER',cfi_application:'O/U ladder calibration',required_artifacts:['strict_prior_ou'],
  expected_failure_modes:['TAIL_MISCALE'],baseline_lock:'R0_IMMUTABLE',...overrides,
});

test('knowledge sync command and guardrails are immutable research-only', () => {
  assert.match(CFI_KNOWLEDGE_SYNC_COMMAND, /HUNT.*LAB.*EVIDENCE/);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.researchOnly, true);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.r0Immutable, true);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.productionMutationAllowed, false);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.canonicalDbMutationAllowed, false);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.directPaperToProduction, false);
  assert.equal(KNOWLEDGE_SYNC_CONTRACT.multiMarketFocus,true);
  assert.deepEqual(KNOWLEDGE_SYNC_CONTRACT.huntWeights,{multiMarket:.6,foundational:.4});
});

test('queue requires applicability, multi-market relevance, provenance and full contract fields', () => {
  assert.equal(candidateDecision(item({ provenance_status: 'UNVERIFIED' })).candidate, false);
  assert.equal(candidateDecision(item({ multi_market_relevance_score:69 })).candidate,false);
  const good = candidateDecision(item());
  assert.equal(good.candidate, true);
  assert.equal(good.queueStatus, 'QUEUED');
  assert.equal(good.baselineLock, 'R0_IMMUTABLE');
  assert.equal(good.productionMutationAllowed, false);
  assert.equal(good.targetTrack,'P1_OVER_UNDER');
});

test('rejected knowledge cannot be silently revived',()=>{
  assert.equal(candidateDecision(item(),{previousStatus:'REJECTED'}).candidate,false);
  assert.equal(candidateDecision(item(),{previousStatus:'REJECTED',newEvidence:true}).candidate,true);
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
