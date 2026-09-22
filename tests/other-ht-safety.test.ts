import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOtherHtSafety } from '../src/prediction/other-ht-safety.ts';

test('Other HT fail-closes to WATCH without approved calibration',()=>{
  const out=evaluateOtherHtSafety({markets:{'Other HT':{final:.053}}});
  assert.equal(out.status,'CALIBRATION_REQUIRED');
  assert.equal(out.bettingStatus,'WATCH');
  assert.equal(out.decisionUse,false);
  assert.equal(out.rawFinalProbability,.053);
  assert.equal(out.bettingProbability,null);
  assert.equal(out.crossCore.status,'NOT_APPLICABLE');
  assert.ok(out.reasons.includes('HISTORICAL_CALIBRATION_NOT_APPROVED'));
});

test('approved calibration makes Other HT eligible',()=>{
  const body:any={markets:{'Other HT':{final:.053}},otherHtCalibrationApproval:{status:'APPROVED',version:'CFI_OTHER_HT_CAL_V1',calibratedProbability:.004}};
  const out=evaluateOtherHtSafety(body);
  assert.equal(out.status,'CALIBRATED_READY');
  assert.equal(out.decisionUse,true);
  assert.equal(out.bettingProbability,.004);
  assert.equal(out.approvalVersion,'CFI_OTHER_HT_CAL_V1');
});

test('invalid Other HT probability falls back to ranking target',()=>{
  const out=evaluateOtherHtSafety({ranking:[{target:'Other HT',probability:.021}]});
  assert.equal(out.rawFinalProbability,.021);
  assert.equal(out.decisionUse,false);
});
