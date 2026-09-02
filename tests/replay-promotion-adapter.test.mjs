import test from 'node:test';
import assert from 'node:assert/strict';
import { replayDualHistorical } from '../src/learning/dual-historical-replay.ts';
import { scoreReplayAllModels } from '../research/replay-promotion-adapter.mjs';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION, REQUIRED_OUTPUT_GROUPS } from '../research/multimarket-promotion-gate-v2.mjs';

const fixtures = Array.from({ length: 24 }, (_, i) => ({
  id:`rf${i+1}`,
  matchDate:`2026-02-${String(i+1).padStart(2,'0')}`,
  homeTeam:i%2?'Beta':'Alpha',
  awayTeam:i%2?'Alpha':'Beta',
  ht:{home:i%3===0?2:1,away:i%5===0?1:0},
  ft:{home:i%4===0?5:2,away:i%6===0?2:1},
}));

const components={accuracyBrier:90,calibrationEce:90,rankingDiscrimination:90,crossMarketCoherence:100,temporalOotRobustness:90,segmentRegimeRobustness:85,determinismSwapDiversity:100,decisionUtilityMarketComparison:80};
const gates={strictPrior:true,temporalLeakage:true,validProbability:true,calibrationFloor:true,forecastCollapse:true,determinism:true,swap:true,crossMarketCoherence:true,noReconstruction:true,noHoldoutTuning:true,uncertaintyAbstention:true};
const outputCoverage=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,true]));
const perGroup=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,{evaluated:true,unacceptableRegression:false}]));
const baselineComparison={paired:true,baselineReproducible:true,aggregateNetImprovementOrPreservation:true,noUnacceptableRegression:true,requiredGroups:REQUIRED_OUTPUT_GROUPS,perGroup,aggregateBrierDelta:-0.001,aggregateLogLossDelta:-0.001};
const fullInput={components,gates,sampleSupport:300,contractVersion:MULTIMARKET_RESEARCH_CONTRACT_VERSION,outputCoverage,baselineComparison};

test('replay exports real date-bounded temporal provenance', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  assert.equal(replay.strictPrior,true);
  assert.equal(replay.sameDateLeakage,false);
  assert.equal(replay.temporalProvenanceComplete,true);
  const eligible = replay.evaluations.filter(r=>r.evidenceCount>0);
  assert.ok(eligible.length>0);
  for (const r of eligible) {
    assert.ok(r.maxEvidenceTimestamp);
    assert.ok(Date.parse(r.maxEvidenceTimestamp) < Date.parse(r.targetTimestamp));
  }
});

test('legacy replay evidence cannot self-promote without full Multi-Market V2.2 evaluation', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  const scored = scoreReplayAllModels(replay);
  for (const type of ['HISTORICAL_PRODUCTION','FUTURE_SIX_FACTORS','FINAL_CFI']) {
    assert.ok(scored[type]);
    assert.ok(scored[type].sampleCount>0);
    assert.equal(scored[type].status,'FAIL_HARD_GATE');
    assert.equal(scored[type].shadowEligible,false);
    assert.equal(scored[type].productionEligible,false);
    assert.deepEqual(scored[type].hardFailures,['MULTIMARKET_EVALUATION_REQUIRED']);
  }
});

test('replay can only reach shadow status through the authoritative V2.2 gate', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  const scored = scoreReplayAllModels(replay,{multiMarketPromotionInput:fullInput});
  for (const type of ['HISTORICAL_PRODUCTION','FUTURE_SIX_FACTORS','FINAL_CFI']) {
    assert.equal(scored[type].contractVersion,MULTIMARKET_RESEARCH_CONTRACT_VERSION);
    assert.equal(scored[type].shadowEligible,true);
    assert.equal(scored[type].productionEligible,false);
    assert.equal(scored[type].decisionUse,false);
  }
});

test('adapter fails closed when temporal provenance is not verified', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  replay.temporalProvenanceComplete=false;
  const scored = scoreReplayAllModels(replay,{multiMarketPromotionInput:fullInput});
  for (const result of Object.values(scored)) {
    assert.equal(result.status,'FAIL_HARD_GATE');
    assert.equal(result.shadowEligible,false);
    assert.deepEqual(result.hardFailures,['REPLAY_STRICT_PRIOR_FAILURE']);
  }
});
