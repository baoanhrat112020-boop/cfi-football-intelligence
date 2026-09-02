import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHfGroupAShadow, CFI_HF_GROUP_A_SHADOW } from '../research/hf-group-a-shadow.mjs';

function learner(name){
  if(name==='OPPONENT_STRENGTH_ARM_V1')return {stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19',ht:{n:1000,beta:[0,0,0,0]},ft:{n:1000,beta:[0,0,0,0]}};
  return {stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19',globalHt:{n:1000,h:0,a:0},globalFt:{n:1000,h:0,a:0},segmentHt:{MID_PRO:{n:100,h:0,a:0}},segmentFt:{MID_PRO:{n:100,h:0,a:0}},segmentPriorWeight:500};
}
function fixture() {
  const candidate = name => ({
    status: 'RESEARCH_ONLY',
    coverage: { eligible: 1000, active: 900, abstain: 100 },
    aggregate: { deltaVsProduction: { brier: -0.001, logLoss: -0.01, calibrationEce: -0.005 } },
    primaryEvaluation: {},
    multiMarketEvaluation: {},
    auxiliaryDiagnostics: { 'Top-3 HT': { gateUse: false }, 'Top-3 FT': { gateUse: false } },
    primaryRegressionCount: 0,
    multiMarketRegressionCount: 0,
    segmentRegressionCount: 0,
    regressions: [],
    hardBlockers: ['BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS'],
    promotionDecision: 'HOLD',
    shadowEligible: false,
    decisionUse: false,
    productionMutationAllowed: false,
    evaluationContract: { top3GateUse: false },
    version: name,
    learner: learner(name),
  });
  return {
    baseline: {
      engine: 'CFI_FINAL_V5.3.0',
      runtime: 'CFI_PRIMARY_TOP1_RUNTIME_V2',
      primaryContract: 'CFI_2_METHODS_X_6_TARGETS_V2',
      multiMarketVersion: 'CFI_MULTI_MARKET_V1',
      commitSha: '518dfb57aafc8428e09b3ec84e440146c839a19e',
    },
    evaluationContract: {
      primaryTargets: ['3+ HT','7+ FT','Other HT','Other FT','Top-1 HT','Top-1 FT'],
      auxiliaryDiagnostics: ['Top-3 HT','Top-3 FT'],
      top3GateUse: false,
    },
    strictPrior: true,
    sameDateLeakage: false,
    futureLeakage: false,
    noReconstruction: true,
    decisionUse: false,
    productionMutationAllowed: false,
    coverage: { fixtureCount: 87765, baselineEligible: 68954 },
    determinism: { fingerprint: 'abc123' },
    challengers: Object.fromEntries(CFI_HF_GROUP_A_SHADOW.selectedCandidates.map(name => [name, candidate(name)])),
  };
}

test('HF Group A shadow summary pins production baseline and exports frozen learners without production writes', () => {
  const out = summarizeHfGroupAShadow(fixture(), { JOB_ID: 'job-1', CPU_CORES: '2', MEMORY: '16Gi', ACCELERATOR: 'none' });
  assert.equal(out.version, 'CFI_HF_GROUP_A_SHADOW_V1');
  assert.equal(out.executionPlatform, 'HUGGING_FACE_JOBS');
  assert.equal(out.jobId, 'job-1');
  assert.equal(out.decisionUse, false);
  assert.equal(out.productionMutationAllowed, false);
  assert.equal(out.productionWritePath, null);
  assert.equal(out.evaluationContract.top3GateUse, false);
  assert.equal(out.frozenStateVersion,'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1');
  assert.equal(out.trainedThrough,'2026-08-19');
  assert.deepEqual(out.selectedCandidates, ['OPPONENT_STRENGTH_ARM_V1','HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1']);
  assert.deepEqual(out.frozenLearners.OPPONENT_STRENGTH_ARM_V1,learner('OPPONENT_STRENGTH_ARM_V1'));
  assert.deepEqual(out.frozenLearners.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1,learner('HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1'));
});

test('HF Group A shadow fails closed on baseline drift', () => {
  const x = fixture();
  x.baseline.engine = 'CFI_FINAL_V999';
  assert.throws(() => summarizeHfGroupAShadow(x), /HF_GROUP_A_BASELINE_ENGINE_DRIFT/);
});

test('HF Group A shadow fails closed if Top-3 becomes a gate', () => {
  const x = fixture();
  x.evaluationContract.top3GateUse = true;
  assert.throws(() => summarizeHfGroupAShadow(x), /HF_GROUP_A_TOP3_GATE_FORBIDDEN/);
});

test('HF Group A shadow fails closed on any candidate production mutation', () => {
  const x = fixture();
  x.challengers.OPPONENT_STRENGTH_ARM_V1.productionMutationAllowed = true;
  assert.throws(() => summarizeHfGroupAShadow(x), /HF_GROUP_A_CANDIDATE_PRODUCTION_MUTATION_FORBIDDEN/);
});

test('HF Group A shadow fails closed if prospective learner boundary changes',()=>{
  const x=fixture();
  x.challengers.OPPONENT_STRENGTH_ARM_V1.learner.trainedThrough='2026-08-20';
  assert.throws(()=>summarizeHfGroupAShadow(x),/HF_GROUP_A_TRAINING_BOUNDARY_DRIFT/);
});
