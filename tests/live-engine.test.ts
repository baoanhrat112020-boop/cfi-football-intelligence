import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLivePrediction, validateLiveState, CFI_LIVE_VERSION, CFI_LIVE_MODEL_REVISION, CFI_LIVE_CONTRACT } from '../src/prediction/live-engine.ts';

const prematch={engine:'CFI_FINAL_V5.2.5',scoreline:{expectedGoals:{ftHome:1.7,ftAway:1.4}}};

test('live engine is deterministic for identical state',()=>{
  const state={minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:5,shotsOnTargetAway:3,dangerousAttacksHome:42,dangerousAttacksAway:31};
  const a=buildLivePrediction(prematch,state),b=buildLivePrediction(prematch,state);
  assert.deepEqual(a,b);
  assert.equal(a.engine,CFI_LIVE_VERSION);
  assert.equal(a.modelRevision,CFI_LIVE_MODEL_REVISION);
  assert.equal(a.contract,CFI_LIVE_CONTRACT);
  assert.equal(a.status,'SUCCESS');
  assert.equal(a.prematchSnapshotPolicy,'READ_ONLY_PRIOR_NO_WRITEBACK');
  assert.deepEqual(a.scoreline.ht.final,[{score:'0-1',probability:1}]);
  assert.equal(a.audit.prematchFtExpectation.home,1.7);
  assert.equal(a.audit.prematchFtExpectation.away,1.4);
  assert.ok(Math.abs(a.audit.prematchFtExpectation.total-3.1)<1e-12);
  assert.equal(a.audit.mutatesPrematch,false);
  assert.equal(a.audit.methodIntegrity,'A_B_FINAL_PRESENT');
  assert.equal(a.sixTargetMatrix.verification.methodA,true);
  assert.equal(a.sixTargetMatrix.verification.methodB,true);
  for(const row of Object.values(a.markets) as any[]){assert.ok(Number.isFinite(row.methodA));assert.ok(Number.isFinite(row.methodB));assert.ok(Number.isFinite(row.final));assert.ok(Math.abs(row.final-(row.methodA+row.methodB)/2)<1e-12);}
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

test('xG shot-quality evidence changes contextual Method B while Method A remains xG-free',()=>{
  const base={minute:30,period:'1H',homeGoals:0,awayGoals:0,shotsOnTargetHome:2,shotsOnTargetAway:2};
  const low=buildLivePrediction(prematch,{...base,xgHome:.2,xgAway:.15});
  const high=buildLivePrediction(prematch,{...base,xgHome:1.4,xgAway:1.1});
  assert.ok(Number(low.audit.hazard.qualityRate)<Number(high.audit.hazard.qualityRate));
  assert.equal(low.audit.remainingGoalExpectationMethods.methodA,high.audit.remainingGoalExpectationMethods.methodA);
  assert.ok(high.audit.remainingGoalExpectationMethods.methodB>low.audit.remainingGoalExpectationMethods.methodB);
  assert.ok(high.audit.remainingGoalExpectation>low.audit.remainingGoalExpectation);
  assert.equal(high.audit.mutatesPrematch,false);
});

test('estimated stoppage time expands the effective late-game horizon',()=>{
  const state={minute:88,period:'2H',homeGoals:2,awayGoals:2,htHomeGoals:1,htAwayGoals:1};
  const normal=buildLivePrediction(prematch,state);
  const long=buildLivePrediction(prematch,{...state,estimatedSecondHalfStoppageMinutes:10});
  assert.ok(long.audit.hazard.effectiveFtHorizon>normal.audit.hazard.effectiveFtHorizon);
  assert.ok(long.audit.remainingGoalExpectation>normal.audit.remainingGoalExpectation);
});

test('score state raises trailing-team contextual directional hazard',()=>{
  const tied=buildLivePrediction(prematch,{minute:65,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:0});
  const trailing=buildLivePrediction(prematch,{minute:65,period:'2H',homeGoals:0,awayGoals:1,htHomeGoals:0,htAwayGoals:0});
  assert.ok(trailing.audit.hazard.homeContextMultiplier>tied.audit.hazard.homeContextMultiplier);
  assert.ok(trailing.audit.hazard.directionalShareHome>tied.audit.hazard.directionalShareHome);
});

test('red card suppresses the penalized team directional hazard instead of acting as generic momentum',()=>{
  const state={minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:4,shotsOnTargetAway:4};
  const even=buildLivePrediction(prematch,state);
  const homeRed=buildLivePrediction(prematch,{...state,redCardsHome:1});
  assert.ok(homeRed.audit.hazard.homeContextMultiplier<even.audit.hazard.homeContextMultiplier);
  assert.ok(homeRed.audit.directionalRemainingGoalExpectation.home<even.audit.directionalRemainingGoalExpectation.home);
  assert.ok(homeRed.audit.hazard.directionalShareHome<even.audit.hazard.directionalShareHome);
});

test('league tempo input is bounded and substitutions remain telemetry-only',()=>{
  const state={minute:55,period:'2H',homeGoals:1,awayGoals:0,htHomeGoals:1,htAwayGoals:0,substitutionsHome:4,substitutionsAway:3};
  const neutral=buildLivePrediction(prematch,state);
  const fast=buildLivePrediction(prematch,{...state,leagueTempoFactor:1.15});
  assert.ok(fast.audit.remainingGoalExpectation>neutral.audit.remainingGoalExpectation);
  assert.equal(fast.audit.substitutionsTelemetryOnly,true);
  assert.throws(()=>validateLiveState({...state,leagueTempoFactor:1.7}),/INVALID_LIVE_FIELD_LEAGUETEMPOFACTOR/);
});

test('already-hit threshold becomes probability 1 for A B FINAL',()=>{
  const r=buildLivePrediction(prematch,{minute:35,period:'1H',homeGoals:2,awayGoals:1});
  assert.equal(r.markets['3+ HT'].methodA,1);assert.equal(r.markets['3+ HT'].methodB,1);assert.equal(r.markets['3+ HT'].final,1);
});

test('halftime state freezes HT outcome and continues FT projection',()=>{
  const r=buildLivePrediction(prematch,{minute:45,period:'HT',homeGoals:1,awayGoals:0});
  assert.equal(r.markets['3+ HT'].final,0);
  assert.equal(r.markets['3+ HT'].methodA,0);assert.equal(r.markets['3+ HT'].methodB,0);
  assert.deepEqual(r.scoreline.ht.final,[{score:'1-0',probability:1}]);
  assert.deepEqual(r.scoreline.ht.methodA,r.scoreline.ht.final);assert.deepEqual(r.scoreline.ht.methodB,r.scoreline.ht.final);
  assert.ok(r.scoreline.ft.final.length===3);
});

test('HOME/AWAY asymmetric prematch expectations produce different directional output',()=>{
  const state={minute:20,period:'1H',homeGoals:0,awayGoals:0};
  const homeStrong=buildLivePrediction({scoreline:{expectedGoals:{ftHome:2.8,ftAway:.7}}},state);
  const awayStrong=buildLivePrediction({scoreline:{expectedGoals:{ftHome:.7,ftAway:2.8}}},state);
  assert.notDeepEqual(homeStrong.scoreline.ft.final,awayStrong.scoreline.ft.final);
  assert.ok(homeStrong.audit.hazard.directionalShareHome>.5);
  assert.ok(awayStrong.audit.hazard.directionalShareHome<.5);
});

test('2H prediction fails closed without actual halftime score',()=>{
  assert.throws(()=>buildLivePrediction(prematch,{minute:62,period:'2H',homeGoals:1,awayGoals:1}),/LIVE_HT_STATE_REQUIRED_AFTER_HALFTIME/);
});

test('invalid live state fails closed',()=>{
  assert.throws(()=>validateLiveState({minute:80,period:'1H',homeGoals:0,awayGoals:0}),/INVALID_LIVE_PERIOD_MINUTE/);
  assert.throws(()=>validateLiveState({minute:20,period:'1H',homeGoals:0,awayGoals:0,xgHome:-.1}),/INVALID_LIVE_FIELD_XGHOME/);
});
