import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMarketCoherence } from '../src/prediction/market-coherence.ts';

function base(){
  return{
    ranking:[
      {target:'3+ HT',probability:.20,confidence:'HIGH'},
      {target:'7+ FT',probability:.08,confidence:'HIGH'},
      {target:'Other HT',probability:.10,confidence:'HIGH'},
      {target:'Other FT',probability:.12,confidence:'HIGH'}
    ],
    markets:{
      '3+ HT':{final:.20,methodB:.18},
      '7+ FT':{final:.08,methodB:.07},
      'Other HT':{final:.10},
      'Other FT':{final:.12}
    },
    multiMarket:{
      overUnder:{
        ht:{'2.5':{over:{fullWin:.20}}},
        ft:{
          '4.5':{over:{fullWin:.25}},
          '6.5':{over:{fullWin:.08}}
        }
      }
    }
  };
}

test('coherent markets pass logical gate but unapproved extreme thresholds stay policy-blocked',()=>{
  const result=evaluateMarketCoherence(base());
  assert.equal(result.status,'PASS');
  assert.equal(result.decisionUse,false);
  assert.ok(result.safetyBlockedMarkets.includes('3+ HT'));
  assert.ok(result.safetyBlockedMarkets.includes('HT O2.5'));
  assert.ok(result.safetyBlockedMarkets.includes('7+ FT'));
  assert.ok(result.safetyBlockedMarkets.includes('FT O6.5'));
});

test('approved 3+ and 7+ calibrations release only the safety blocks when aliases are coherent',()=>{
  const b:any=base();
  b.threePlusHtCalibrationApproval={status:'APPROVED',version:'3CAL',calibratedProbability:.17};
  b.sevenPlusFtCalibrationApproval={status:'APPROVED',version:'7CAL',calibratedProbability:.06};
  const result=evaluateMarketCoherence(b);
  assert.equal(result.status,'PASS');
  assert.equal(result.decisionUse,true);
  assert.deepEqual(result.safetyBlockedMarkets,[]);
  assert.deepEqual(result.blockedMarkets,[]);
});

test('Other HT cannot exceed 3+ HT',()=>{
  const b=base();
  b.markets['Other HT'].final=.31;
  assert.equal(evaluateMarketCoherence(b).status,'FAIL');
});

test('Other FT cannot exceed FT O4.5',()=>{
  const b=base();
  b.markets['Other FT'].final=.40;
  assert.equal(evaluateMarketCoherence(b).status,'FAIL');
});

test('7+ FT must equal FT O6.5',()=>{
  const b=base();
  b.markets['7+ FT'].final=.20;
  assert.equal(evaluateMarketCoherence(b).status,'FAIL');
});

test('3+ HT must equal HT O2.5',()=>{
  const b=base();
  b.markets['3+ HT'].final=.35;
  assert.equal(evaluateMarketCoherence(b).status,'FAIL');
});

test('unavailable counterpart is not a proven logical contradiction',()=>{
  const b=base();
  delete b.multiMarket.overUnder.ft['6.5'];
  const result=evaluateMarketCoherence(b);
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(result.checks.find(x=>x.id==='SEVEN_PLUS_FT_EQ_FT_O6_5')?.status,'UNAVAILABLE');
  assert.ok(result.blockedMarkets.includes('7+ FT'));
  assert.ok(result.blockedMarkets.includes('FT O6.5'));
});
