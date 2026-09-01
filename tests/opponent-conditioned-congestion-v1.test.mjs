import test from 'node:test';
import assert from 'node:assert/strict';
import { congestionFeatureVector, runOpponentConditionedCongestionV1 } from '../research/opponent-conditioned-congestion-v1.mjs';

const TEAMS=[['a','Alpha'],['b','Beta'],['c','Gamma'],['d','Delta']];
function day(n){return `2026-01-${String(n).padStart(2,'0')}`;}
function buildData(){
  const fixtures=[],strengths=[];
  for(let d=1;d<=12;d++){
    const date=day(d),pairs=d%2?[[0,1],[2,3]]:[[0,2],[1,3]];
    for(let j=0;j<pairs.length;j++){
      const [hi,ai]=pairs[j],[hid,h]=TEAMS[hi],[aid,a]=TEAMS[ai];
      const homeGoals=(d+j)%4,awayGoals=(d+2*j)%3,htHome=Math.min(homeGoals,(d+j)%2),htAway=Math.min(awayGoals,(d+j+1)%2);
      fixtures.push({fixture_id:`f-${d}-${j}`,match_date:date,home_team_id:hid,away_team_id:aid,home_team:h,away_team:a,ht_home:htHome,ht_away:htAway,ft_home:homeGoals,ft_away:awayGoals,status:'CANONICAL',competition_key:'test:l1',competition_name:'Test League',country:'Testland',season:'2025-26',competition_segment:'TEST_SEGMENT'});
    }
    for(const [id,name] of TEAMS){
      strengths.push({team_id:id,team_name:name,as_of_date:date,net_strength:id==='a'?1.2:id==='b'?.3:id==='c'?-.4:-1,confidence:1,strict_prior:true,competition_key:'test:l1',segment_v2:'M|SENIOR|TEST',feature_version:'TEST'});
    }
  }
  return {corpus:{fixtures},features:{baselineCommitSha:'518dfb57aafc8428e09b3ec84e440146c839a19e',strengths}};
}
const OPTIONS={skipSourceLock:true,minTeamPrior:1,minOnlineSamples:0,historyCap:5,lowConfidenceAbstain:0,evaluationStart:'2026-01-01',evaluationEnd:'2026-01-31'};

test('congestion strength enters only through fatigue interactions',()=>{
  assert.ok(congestionFeatureVector(7,7,2,-2).every(v=>v===0));
  const x=congestionFeatureVector(3,5,1.5,-.5);
  assert.equal(x.length,3);
  assert.notEqual(x[1],0);
  assert.notEqual(x[2],0);
});

test('challenger is strict-prior, deterministic, coherent, swap-safe and HOLD-only',()=>{
  const {corpus,features}=buildData();
  const a=runOpponentConditionedCongestionV1(corpus,features,OPTIONS);
  const b=runOpponentConditionedCongestionV1(corpus,features,OPTIONS);
  assert.equal(a.strictPrior,true);
  assert.equal(a.sameDateLeakage,false);
  assert.equal(a.futureLeakage,false);
  assert.equal(a.decisionUse,false);
  assert.equal(a.productionMutationAllowed,false);
  assert.equal(a.promotionDecision,'HOLD');
  assert.equal(a.shadowEligible,false);
  assert.ok(a.coverage.eligible>0);
  assert.equal(a.crossMarketCoherence.status,'PASS');
  assert.equal(a.directionalSwap.status,'PASS');
  assert.equal(a.determinism.fingerprint,b.determinism.fingerprint);
  assert.equal(a.metrics.productionBaseline.scoreline.ht.logLoss,null);
  assert.equal(a.metrics.productionBaseline.scoreline.ft.logLoss,null);
  assert.equal(a.scorelineComparison.productionBaselineFullGridLogLossAvailable,false);
  assert.ok(Number.isFinite(a.metrics.challenger.scoreline.ht.logLoss));
  assert.ok(Number.isFinite(a.metrics.challenger.scoreline.ft.logLoss));
  assert.ok(a.hardBlockers.includes('BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS'));
});

test('same-date input order cannot change the date-batched replay fingerprint',()=>{
  const {corpus,features}=buildData();
  const shuffled={fixtures:[...corpus.fixtures].sort((x,y)=>x.match_date===y.match_date?y.fixture_id.localeCompare(x.fixture_id):x.match_date.localeCompare(y.match_date))};
  const a=runOpponentConditionedCongestionV1(corpus,features,OPTIONS);
  const b=runOpponentConditionedCongestionV1(shuffled,features,OPTIONS);
  assert.equal(a.determinism.fingerprint,b.determinism.fingerprint);
  assert.equal(b.sameDateLeakage,false);
});

test('non-strict feature rows fail closed',()=>{
  const {corpus,features}=buildData();
  features.strengths[5]={...features.strengths[5],strict_prior:false};
  assert.throws(()=>runOpponentConditionedCongestionV1(corpus,features,OPTIONS),/CONGESTION_NON_STRICT_PRIOR_STRENGTH_ROW/);
});

test('prospective holdout rows fail closed instead of entering historical replay',()=>{
  const {corpus,features}=buildData();
  corpus.fixtures.push({fixture_id:'holdout',match_date:'2026-08-20',home_team_id:'a',away_team_id:'b',home_team:'Alpha',away_team:'Beta',ht_home:0,ht_away:0,ft_home:1,ft_away:0,status:'CANONICAL'});
  assert.throws(()=>runOpponentConditionedCongestionV1(corpus,features,OPTIONS),/CONGESTION_HOLDOUT_LEAKAGE/);
});
