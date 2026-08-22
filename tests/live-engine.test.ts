import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLivePrediction, validateLiveState, CFI_LIVE_VERSION } from '../src/prediction/live-engine.ts';

const prematch={engine:'CFI_FINAL_V5.2.5',scoreline:{expectedGoals:{ftHome:1.7,ftAway:1.4}}};

test('live engine is deterministic for identical state',()=>{
  const state={minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:5,shotsOnTargetAway:3,dangerousAttacksHome:42,dangerousAttacksAway:31};
  const a=buildLivePrediction(prematch,state),b=buildLivePrediction(prematch,state);
  assert.deepEqual(a,b);
  assert.equal(a.engine,CFI_LIVE_VERSION);
  assert.equal(a.status,'SUCCESS');
  assert.equal(a.prematchSnapshotPolicy,'READ_ONLY_PRIOR_NO_WRITEBACK');
  assert.deepEqual(a.scoreline.ht.final,[{score:'0-1',probability:1}]);
  assert.equal(a.audit.prematchFtExpectation.home,1.7);
  assert.equal(a.audit.prematchFtExpectation.away,1.4);
  assert.ok(Math.abs(a.audit.prematchFtExpectation.total-3.1)<1e-12);
});

test('production final-engine expectedGoals shape drives live remaining-goal projection',()=>{
  const state={minute:20,period:'1H',homeGoals:0,awayGoals:0};
  const low=buildLivePrediction({scoreline:{expectedGoals:{ftHome:.6,ftAway:.5}}},state);
  const high=buildLivePrediction({scoreline:{expectedGoals:{ftHome:3.2,ftAway:2.6}}},state);
  assert.equal(low.audit.prematchFtExpectation.home,.6);
  assert.equal(low.audit.prematchFtExpectation.away,.5);
  assert.ok(Math.abs(low.audit.prematchFtExpectation.total-1.1)<1e-12);
  assert.equal(high.audit.prematchFtExpectation.home,3.2);
  assert.equal(high.audit.prematchFtExpectation.away,2.6);
  assert.ok(Math.abs(high.audit.prematchFtExpectation.total-5.8)<1e-12);
  assert.ok(high.audit.remainingGoalExpectation>low.audit.remainingGoalExpectation);
  assert.ok(high.markets['7+ FT'].final>low.markets['7+ FT'].final);
});

test('already-hit threshold becomes probability 1',()=>{
  const r=buildLivePrediction(prematch,{minute:35,period:'1H',homeGoals:2,awayGoals:1});
  assert.equal(r.markets['3+ HT'].final,1);
});

test('halftime state freezes HT outcome and continues FT projection',()=>{
  const r=buildLivePrediction(prematch,{minute:45,period:'HT',homeGoals:1,awayGoals:0});
  assert.equal(r.markets['3+ HT'].final,0);
  assert.deepEqual(r.scoreline.ht.final,[{score:'1-0',probability:1}]);
  assert.ok(r.scoreline.ft.final.length===3);
});

test('2H prediction fails closed without actual halftime score',()=>{
  assert.throws(()=>buildLivePrediction(prematch,{minute:62,period:'2H',homeGoals:1,awayGoals:1}),/LIVE_HT_STATE_REQUIRED_AFTER_HALFTIME/);
});

test('invalid live state fails closed',()=>{
  assert.throws(()=>validateLiveState({minute:80,period:'1H',homeGoals:0,awayGoals:0}),/INVALID_LIVE_PERIOD_MINUTE/);
});
