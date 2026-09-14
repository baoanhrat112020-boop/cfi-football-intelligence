import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFusionV3Promotion,
  FUSION_V3_REQUIRED_GROUPS,
} from '../research/multimarket-fusion-v3-promotion-gate.mjs';

function passing(){
  return {
    strictPrior:true,
    reconstructed:false,
    predictionHistoryReplay:false,
    prospectiveReset:true,
    lockedOosPass:true,
    deterministicPass:true,
    directionalSwapPass:true,
    trajectoryStatus:'PASS',
    crossMarketCoherenceStatus:'PASS',
    segmentWorstBrierDelta:.008,
    bigDb:{used:true,strictPriorVerified:true,reproducible:true},
    metrics:{
      n:240,
      candidate:{brier:.184,logLoss:.541,ece:.031},
      baseline:{brier:.191,logLoss:.556,ece:.034},
    },
    groups:Object.fromEntries(FUSION_V3_REQUIRED_GROUPS.map(group=>[group,{n:40,brierDelta:-.002,logLossDelta:-.004}])),
  };
}

test('Fusion V3 promotion gate passes only with full locked evidence',()=>{
  const out=evaluateFusionV3Promotion(passing());
  assert.equal(out.status,'PASS');
  assert.equal(out.shadowEligible,true);
  assert.equal(out.productionEligible,false);
  assert.equal(out.decisionUse,false);
});

test('Fusion V3 promotion gate blocks weak Brier gain',()=>{
  const input=passing();
  input.metrics.candidate.brier=.1905;
  const out=evaluateFusionV3Promotion(input);
  assert.equal(out.status,'BLOCKED');
  assert.ok(out.hardFailures.includes('AGGREGATE_BRIER_GAIN_TOO_SMALL'));
});

test('Fusion V3 promotion gate blocks unverified BigDB',()=>{
  const input=passing();
  input.bigDb.strictPriorVerified=false;
  const out=evaluateFusionV3Promotion(input);
  assert.ok(out.hardFailures.includes('BIGDB_TEMPORAL_AUDIT_REQUIRED'));
});

test('Fusion V3 promotion gate blocks missing market-group evidence',()=>{
  const input=passing();
  delete input.groups.FT_AH;
  const out=evaluateFusionV3Promotion(input);
  assert.ok(out.hardFailures.includes('FT_AH_EVIDENCE_REQUIRED'));
});

test('Fusion V3 promotion gate blocks reconstructed or replayed predictions',()=>{
  const input=passing();
  input.reconstructed=true;
  input.predictionHistoryReplay=true;
  const out=evaluateFusionV3Promotion(input);
  assert.ok(out.hardFailures.includes('RECONSTRUCTION_FORBIDDEN'));
  assert.ok(out.hardFailures.includes('PREDICTION_HISTORY_REPLAY_FORBIDDEN'));
});
