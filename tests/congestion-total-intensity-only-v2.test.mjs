import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCongestionSignal,applyCongestionTotalIntensityOnly,CONGESTION_TOTAL_INTENSITY_CONTRACT} from '../research/congestion-total-intensity-only-v2.mjs';

const dates={targetDate:'2026-09-01',maxEvidenceDate:'2026-08-31'};

test('challenger is research-only and cannot mutate production',()=>{
  assert.equal(CONGESTION_TOTAL_INTENSITY_CONTRACT.researchOnly,true);
  assert.equal(CONGESTION_TOTAL_INTENSITY_CONTRACT.decisionUse,false);
  assert.equal(CONGESTION_TOTAL_INTENSITY_CONTRACT.productionMutationAllowed,false);
  assert.equal(CONGESTION_TOTAL_INTENSITY_CONTRACT.canonicalDbMutationAllowed,false);
});

test('sparse/low-confidence schedule evidence shrinks signal',()=>{
  const full=buildCongestionSignal({...dates,daysSincePreviousMatch:2,matchesPrior7d:3,matchesPrior14d:5,scheduleConfidence:1});
  const weak=buildCongestionSignal({...dates,daysSincePreviousMatch:2,matchesPrior7d:3,matchesPrior14d:5,scheduleConfidence:.2});
  assert.ok(full>weak);
  assert.ok(Math.abs(weak-full*.2)<1e-8);
});

test('same-date evidence fails strict-prior',()=>{
  assert.throws(()=>buildCongestionSignal({targetDate:'2026-09-01',maxEvidenceDate:'2026-09-01',daysSincePreviousMatch:3,matchesPrior7d:2,matchesPrior14d:3}),/STRICT_PRIOR_FAILURE/);
});

test('adjustment changes total intensity but exactly preserves directional share',()=>{
  const result=applyCongestionTotalIntensityOnly({lambdaHome:1.8,lambdaAway:1.2,congestionSignal:.75,frozenLogIntensityEffect:-.08});
  assert.notEqual(result.challenger.totalIntensity,result.baseline.totalIntensity);
  assert.ok(Math.abs(result.challenger.directionalShare-result.baseline.directionalShare)<=1e-12);
  assert.equal(result.invariants.directionalSharePreserved,true);
  assert.equal(result.decisionUse,false);
});

test('effect size is bounded and must be frozen before evaluation',()=>{
  assert.throws(()=>applyCongestionTotalIntensityOnly({lambdaHome:1.5,lambdaAway:1.1,congestionSignal:.5,frozenLogIntensityEffect:.13}),/FROZEN_EFFECT_OUT_OF_BOUNDS/);
});
