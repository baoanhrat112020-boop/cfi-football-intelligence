import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_A_PRIMARY_V2_GATE,
  evaluateGroupACandidatePrimaryV2,
  applyGroupAPrimaryV2Gate,
} from '../research/group-a-primary-v2-gate.mjs';

function metrics({ top1Ht=.30, top1Ft=.12, top3Ht=.66, top3Ft=.31, threshold=.10, family=.08 }={}) {
  return {
    champion: {
      '3+ HT': { brier: threshold },
      '7+ FT': { brier: threshold },
      'Other HT': { brier: threshold },
      'Other FT': { brier: threshold },
    },
    oneXTwo: { ht:{brier:family}, ft:{brier:family} },
    overUnder: { ht:{brier:family}, ft:{brier:family} },
    asianHandicap: { ht:{brier:family}, ft:{brier:family} },
    scoreline: {
      ht:{top1Accuracy:top1Ht,top3Accuracy:top3Ht},
      ft:{top1Accuracy:top1Ft,top3Accuracy:top3Ft},
    },
    calibrationEce:.01,
  };
}

function candidate(candidateMetrics=metrics()) {
  return {
    metrics:candidateMetrics,
    segments:{ELITE_PRO:{n:1000,baseline:{brier:.08},challenger:{brier:.08}}},
    hardBlockers:['BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS'],
    decisionUse:false,
    productionMutationAllowed:false,
  };
}

test('primary V2 contract is four thresholds plus Top-1 HT/FT; Top-3 is diagnostic only',()=>{
  assert.deepEqual(GROUP_A_PRIMARY_V2_GATE.primaryTargets,[
    '3+ HT','7+ FT','Other HT','Other FT','Top-1 HT','Top-1 FT',
  ]);
  assert.deepEqual(GROUP_A_PRIMARY_V2_GATE.auxiliaryDiagnostics,['Top-3 HT','Top-3 FT']);
  assert.equal(GROUP_A_PRIMARY_V2_GATE.primaryTargets.some(x=>x.startsWith('Top-3')),false);
});

test('Top-1 regression is blocking even when Top-3 improves',()=>{
  const baseline=metrics({top1Ht:.30,top3Ht:.66});
  const challenger=metrics({top1Ht:.295,top3Ht:.70});
  const out=evaluateGroupACandidatePrimaryV2(candidate(challenger),baseline);
  assert.ok(out.regressions.some(x=>x.startsWith('primary.Top-1 HT:accuracy:')));
  assert.ok(out.hardBlockers.includes('UNACCEPTABLE_FULL_CONTRACT_REGRESSION'));
  assert.equal(out.auxiliaryDiagnostics['Top-3 HT'].gateUse,false);
  assert.ok(out.auxiliaryDiagnostics['Top-3 HT'].delta>0);
  assert.equal(out.promotionDecision,'HOLD');
  assert.equal(out.shadowEligible,false);
});

test('Champion threshold Brier regression is part of primary gate',()=>{
  const baseline=metrics({threshold:.10});
  const challenger=metrics({threshold:.101});
  const out=evaluateGroupACandidatePrimaryV2(candidate(challenger),baseline);
  assert.ok(out.regressions.some(x=>x.startsWith('primary.3+ HT:brier:+')));
  assert.ok(out.hardBlockers.includes('UNACCEPTABLE_FULL_CONTRACT_REGRESSION'));
});

test('Multi-Market family regression remains blocking independently of primary targets',()=>{
  const baseline=metrics({family:.08});
  const challenger=metrics({family:.081});
  const out=evaluateGroupACandidatePrimaryV2(candidate(challenger),baseline);
  assert.ok(out.regressions.some(x=>x.startsWith('oneXTwo.ht:brier:+')));
  assert.ok(out.hardBlockers.includes('UNACCEPTABLE_FULL_CONTRACT_REGRESSION'));
});

test('suite gate exposes exact primary/auxiliary semantics and stays research-only',()=>{
  const base=metrics();
  const raw={
    baseline:{engine:'CFI_FINAL_V5.3.0',primaryContract:'CFI_2_METHODS_X_6_TARGETS_V2',commitSha:'518dfb57aafc8428e09b3ec84e440146c839a19e'},
    baselineMetrics:base,
    challengers:{X:candidate(base)},
    decisionUse:false,
    productionMutationAllowed:false,
  };
  const out=applyGroupAPrimaryV2Gate(raw);
  assert.deepEqual(out.evaluationContract.primaryTargets,GROUP_A_PRIMARY_V2_GATE.primaryTargets);
  assert.deepEqual(out.evaluationContract.auxiliaryDiagnostics,GROUP_A_PRIMARY_V2_GATE.auxiliaryDiagnostics);
  assert.equal(out.evaluationContract.top3GateUse,false);
  assert.equal(out.challengers.X.decisionUse,false);
  assert.equal(out.challengers.X.productionMutationAllowed,false);
  assert.equal(out.challengers.X.promotionDecision,'HOLD');
});
