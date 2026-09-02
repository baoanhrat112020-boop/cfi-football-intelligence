import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_A_PROSPECTIVE_MODEL_V1,
  applyOpponentStrengthArm,
  applyHierarchicalLeagueSegmentCalibration,
} from '../research/group-a-prospective-model-v1.mjs';

const base={htHome:.7,htAway:.5,ftHome:1.4,ftAway:1.0};
const stateEnvelope={stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19'};

test('opponent prospective adapter uses frozen strict-prior state and stays research-only',()=>{
  const learner={...stateEnvelope,ht:{n:1000,beta:[.01,.10,-.05,.08]},ft:{n:1000,beta:[.02,.20,-.10,.16]}};
  const home={strict_prior:true,as_of_date:'2026-08-19',attack_index:1.2,defense_index:.8,net_strength:.5,confidence:.9,segment_v2:'M|SENIOR|MID_PRO'};
  const away={strict_prior:true,as_of_date:'2026-08-19',attack_index:.7,defense_index:1.1,net_strength:-.2,confidence:.8,segment_v2:'M|SENIOR|MID_PRO'};
  const out=applyOpponentStrengthArm({baseExpectedGoals:base,homeStrength:home,awayStrength:away,learner});
  assert.equal(out.status,'READY');
  assert.equal(out.researchOnly,true);
  assert.equal(out.decisionUse,false);
  assert.equal(out.productionEligible,false);
  assert.equal(out.prediction.noReconstruction,true);
  assert.equal(out.prediction.trainedThrough,'2026-08-19');
  assert.equal(out.prediction.multiMarket.consistencyGuard.status,'PASS');
  assert.ok(out.prediction.expectedGoals.htHome!==base.htHome);
  assert.equal(out.predictionHash.length,64);
});

test('opponent adapter abstains below historical confidence floor',()=>{
  const learner={...stateEnvelope,ht:{n:1000,beta:[0,0,0,0]},ft:{n:1000,beta:[0,0,0,0]}};
  const low={strict_prior:true,as_of_date:'2026-08-19',attack_index:1,defense_index:1,net_strength:0,confidence:.39};
  const high={...low,confidence:.9};
  const out=applyOpponentStrengthArm({baseExpectedGoals:base,homeStrength:low,awayStrength:high,learner});
  assert.equal(out.status,'ABSTAIN');
  assert.equal(out.decisionUse,false);
});

test('hierarchical adapter uses exact partial-pooling formula with global fallback',()=>{
  const learner={...stateEnvelope,globalHt:{n:1000,h:.10,a:-.05},globalFt:{n:1000,h:.20,a:-.10},segmentHt:{'M|SENIOR|MID_PRO':{n:500,h:.20,a:.05}},segmentFt:{'M|SENIOR|MID_PRO':{n:500,h:.30,a:0}},segmentPriorWeight:500};
  const out=applyHierarchicalLeagueSegmentCalibration({baseExpectedGoals:base,competitionSegment:'M|SENIOR|MID_PRO',learner});
  assert.equal(out.status,'READY');
  assert.equal(out.prediction.metadata.segmentSupport.ht,500);
  assert.equal(out.prediction.metadata.segmentPriorWeight,500);
  assert.ok(Math.abs(out.prediction.metadata.delta.htHome-.15)<1e-12);
  assert.ok(Math.abs(out.prediction.metadata.delta.ftHome-.25)<1e-12);
  const fallback=applyHierarchicalLeagueSegmentCalibration({baseExpectedGoals:base,competitionSegment:'UNKNOWN_NEW_SEGMENT',learner});
  assert.ok(Math.abs(fallback.prediction.metadata.delta.htHome-.10)<1e-12);
  assert.ok(Math.abs(fallback.prediction.metadata.delta.ftHome-.20)<1e-12);
});

test('holdout leakage and learner boundary drift fail closed',()=>{
  const learner={...stateEnvelope,ht:{n:1000,beta:[0,0,0,0]},ft:{n:1000,beta:[0,0,0,0]}};
  const leaked={strict_prior:true,as_of_date:'2026-08-20',attack_index:0,defense_index:0,net_strength:0,confidence:1};
  assert.throws(()=>applyOpponentStrengthArm({baseExpectedGoals:base,homeStrength:leaked,awayStrength:{...leaked,as_of_date:'2026-08-19'},learner}),/HOLDOUT_LEAKAGE/);
  assert.throws(()=>applyHierarchicalLeagueSegmentCalibration({baseExpectedGoals:base,competitionSegment:'X',learner:{...stateEnvelope,trainedThrough:'2026-08-20',globalHt:{n:1},globalFt:{n:1}}}),/TRAINING_BOUNDARY_DRIFT/);
  assert.equal(GROUP_A_PROSPECTIVE_MODEL_V1.productionMutationAllowed,false);
});
