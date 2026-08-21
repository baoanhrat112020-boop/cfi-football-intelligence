import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLivePrediction, validateLiveState, CFI_LIVE_VERSION, CFI_LIVE_CONTRACT } from '../src/prediction/live-engine.ts';

const prematch={engine:'CFI_FINAL_V5.2.5',scoreline:{expected:{ft:{home:1.7,away:1.4}}}};
const markets=['3+ HT','7+ FT','Other HT','Other FT'];

function swapScore(score:string){const [h,a]=score.split('-');return `${a}-${h}`;}

test('live engine is deterministic for identical state',()=>{
  const state={minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:0,shotsOnTargetHome:5,shotsOnTargetAway:3,dangerousAttacksHome:42,dangerousAttacksAway:31};
  const a=buildLivePrediction(prematch,state),b=buildLivePrediction(prematch,state);
  assert.deepEqual(a,b);
  assert.equal(a.engine,CFI_LIVE_VERSION);
  assert.equal(a.status,'SUCCESS');
  assert.equal(a.contract,CFI_LIVE_CONTRACT);
  assert.equal(a.prematchSnapshotPolicy,'READ_ONLY_PRIOR_NO_WRITEBACK');
});

test('already-hit threshold becomes probability 1 for A B and FINAL',()=>{
  const r=buildLivePrediction(prematch,{minute:35,period:'1H',homeGoals:2,awayGoals:1});
  assert.deepEqual(r.markets['3+ HT'],{methodA:1,methodB:1,final:1});
});

test('2H uses immutable halftime score rather than current score',()=>{
  const r=buildLivePrediction(prematch,{minute:70,period:'2H',homeGoals:2,awayGoals:1,htHomeGoals:0,htAwayGoals:0});
  assert.deepEqual(r.markets['3+ HT'],{methodA:0,methodB:0,final:0});
  assert.deepEqual(r.markets['Other HT'],{methodA:0,methodB:0,final:0});
  assert.deepEqual(r.scoreline.ht.final,[{score:'0-0',probability:1}]);
  assert.match(r.mostLikelyPath,/^0-0 HT → /);
});

test('frozen halftime threshold outcomes remain exact after second-half goals',()=>{
  const three=buildLivePrediction(prematch,{minute:72,period:'2H',homeGoals:3,awayGoals:2,htHomeGoals:3,htAwayGoals:0});
  assert.equal(three.markets['3+ HT'].final,1);
  assert.equal(three.markets['Other HT'].final,0);
  const other=buildLivePrediction(prematch,{minute:72,period:'2H',homeGoals:4,awayGoals:3,htHomeGoals:4,htAwayGoals:0});
  assert.equal(other.markets['Other HT'].final,1);
  assert.deepEqual(other.scoreline.ht.final,[{score:'4-0',probability:1}]);
});

test('post-halftime live state fails closed without frozen halftime score',()=>{
  assert.throws(()=>validateLiveState({minute:70,period:'2H',homeGoals:2,awayGoals:1}),/HALFTIME_SCORE_REQUIRED/);
  assert.throws(()=>validateLiveState({minute:45,period:'HT',homeGoals:1,awayGoals:0,htHomeGoals:0,htAwayGoals:0}),/HALFTIME_SCORE_MISMATCH/);
  assert.throws(()=>validateLiveState({minute:70,period:'2H',homeGoals:1,awayGoals:0,htHomeGoals:2,htAwayGoals:0}),/HALFTIME_SCORE_INVALID/);
});

