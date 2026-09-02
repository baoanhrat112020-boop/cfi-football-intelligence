import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT,
  buildRealChallengerEvaluation,
  evaluateRealCandidateRows,
} from '../research/knowledge-candidate-runners.mjs';
import {
  MULTIMARKET_RESEARCH_CONTRACT_VERSION,
  REQUIRED_OUTPUT_GROUPS,
} from '../research/multimarket-promotion-gate-v2.mjs';

const markets=['3+ HT','7+ FT','Other HT','Other FT'];
const probabilities=Object.fromEntries(markets.map(m=>[m,.5]));
const outcomes=Object.fromEntries(markets.map((m,i)=>[m,i%2]));
const row=buildRealChallengerEvaluation({experimentCode:'K038-STATIONARITY-RETRIEVAL',fixtureId:'fixture-1',targetDate:'2026-08-19',maxEvidenceDate:'2026-08-18',probabilities,outcomes});
const outputCoverage=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,true]));
const perGroup=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,{evaluated:true,unacceptableRegression:false}]));
const gates={strictPrior:true,temporalLeakage:true,validProbability:true,calibrationFloor:true,forecastCollapse:true,determinism:true,swap:true,crossMarketCoherence:true,noReconstruction:true,noHoldoutTuning:true,uncertaintyAbstention:true};
const components={accuracyBrier:90,calibrationEce:90,rankingDiscrimination:90,crossMarketCoherence:100,temporalOotRobustness:90,segmentRegimeRobustness:90,determinismSwapDiversity:100,decisionUtilityMarketComparison:90};
const baselineComparison={paired:true,baselineReproducible:true,aggregateNetImprovementOrPreservation:true,noUnacceptableRegression:true,requiredGroups:REQUIRED_OUTPUT_GROUPS,perGroup};

test('knowledge runner is bound to authoritative Multi-Market V2.2 contract',()=>{
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.multiMarketContractVersion,MULTIMARKET_RESEARCH_CONTRACT_VERSION);
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.productionMutationAllowed,false);
});

test('legacy rows cannot be promoted without full Multi-Market evaluation',()=>{
  const result=evaluateRealCandidateRows([row]);
  assert.equal(result.shadowEligible,false);
  assert.deepEqual(result.hardFailures,['MULTIMARKET_EVALUATION_REQUIRED']);
});

test('Top-3 fields are not part of the V2 evaluation row contract',()=>{
  assert.equal('top3HT' in row,false);
  assert.equal('top3FT' in row,false);
});

test('full Multi-Market evaluation still enforces sample floor and research-only use',()=>{
  const result=evaluateRealCandidateRows([row],{multiMarketPromotionInput:{components,gates,outputCoverage,baselineComparison}});
  assert.equal(result.shadowEligible,false);
  assert.ok(result.hardFailures.includes('INSUFFICIENT_SAMPLE_SUPPORT'));
  assert.equal(result.decisionUse,false);
  assert.equal(result.productionEligible,false);
});
