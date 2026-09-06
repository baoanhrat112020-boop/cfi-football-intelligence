import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreePlusHtCalibrationBins, evaluateThreePlusHtSafety } from '../src/prediction/three-plus-ht-safety.ts';

function body(final=.357,grid=.121,methodB=.15){
  return {
    markets:{'3+ HT':{final,methodB}},
    multiMarket:{overUnder:{ht:{'2.5':{over:{fullWin:grid}}}}},
    multiMarketIntegration:{crossCoreConsistency:{tolerance:.01,checks:[{event:'3+ HT ≡ HT O2.5',champion:final,shadow:grid,delta:Math.abs(final-grid),tolerance:.01,status:Math.abs(final-grid)<=.01?'PASS':'FAIL'}]}},
  };
}

test('large FINAL vs HT O2.5 disagreement fail-closes 3+ HT betting',()=>{
  const out=evaluateThreePlusHtSafety(body(.357,.121,.16));
  assert.equal(out.status,'CALIBRATION_REQUIRED');
  assert.equal(out.bettingStatus,'WATCH');
  assert.equal(out.decisionUse,false);
  assert.equal(out.rawFinalProbability,.357);
  assert.equal(out.futureSixChallengerProbability,.16);
  assert.equal(out.scoreGridProbability,.121);
  assert.equal(out.bettingProbability,null);
  assert.equal(out.crossCore.status,'FAIL');
  assert.equal(out.crossCore.delta,.236);
  assert.ok(out.reasons.includes('CROSS_CORE_EQUIVALENCE_FAIL'));
  assert.ok(out.reasons.includes('HISTORICAL_CALIBRATION_NOT_APPROVED'));
});

test('cross-core agreement alone cannot restore BET without approved calibration',()=>{
  const out=evaluateThreePlusHtSafety(body(.20,.205,.19));
  assert.equal(out.crossCore.status,'PASS');
  assert.equal(out.status,'CALIBRATION_REQUIRED');
  assert.equal(out.decisionUse,false);
  assert.equal(out.bettingProbability,null);
});

test('approved calibrated probability plus equivalence PASS makes 3+ HT eligible',()=>{
  const x:any=body(.20,.205,.19);
  x.threePlusHtCalibrationApproval={status:'APPROVED',version:'CFI_3HT_CAL_V1',calibratedProbability:.17};
  const out=evaluateThreePlusHtSafety(x);
  assert.equal(out.crossCore.status,'PASS');
  assert.equal(out.status,'CALIBRATED_READY');
  assert.equal(out.decisionUse,true);
  assert.equal(out.bettingProbability,.17);
  assert.equal(out.approvalVersion,'CFI_3HT_CAL_V1');
});

test('calibration bins report actual hit rate and calibration gap',()=>{
  const bins=buildThreePlusHtCalibrationBins([
    {probability:.05,outcome:false},
    {probability:.08,outcome:true},
    {probability:.31,outcome:false},
    {probability:.35,outcome:false},
    {probability:.39,outcome:true},
    {probability:.55,outcome:true},
  ]);
  const low=bins.find(x=>x.bin==='0-10%')!;
  const thirties=bins.find(x=>x.bin==='30-40%')!;
  const high=bins.find(x=>x.bin==='50%+')!;
  assert.equal(low.n,2);
  assert.equal(low.actualHitRate,.5);
  assert.equal(thirties.n,3);
  assert.equal(thirties.actualHitRate,.333333);
  assert.equal(thirties.meanPredicted,.35);
  assert.equal(thirties.calibrationGap,.016667);
  assert.equal(high.n,1);
  assert.equal(high.actualHitRate,1);
});