test('all six live targets preserve Method A Method B and FINAL integrity',()=>{
  const r=buildLivePrediction(prematch,{minute:31,period:'1H',homeGoals:1,awayGoals:0,shotsOnTargetHome:6,shotsOnTargetAway:1,dangerousAttacksHome:45,dangerousAttacksAway:18});
  for(const m of markets){for(const f of ['methodA','methodB','final'])assert.ok(Number.isFinite(r.markets[m][f]),`${m}.${f}`);assert.equal(r.markets[m].final,(r.markets[m].methodA+r.markets[m].methodB)/2);}
  for(const phase of ['ht','ft'])for(const f of ['methodA','methodB','final'])assert.ok(Array.isArray(r.scoreline[phase][f])&&r.scoreline[phase][f].length===3,`${phase}.${f}`);
  assert.equal(r.sixTargetMatrix.verification.complete,true);
  assert.equal(r.audit.methodIntegrity,'A_B_FINAL_PRESENT');
  assert.notEqual(r.markets['7+ FT'].methodA,r.markets['7+ FT'].methodB);
});

test('HOME AWAY swap changes directional scoreline consistently',()=>{
  const a=buildLivePrediction({engine:'CFI_FINAL_V5.2.5',scoreline:{expected:{ft:{home:2.4,away:.8}}}},{minute:60,period:'2H',homeGoals:2,awayGoals:0,htHomeGoals:1,htAwayGoals:0,shotsOnTargetHome:8,shotsOnTargetAway:2,dangerousAttacksHome:58,dangerousAttacksAway:20});
  const b=buildLivePrediction({engine:'CFI_FINAL_V5.2.5',scoreline:{expected:{ft:{home:.8,away:2.4}}}},{minute:60,period:'2H',homeGoals:0,awayGoals:2,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:2,shotsOnTargetAway:8,dangerousAttacksHome:20,dangerousAttacksAway:58});
  assert.equal(swapScore(a.scoreline.ft.final[0].score),b.scoreline.ft.final[0].score);
  assert.equal(swapScore(a.scoreline.ht.final[0].score),b.scoreline.ht.final[0].score);
});

test('materially different live match profiles do not collapse to identical six-target output',()=>{
  const low=buildLivePrediction({engine:'CFI_FINAL_V5.2.5',scoreline:{expected:{ft:{home:.8,away:.7}}}},{minute:30,period:'1H',homeGoals:0,awayGoals:0,shotsOnTargetHome:1,shotsOnTargetAway:0,dangerousAttacksHome:10,dangerousAttacksAway:8});
  const high=buildLivePrediction({engine:'CFI_FINAL_V5.2.5',scoreline:{expected:{ft:{home:2.8,away:2.1}}}},{minute:30,period:'1H',homeGoals:2,awayGoals:1,shotsOnTargetHome:8,shotsOnTargetAway:6,dangerousAttacksHome:55,dangerousAttacksAway:49});
  const fingerprint=(r:any)=>JSON.stringify({markets:Object.fromEntries(markets.map(m=>[m,r.markets[m].final])),ht:r.scoreline.ht.final,ft:r.scoreline.ft.final});
  assert.notEqual(fingerprint(low),fingerprint(high));
});

test('global priors are telemetry context only in LIVE output',()=>{
  const r=buildLivePrediction(prematch,{minute:20,period:'1H',homeGoals:0,awayGoals:0});
  assert.equal(r.globalPriorPolicy.thresholdGlobalPriorDirectShrinkage,false);
  assert.equal(r.globalPriorPolicy.scorelineGlobalPriorDirectShrinkage,false);
});

test('live production router contains strict temporal identity and prematch consistency gates',()=>{
  const router=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');
  for(const token of ['verifyExactTeamPair','LIVE_PRIOR_IDENTITY_AUDIT_FAILED','temporalVerified','LIVE_PRIOR_TEMPORAL_AUDIT_FAILED','validateReadonlyPrior','LIVE_PREMATCH_CONSISTENCY_FAILED','productionEntrypoint:PRODUCTION_ENTRYPOINT','directOutputShrinkage:false'])assert.match(router,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('invalid live period minute fails closed',()=>{
  assert.throws(()=>validateLiveState({minute:80,period:'1H',homeGoals:0,awayGoals:0}),/INVALID_LIVE_PERIOD_MINUTE/);
});
