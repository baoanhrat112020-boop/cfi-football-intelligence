import test from 'node:test';
import assert from 'node:assert/strict';
import { K044_CONTRACT, runK044CrossTaskLeakage } from '../research/k044-cross-task-leakage.mjs';

const tasks=[
  {taskId:'A',targetDate:'2026-08-20',maxEvidenceDate:'2026-08-19',outcome:1,withCrossTaskProbability:.80,withoutCrossTaskProbability:.60,crossTaskVisibility:[{taskId:'B',revealDate:'2026-08-20'},{taskId:'C',revealDate:'2026-08-18'}]},
  {taskId:'B',targetDate:'2026-08-21',maxEvidenceDate:'2026-08-20',outcome:0,withCrossTaskProbability:.20,withoutCrossTaskProbability:.30,crossTaskVisibility:[{taskId:'A',revealDate:'2026-08-20'}]},
];

test('K044 contract is research-only and R0 immutable',()=>{
  assert.equal(K044_CONTRACT.researchOnly,true);
  assert.equal(K044_CONTRACT.baselineLock,'R0_IMMUTABLE');
  assert.equal(K044_CONTRACT.productionMutationAllowed,false);
  assert.equal(K044_CONTRACT.decisionUse,false);
});

test('K044 builds deterministic date-gated replay and visibility ablation',()=>{
  const a=runK044CrossTaskLeakage({tasks});
  const b=runK044CrossTaskLeakage({tasks:[...tasks].reverse()});
  assert.deepEqual(a.artifact.dateGatedReplayCohort,b.artifact.dateGatedReplayCohort);
  assert.equal(a.artifact.visibilityAblation.sampleCount,2);
  assert.equal(a.artifact.filterAudit.leakingTaskCount,1);
  assert.deepEqual(a.artifact.filterAudit.hardFailures,['K044_CROSS_TASK_VISIBILITY_LEAKAGE_DETECTED']);
  assert.equal(a.productionEligible,false);
});

test('K044 per-task leakage uplift is computed from paired Brier ablation',()=>{
  const r=runK044CrossTaskLeakage({tasks});
  assert.ok(r.artifact.perTaskLeakageUplift.A>0);
  assert.ok(r.artifact.perTaskLeakageUplift.B>0);
  assert.ok(r.artifact.visibilityAblation.meanLeakageUplift>0);
});

test('K044 fails closed on same-date evidence and invalid probabilities',()=>{
  assert.throws(()=>runK044CrossTaskLeakage({tasks:[{...tasks[0],maxEvidenceDate:'2026-08-20'},tasks[1]]}),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>runK044CrossTaskLeakage({tasks:[{...tasks[0],withCrossTaskProbability:1.1},tasks[1]]}),/K044_INVALID_PROBABILITY/);
});

test('K044 refuses synthetic or reconstructed replay cohorts',()=>{
  assert.throws(()=>runK044CrossTaskLeakage({tasks,synthetic:true}),/K044_REAL_REPLAY_REQUIRED/);
  assert.throws(()=>runK044CrossTaskLeakage({tasks,reconstructed:true}),/K044_REAL_REPLAY_REQUIRED/);
  assert.throws(()=>runK044CrossTaskLeakage({tasks,replayedPredictionHistory:true}),/K044_REAL_REPLAY_REQUIRED/);
});
