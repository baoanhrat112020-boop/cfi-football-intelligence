import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseGoalTotalDispersion,compareTailCalibration,OU_DISPERSION_DIAGNOSTIC_V1} from '../research/ou-dispersion-diagnostic.mjs';

test('diagnostic remains research-only and blocks tiny samples',()=>{
  assert.equal(OU_DISPERSION_DIAGNOSTIC_V1.decisionUse,false);
  assert.equal(diagnoseGoalTotalDispersion([{totalGoals:2}],{minN:30}).status,'BLOCKED');
});

test('overdispersed totals route to NB/mixture research without production eligibility',()=>{
  const totals=[];for(let i=0;i<20;i++)totals.push({totalGoals:0});for(let i=0;i<10;i++)totals.push({totalGoals:8});
  const r=diagnoseGoalTotalDispersion(totals,{minN:30});
  assert.equal(r.status,'READY');assert.equal(r.regime,'OVERDISPERSED');assert.equal(r.researchRecommendation,'TEST_NEGATIVE_BINOMIAL_OR_MIXTURE');assert.equal(r.productionEligible,false);
});

test('tail calibration reports empirical bias and brier only from valid rows',()=>{
  const r=compareTailCalibration([{predictedOver:.8,actualOver:1},{predictedOver:.6,actualOver:0},{predictedOver:2,actualOver:1}]);
  assert.equal(r.n,2);assert.ok(r.brier>=0&&r.brier<=1);assert.ok(Math.abs(r.calibrationBias-.2)<1e-12);
});
