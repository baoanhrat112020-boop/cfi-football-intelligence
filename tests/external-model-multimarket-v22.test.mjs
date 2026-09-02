import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExternalModelRun } from '../research/external-model-promotion-gate.mjs';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION, REQUIRED_OUTPUT_GROUPS } from '../research/multimarket-promotion-gate-v2.mjs';

const components={accuracyBrier:90,calibrationEce:90,rankingDiscrimination:90,crossMarketCoherence:100,temporalOotRobustness:90,segmentRegimeRobustness:85,determinismSwapDiversity:100,decisionUtilityMarketComparison:80};
const gates={strictPrior:true,temporalLeakage:true,validProbability:true,calibrationFloor:true,forecastCollapse:true,determinism:true,swap:true,crossMarketCoherence:true,noReconstruction:true,noHoldoutTuning:true,uncertaintyAbstention:true};
const outputCoverage=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,true]));
const perGroup=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,{evaluated:true,unacceptableRegression:false}]));
const baselineComparison={paired:true,baselineReproducible:true,aggregateNetImprovementOrPreservation:true,noUnacceptableRegression:true,requiredGroups:REQUIRED_OUTPUT_GROUPS,perGroup,aggregateBrierDelta:-0.001,aggregateLogLossDelta:-0.001};
const input={components,gates,sampleSupport:300,contractVersion:MULTIMARKET_RESEARCH_CONTRACT_VERSION,outputCoverage,baselineComparison};

test('external model evaluation fails closed without full Multi-Market input',()=>{
  const r=evaluateExternalModelRun([],{});
  assert.equal(r.status,'FAIL_HARD_GATE');
  assert.equal(r.shadowEligible,false);
  assert.equal(r.productionEligible,false);
  assert.deepEqual(r.hardFailures,['MULTIMARKET_EVALUATION_REQUIRED']);
});

test('external model can only reach shadow through V2.2 and remains research-only',()=>{
  const r=evaluateExternalModelRun([],{multiMarketPromotionInput:input});
  assert.equal(r.contractVersion,MULTIMARKET_RESEARCH_CONTRACT_VERSION);
  assert.equal(r.shadowEligible,true);
  assert.equal(r.productionEligible,false);
  assert.equal(r.decisionUse,false);
  assert.equal(r.researchOnly,true);
  assert.equal(r.leakageAdjustedGate.pass,true);
});

test('external pretrained historical-only evidence without clean control hard-fails',()=>{
  const r=evaluateExternalModelRun([],{multiMarketPromotionInput:input,externalModelAudit:{externalPretrainedModel:true,historicalOnly:true,matchedCleanControl:false,prospectiveUnseen:false}});
  assert.equal(r.status,'FAIL_HARD_GATE');
  assert.equal(r.shadowEligible,false);
  assert.ok(r.hardFailures.includes('EXTERNAL_MODEL_CLEAN_CONTROL_REQUIRED'));
});
