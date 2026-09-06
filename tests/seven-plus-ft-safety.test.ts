import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSevenPlusFtSafety } from '../src/prediction/seven-plus-ft-safety.ts';

function body(final=.18,grid=.18,methodB=.14){
  return{
    markets:{'7+ FT':{final,methodB}},
    multiMarket:{overUnder:{ft:{'6.5':{over:{fullWin:grid}}}}},
    multiMarketIntegration:{crossCoreConsistency:{tolerance:.01,checks:[{event:'7+ FT ≡ FT O6.5',champion:final,shadow:grid,delta:Math.abs(final-grid),tolerance:.01,status:Math.abs(final-grid)<=.01?'PASS':'FAIL'}]}}
  };
}

test('7+ FT remains fail-closed without approved calibration even when alias is coherent',()=>{
  const out=evaluateSevenPlusFtSafety(body(.18,.18,.14));
  assert.equal(out.crossCore.status,'PASS');
  assert.equal(out.status,'CALIBRATION_REQUIRED');
  assert.equal(out.decisionUse,false);
  assert.equal(out.rawFinalProbability,.18);
  assert.equal(out.futureSixChallengerProbability,.14);
  assert.equal(out.scoreGridProbability,.18);
  assert.equal(out.bettingProbability,null);
});

test('7+ FT alias mismatch blocks practical use',()=>{
  const out=evaluateSevenPlusFtSafety(body(.22,.06,.11));
  assert.equal(out.crossCore.status,'FAIL');
  assert.equal(out.decisionUse,false);
  assert.ok(out.reasons.includes('CROSS_CORE_EQUIVALENCE_FAIL'));
});

test('approved calibrated 7+ FT plus alias PASS becomes eligible',()=>{
  const x:any=body(.12,.125,.10);
  x.sevenPlusFtCalibrationApproval={status:'APPROVED',version:'CFI_7FT_CAL_V1',calibratedProbability:.08};
  const out=evaluateSevenPlusFtSafety(x);
  assert.equal(out.crossCore.status,'PASS');
  assert.equal(out.status,'CALIBRATED_READY');
  assert.equal(out.decisionUse,true);
  assert.equal(out.bettingProbability,.08);
  assert.equal(out.approvalVersion,'CFI_7FT_CAL_V1');
});

test('caller cannot widen 7+ FT equivalence tolerance beyond one percentage point',()=>{
  const x:any=body(.20,.15,.10);
  x.multiMarketIntegration.crossCoreConsistency.tolerance=.50;
  x.multiMarketIntegration.crossCoreConsistency.checks[0].tolerance=.50;
  const out=evaluateSevenPlusFtSafety(x);
  assert.equal(out.crossCore.tolerance,.01);
  assert.equal(out.crossCore.status,'FAIL');
});

test('invalid probabilities are unavailable rather than accepted',()=>{
  const out=evaluateSevenPlusFtSafety(body(1.2,.2,.1));
  assert.equal(out.rawFinalProbability,null);
  assert.equal(out.crossCore.status,'UNAVAILABLE');
  assert.equal(out.decisionUse,false);
});
