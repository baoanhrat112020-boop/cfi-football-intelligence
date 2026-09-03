import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_A_SHADOW_LAB_POLICY_V1,
  evaluateGroupAShadowLabPolicy,
} from '../research/group-a-shadow-lab-policy-v1.mjs';

test('Group A is permanently nonblocking for production',()=>{
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.productionIndependent,true);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.productionBlocking,false);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.shadowLabOnly,true);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.researchOnly,true);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.decisionUse,false);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.productionMutationAllowed,false);
  assert.equal(GROUP_A_SHADOW_LAB_POLICY_V1.productionEligible,false);
});

test('missing frozen state and missed kickoff both skip without reconstruction',()=>{
  const missing=evaluateGroupAShadowLabPolicy({frozenStateReady:false,fixturePreKickoff:true,settledProspective:0});
  assert.equal(missing.status,'SKIP');
  assert.equal(missing.reason,'MISSING_EXACT_FROZEN_STATE');
  assert.equal(missing.action,'SKIP_NON_BLOCKING');
  assert.equal(missing.productionBlocking,false);

  const missed=evaluateGroupAShadowLabPolicy({frozenStateReady:true,fixturePreKickoff:false,settledProspective:12});
  assert.equal(missed.status,'SKIP');
  assert.equal(missed.reason,'MISSED_KICKOFF');
  assert.equal(missed.action,'SKIP_NO_RECONSTRUCTION');
  assert.equal(missed.noReconstruction,true);
});

test('under 30 settled samples only accumulates shadow evidence',()=>{
  const x=evaluateGroupAShadowLabPolicy({frozenStateReady:true,fixturePreKickoff:true,settledProspective:29});
  assert.equal(x.status,'CONTINUE_SHADOW');
  assert.equal(x.action,'ACCUMULATE_ONLY');
  assert.equal(x.productionEligible,false);
});

test('promotion review requires 30+ settled, full Multi-Market pass, and clear Champion improvement',()=>{
  const x=evaluateGroupAShadowLabPolicy({
    frozenStateReady:true,
    fixturePreKickoff:true,
    settledProspective:30,
    fullMultiMarketPass:true,
    clearChampionImprovement:true,
    hardRegression:false,
  });
  assert.equal(x.status,'PROMOTION_REVIEW');
  assert.equal(x.action,'REQUIRE_EXPLICIT_PRODUCTION_APPROVAL');
  assert.equal(x.productionEligible,false);
  assert.equal(x.explicitProductionPromotionApprovalRequired,true);
});

test('hard regression after minimum support retires candidate',()=>{
  const x=evaluateGroupAShadowLabPolicy({
    frozenStateReady:true,
    fixturePreKickoff:true,
    settledProspective:31,
    fullMultiMarketPass:false,
    clearChampionImprovement:false,
    hardRegression:true,
  });
  assert.equal(x.status,'RETIRE');
  assert.equal(x.reason,'HARD_REGRESSION_AFTER_MIN_SUPPORT');
  assert.equal(x.action,'CLOSE_CANDIDATE');
});

test('candidate without clear improvement is retired by 50 settled samples',()=>{
  const review=evaluateGroupAShadowLabPolicy({
    frozenStateReady:true,
    fixturePreKickoff:true,
    settledProspective:49,
    fullMultiMarketPass:false,
    clearChampionImprovement:false,
    hardRegression:false,
  });
  assert.equal(review.status,'REVIEW');

  const retire=evaluateGroupAShadowLabPolicy({
    frozenStateReady:true,
    fixturePreKickoff:true,
    settledProspective:50,
    fullMultiMarketPass:false,
    clearChampionImprovement:false,
    hardRegression:false,
  });
  assert.equal(retire.status,'RETIRE');
  assert.equal(retire.reason,'NO_CLEAR_CHAMPION_IMPROVEMENT_BY_50');
});
