import fs from 'node:fs/promises';
import { buildPrediction } from '../src/prediction/final-engine.ts';
import { buildIndependentScoreGrid, buildMultiMarketFromScoreGrids, MULTI_MARKET_VERSION } from '../src/prediction/multi-market-v1.ts';
import { PRODUCTION_BASELINE_LOCK, verifyProductionBaselineLock } from './production-baseline-lock.mjs';

export const OPPONENT_CONDITIONED_CONGESTION_V1 = Object.freeze({
  version: 'OPPONENT_CONDITIONED_CONGESTION_V1',
  researchOnly: true,
  decisionUse: false,
  strictPrior: true,
  sameDayExcluded: true,
  noReconstruction: true,
  baselineCommitSha: PRODUCTION_BASELINE_LOCK.commitSha,
  baselineEngine: PRODUCTION_BASELINE_LOCK.engine,
  primaryContract: PRODUCTION_BASELINE_LOCK.primaryContract,
  multiMarketVersion: PRODUCTION_BASELINE_LOCK.multiMarketVersion,
  minTeamPrior: 6,
  minOnlineSamples: 500,
  ridge: 50,
  htDeltaCap: 0.20,
  ftDeltaCap: 0.40,
  strengthClip: 2,
  lowConfidenceAbstain: 0.40,
});

const EPS = 1e-12;
const HT_OU = [0.5,1,1.5,2,2.5,3,3.5,4,4.5];
const FT_OU = [1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5];
const AH = [-2,-1.75,-1.5,-1.25,-1,-.75,-.5,-.25,0,.25,.5,.75,1,1.25,1.5,1.75,2];
const CHAMPION = ['3+ HT','7+ FT','Other HT','Other FT'];
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const teamKey=s=>String(s??'').trim().toLowerCase();
const pairKey=(a,b)=>[teamKey(a),teamKey(b)].sort().join('|');
const dateMs=d=>Date.parse(`${d}T00:00:00Z`);
const dayDiff=(a,b)=>Math.round((dateMs(a)-dateMs(b))/86400000);
const scoreKey=(h,a)=>`${h}-${a}`;

function canonicalRows(corpus){
  const input=Array.isArray(corpus)?corpus:(corpus?.fixtures??[]);
  const rows=[];
  for(const r of input){
    const date=String(r.match_date??r.matchDate??'').slice(0,10);
    const home=String(r.home_team??r.homeTeam??'').trim(),away=String(r.away_team??r.awayTeam??'').trim();
    const hh=Number(r.ht_home),ha=Number(r.ht_away),fh=Number(r.ft_home),fa=Number(r.ft_away);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!home||!away)continue;
    if(![hh,ha,fh,fa].every(Number.isSafeInteger)||[hh,ha,fh,fa].some(x=>x<0)||hh>fh||ha>fa)continue;
    rows.push({
      id:String(r.fixture_id??r.id??`${date}|${home}|${away}`),matchDate:date,homeTeam:home,awayTeam:away,
      homeTeamId:String(r.home_team_id??''),awayTeamId:String(r.away_team_id??''),
      ht:{home:hh,away:ha},ft:{home:fh,away:fa},
      competitionKey:r.competition_key??null,competitionSegment:r.competition_segment??null,season:r.season??null,country:r.country??null,
    });
  }
  return [...new Map(rows.map(r=>[`${r.matchDate}|${teamKey(r.homeTeam)}|${teamKey(r.awayTeam)}`,r])).values()]
    .sort((a,b)=>a.matchDate.localeCompare(b.matchDate)||a.id.localeCompare(b.id));
}

function strengthMap(bundle){
  const rows=Array.isArray(bundle)?bundle:(bundle?.strengths??[]),map=new Map();
  for(const r of rows){
    if(r.strict_prior!==true)throw new Error('CONGESTION_NON_STRICT_PRIOR_STRENGTH_ROW');
    const key=`${String(r.team_id)}|${String(r.as_of_date).slice(0,10)}`;
    map.set(key,r);
  }
  return map;
}

class RecursiveRidge{
  constructor(dim,ridge){
    this.dim=dim;this.beta=Array(dim).fill(0);this.p=Array.from({length:dim},(_,i)=>Array.from({length:dim},(_,j)=>i===j?1/ridge:0));this.n=0;
  }
  predict(x){return this.beta.reduce((s,b,i)=>s+b*x[i],0);}
  update(x,y){
    const px=this.p.map(row=>row.reduce((s,v,j)=>s+v*x[j],0));
    const denom=1+x.reduce((s,v,i)=>s+v*px[i],0);if(!(denom>EPS))return;
    const gain=px.map(v=>v/denom),err=y-this.predict(x);
    this.beta=this.beta.map((b,i)=>b+gain[i]*err);
    const xp=Array(this.dim).fill(0).map((_,j)=>x.reduce((s,v,i)=>s+v*this.p[i][j],0));
    this.p=this.p.map((row,i)=>row.map((v,j)=>v-gain[i]*xp[j]));this.n++;
  }
  snapshot(){return{n:this.n,beta:this.beta.map(x=>Number(x.toFixed(8)))};}
}

function effectiveStrength(row){
  const strength=clamp(Number(row?.net_strength??0),-OPPONENT_CONDITIONED_CONGESTION_V1.strengthClip,OPPONENT_CONDITIONED_CONGESTION_V1.strengthClip);
  const confidence=clamp(Number(row?.confidence??0),0,1);
  return strength*confidence;
}
function fatigue(restDays){return clamp((7-restDays)/6,0,1);}
function features(selfRest,oppRest,selfStrength,oppStrength){
  const fs=fatigue(selfRest),fo=fatigue(oppRest);
  return [fs,fs*oppStrength,fo*selfStrength];
}

function normalizeGrid(grid){const z=grid.reduce((s,r)=>s+r.probability,0)||1;return grid.map(r=>({...r,probability:r.probability/z}));}
function top(grid,n=3){return[...grid].sort((a,b)=>b.probability-a.probability||a.home-b.home||a.away-b.away).slice(0,n);}
function eventMass(grid,event){
  let s=0;for(const r of grid){const hit=event==='3+ HT'?r.total>=3:event==='7+ FT'?r.total>=7:event==='Other HT'?Math.max(r.home,r.away)>=4:Math.max(r.home,r.away)>=5;if(hit)s+=r.probability;}return s;
}
function cellProbability(grid,score){return grid.find(r=>r.home===score.home&&r.away===score.away)?.probability??0;}
function oneOutcome(score){return score.home>score.away?'home':score.home<score.away?'away':'draw';}

function newMetric(){return{n:0,brier:0,logLoss:0};}
function addCategorical(m,probs,actualIndex){
  if(actualIndex<0||actualIndex>=probs.length||probs.some(p=>!Number.isFinite(p)||p<0))return;
  const z=probs.reduce((a,b)=>a+b,0);if(!(z>0))return;const ps=probs.map(p=>p/z);
  m.n++;m.brier+=ps.reduce((s,p,i)=>s+(p-(i===actualIndex?1:0))**2,0)/ps.length;m.logLoss+=-Math.log(Math.max(EPS,ps[actualIndex]));
}
function addBinary(m,p,y){addCategorical(m,[1-p,p],y?1:0);}
function finish(m){return{n:m.n,brier:m.n?m.brier/m.n:null,logLoss:m.n?m.logLoss/m.n:null};}
function newFamily(lines=[]){return{aggregate:newMetric(),lines:Object.fromEntries(lines.map(x=>[String(x),newMetric()]))};}
function finishFamily(f){return{aggregate:finish(f.aggregate),lines:Object.fromEntries(Object.entries(f.lines).map(([k,v])=>[k,finish(v)]))};}

function splitQuarter(line){const q=Math.round(line*4)/4,frac=Math.abs(q-Math.trunc(q));return Math.abs(frac-.25)<1e-9||Math.abs(frac-.75)<1e-9?[q-.25,q+.25]:[q,q];}
function cls(x){return x>1e-9?'WIN':x<-1e-9?'LOSS':'PUSH';}
function stateFromParts(a,b){
  const x=cls(a),y=cls(b);if(x==='WIN'&&y==='WIN')return'fullWin';if(x==='LOSS'&&y==='LOSS')return'fullLoss';if(x==='PUSH'&&y==='PUSH')return'push';
  if((x==='WIN'&&y==='PUSH')||(x==='PUSH'&&y==='WIN'))return'halfWin';if((x==='LOSS'&&y==='PUSH')||(x==='PUSH'&&y==='LOSS'))return'halfLoss';return'push';
}
function ouState(total,line){const[a,b]=splitQuarter(line);return stateFromParts(total-a,total-b);}
function ahState(diff,line){const[a,b]=splitQuarter(line);return stateFromParts(diff+a,diff+b);}
const STATE_KEYS=['fullWin','halfWin','push','halfLoss','fullLoss'];
function settlementProbs(s){return STATE_KEYS.map(k=>Number(s?.[k]??0));}

function ece(records,bins=10){
  if(!records.length)return null;let total=0;
  for(let b=0;b<bins;b++){const lo=b/bins,hi=(b+1)/bins;const xs=records.filter(r=>r.p>=lo&&(b===bins-1?r.p<=hi:r.p<hi));if(!xs.length)continue;const avgP=xs.reduce((s,r)=>s+r.p,0)/xs.length,avgY=xs.reduce((s,r)=>s+r.y,0)/xs.length;total+=xs.length/records.length*Math.abs(avgP-avgY);}return total;
}
function addCalibration(records,probs,actual){for(let i=0;i<probs.length;i++)records.push({p:probs[i],y:i===actual?1:0});}

function initModelMetrics(){return{
  champion:Object.fromEntries(CHAMPION.map(m=>[m,newMetric()])),
  oneXTwo:{ht:newMetric(),ft:newMetric()},
  overUnder:{ht:newFamily(HT_OU),ft:newFamily(FT_OU)},
  asianHandicap:{ht:newFamily(AH),ft:newFamily(AH)},
  scoreline:{ht:{n:0,top1:0,top3:0,logLoss:0},ft:{n:0,top1:0,top3:0,logLoss:0}},
  calibration:[],
};}
function finishScoreline(x){return{n:x.n,top1Accuracy:x.n?x.top1/x.n:null,top3Accuracy:x.n?x.top3/x.n:null,logLoss:x.n?x.logLoss/x.n:null};}
function finishModel(x){return{
  champion:Object.fromEntries(Object.entries(x.champion).map(([k,v])=>[k,finish(v)])),oneXTwo:{ht:finish(x.oneXTwo.ht),ft:finish(x.oneXTwo.ft)},
  overUnder:{ht:finishFamily(x.overUnder.ht),ft:finishFamily(x.overUnder.ft)},asianHandicap:{ht:finishFamily(x.asianHandicap.ht),ft:finishFamily(x.asianHandicap.ft)},
  scoreline:{ht:finishScoreline(x.scoreline.ht),ft:finishScoreline(x.scoreline.ft)},calibrationEce:ece(x.calibration),
};}

function addScoreline(metric,grid,actual,topRows=top(grid,3)){
  const actualKey=scoreKey(actual.home,actual.away),keys=topRows.map(r=>scoreKey(r.home,r.away));metric.n++;if(keys[0]===actualKey)metric.top1++;if(keys.includes(actualKey))metric.top3++;metric.logLoss+=-Math.log(Math.max(EPS,cellProbability(grid,actual)));
}
function baselineTopRows(pred,part){return (pred?.scoreline?.[part]?.final??[]).map(r=>{const [home,away]=String(r.score).split('-').map(Number);return{home,away,probability:Number(r.probability),total:home+away};});}
function addBaselineTopOnly(metric,pred,part,actual){const rows=baselineTopRows(pred,part);const key=scoreKey(actual.home,actual.away),keys=rows.map(r=>scoreKey(r.home,r.away));metric.n++;if(keys[0]===key)metric.top1++;if(keys.includes(key))metric.top3++;}

function addModelMarketMetrics(metrics,mm,htGrid,ftGrid,target,prediction=null){
  const championProbs={
    '3+ HT':htGrid?eventMass(htGrid,'3+ HT'):Number(prediction?.markets?.['3+ HT']?.final),
    '7+ FT':ftGrid?eventMass(ftGrid,'7+ FT'):Number(prediction?.markets?.['7+ FT']?.final),
    'Other HT':htGrid?eventMass(htGrid,'Other HT'):Number(prediction?.markets?.['Other HT']?.final),
    'Other FT':ftGrid?eventMass(ftGrid,'Other FT'):Number(prediction?.markets?.['Other FT']?.final),
  };
  const actualChampion={'3+ HT':target.ht.home+target.ht.away>=3,'7+ FT':target.ft.home+target.ft.away>=7,'Other HT':Math.max(target.ht.home,target.ht.away)>=4,'Other FT':Math.max(target.ft.home,target.ft.away)>=5};
  for(const m of CHAMPION){const p=championProbs[m];addBinary(metrics.champion[m],p,actualChampion[m]);metrics.calibration.push({p,y:actualChampion[m]?1:0});}
  for(const part of ['ht','ft']){
    const actual=target[part],out=oneOutcome(actual),one=mm.oneXTwo[part],probs=[one.home,one.draw,one.away],idx=['home','draw','away'].indexOf(out);addCategorical(metrics.oneXTwo[part],probs,idx);addCalibration(metrics.calibration,probs,idx);
    const total=actual.home+actual.away;
    const ouLines=part==='ht'?HT_OU:FT_OU;
    for(const line of ouLines){const dist=mm.overUnder[part][String(line)].over,actualState=ouState(total,line),ps=settlementProbs(dist),si=STATE_KEYS.indexOf(actualState);addCategorical(metrics.overUnder[part].lines[String(line)],ps,si);addCategorical(metrics.overUnder[part].aggregate,ps,si);addCalibration(metrics.calibration,ps,si);}
    const diff=actual.home-actual.away;
    for(const line of AH){const dist=mm.asianHandicap[part][String(line)].home,actualState=ahState(diff,line),ps=settlementProbs(dist),si=STATE_KEYS.indexOf(actualState);addCategorical(metrics.asianHandicap[part].lines[String(line)],ps,si);addCategorical(metrics.asianHandicap[part].aggregate,ps,si);addCalibration(metrics.calibration,ps,si);}
  }
  if(htGrid)addScoreline(metrics.scoreline.ht,htGrid,target.ht);else addBaselineTopOnly(metrics.scoreline.ht,prediction,'ht',target.ht);
  if(ftGrid)addScoreline(metrics.scoreline.ft,ftGrid,target.ft);else addBaselineTopOnly(metrics.scoreline.ft,prediction,'ft',target.ft);
}

function aggregateBrierFinished(m){
  const vals=[];for(const row of Object.values(m.champion))if(row.brier!==null)vals.push(row.brier);for(const part of ['ht','ft']){if(m.oneXTwo[part].brier!==null)vals.push(m.oneXTwo[part].brier);if(m.overUnder[part].aggregate.brier!==null)vals.push(m.overUnder[part].aggregate.brier);if(m.asianHandicap[part].aggregate.brier!==null)vals.push(m.asianHandicap[part].aggregate.brier);}return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function aggregateLogLossFinished(m){
  const vals=[];for(const row of Object.values(m.champion))if(row.logLoss!==null)vals.push(row.logLoss);for(const part of ['ht','ft']){if(m.oneXTwo[part].logLoss!==null)vals.push(m.oneXTwo[part].logLoss);if(m.overUnder[part].aggregate.logLoss!==null)vals.push(m.overUnder[part].aggregate.logLoss);if(m.asianHandicap[part].aggregate.logLoss!==null)vals.push(m.asianHandicap[part].aggregate.logLoss);}return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}

export function runOpponentConditionedCongestionV1(corpus,featureBundle,options={}){
  const verifyBaseline=options.skipSourceLock===true?{status:'TEST_ONLY_SKIP'}:verifyProductionBaselineLock(options.baselineLockOptions??{});
  if(PRODUCTION_BASELINE_LOCK.multiMarketVersion!==MULTI_MARKET_VERSION)throw new Error('CONGESTION_MULTI_MARKET_VERSION_DRIFT');
  const rows=canonicalRows(corpus),strengths=strengthMap(featureBundle);
  const teamPrior=new Map(),h2hPrior=new Map(),lastDate=new Map();
  const htModel=new RecursiveRidge(3,OPPONENT_CONDITIONED_CONGESTION_V1.ridge),ftModel=new RecursiveRidge(3,OPPONENT_CONDITIONED_CONGESTION_V1.ridge);
  const baselineMetrics=initModelMetrics(),controlMetrics=initModelMetrics(),challengerMetrics=initModelMetrics();
  const segment=new Map();let eligible=0,featureMissing=0,priorMissing=0,maturitySkipped=0,abstain=0,clipped=0;

  for(let start=0;start<rows.length;){
    const date=rows[start].matchDate;let end=start+1;while(end<rows.length&&rows[end].matchDate===date)end++;const batch=rows.slice(start,end),updates=[];
    for(const target of batch){
      const hp=teamPrior.get(teamKey(target.homeTeam))??[],ap=teamPrior.get(teamKey(target.awayTeam))??[],h2h=h2hPrior.get(pairKey(target.homeTeam,target.awayTeam))??[];
      if(hp.length<OPPONENT_CONDITIONED_CONGESTION_V1.minTeamPrior||ap.length<OPPONENT_CONDITIONED_CONGESTION_V1.minTeamPrior){priorMissing++;continue;}
      const hs=strengths.get(`${target.homeTeamId}|${date}`),as=strengths.get(`${target.awayTeamId}|${date}`),hPrev=lastDate.get(target.homeTeamId),aPrev=lastDate.get(target.awayTeamId);
      if(!hs||!as||!hPrev||!aPrev){featureMissing++;continue;}
      if(String(hs.as_of_date)!==date||String(as.as_of_date)!==date||hs.strict_prior!==true||as.strict_prior!==true)throw new Error('CONGESTION_FEATURE_TEMPORAL_VIOLATION');
      const hRest=dayDiff(date,hPrev),aRest=dayDiff(date,aPrev);if(!(hRest>0)||!(aRest>0))throw new Error('CONGESTION_REST_TEMPORAL_VIOLATION');
      const hStrength=effectiveStrength(hs),aStrength=effectiveStrength(as),xh=features(hRest,aRest,hStrength,aStrength),xa=features(aRest,hRest,aStrength,hStrength);
      const pred=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:date,language:'en',homePayload:hp,awayPayload:ap,h2hPayload:h2h});
      const e=pred?.scoreline?.expectedGoals;if(!e||![e.htHome,e.htAway,e.ftHome,e.ftAway].every(v=>Number.isFinite(Number(v))&&Number(v)>=0)){featureMissing++;continue;}
      const base={htHome:Number(e.htHome),htAway:Number(e.htAway),ftHome:Number(e.ftHome),ftAway:Number(e.ftAway)};
      updates.push({xh,xa,htHome:target.ht.home-base.htHome,htAway:target.ht.away-base.htAway,ftHome:target.ft.home-base.ftHome,ftAway:target.ft.away-base.ftAway});
      if(htModel.n<OPPONENT_CONDITIONED_CONGESTION_V1.minOnlineSamples||ftModel.n<OPPONENT_CONDITIONED_CONGESTION_V1.minOnlineSamples){maturitySkipped++;continue;}
      const rawDeltas={htHome:htModel.predict(xh),htAway:htModel.predict(xa),ftHome:ftModel.predict(xh),ftAway:ftModel.predict(xa)};
      const deltas={htHome:clamp(rawDeltas.htHome,-.2,.2),htAway:clamp(rawDeltas.htAway,-.2,.2),ftHome:clamp(rawDeltas.ftHome,-.4,.4),ftAway:clamp(rawDeltas.ftAway,-.4,.4)};
      const wasClipped=Object.keys(deltas).some(k=>Math.abs(deltas[k]-rawDeltas[k])>1e-12);if(wasClipped)clipped++;
      const adj={htHome:clamp(base.htHome+deltas.htHome,.03,8),htAway:clamp(base.htAway+deltas.htAway,.03,8),ftHome:clamp(base.ftHome+deltas.ftHome,.05,12),ftAway:clamp(base.ftAway+deltas.ftAway,.05,12)};
      adj.ftHome=Math.max(adj.ftHome,adj.htHome);adj.ftAway=Math.max(adj.ftAway,adj.htAway);
      const controlHt=normalizeGrid(buildIndependentScoreGrid(base.htHome,base.htAway,10)),controlFt=normalizeGrid(buildIndependentScoreGrid(base.ftHome,base.ftAway,14));
      const challengerHt=normalizeGrid(buildIndependentScoreGrid(adj.htHome,adj.htAway,10)),challengerFt=normalizeGrid(buildIndependentScoreGrid(adj.ftHome,adj.ftAway,14));
      const controlMm=buildMultiMarketFromScoreGrids({ht:controlHt,ft:controlFt}),challengerMm=buildMultiMarketFromScoreGrids({ht:challengerHt,ft:challengerFt});
      if(pred?.multiMarket?.consistencyGuard?.status!=='PASS'||controlMm.consistencyGuard.status!=='PASS'||challengerMm.consistencyGuard.status!=='PASS')throw new Error('CONGESTION_CROSS_MARKET_COHERENCE_FAIL');
      addModelMarketMetrics(baselineMetrics,pred.multiMarket,null,null,target,pred);addModelMarketMetrics(controlMetrics,controlMm,controlHt,controlFt,target);addModelMarketMetrics(challengerMetrics,challengerMm,challengerHt,challengerFt,target);
      const lowConfidence=Math.min(Number(hs.confidence??0),Number(as.confidence??0))<OPPONENT_CONDITIONED_CONGESTION_V1.lowConfidenceAbstain;if(lowConfidence||wasClipped)abstain++;
      const seg=String(target.competitionSegment??'UNKNOWN');if(!segment.has(seg))segment.set(seg,{n:0});segment.get(seg).n++;eligible++;
    }
    for(const u of updates){htModel.update(u.xh,u.htHome);htModel.update(u.xa,u.htAway);ftModel.update(u.xh,u.ftHome);ftModel.update(u.xa,u.ftAway);}
    for(const f of batch){for(const name of [f.homeTeam,f.awayTeam]){const k=teamKey(name),arr=teamPrior.get(k)??[];arr.push({id:f.id,matchDate:f.matchDate,homeTeam:f.homeTeam,awayTeam:f.awayTeam,ht:f.ht,ft:f.ft});teamPrior.set(k,arr);}const pk=pairKey(f.homeTeam,f.awayTeam),pa=h2hPrior.get(pk)??[];pa.push({id:f.id,matchDate:f.matchDate,homeTeam:f.homeTeam,awayTeam:f.awayTeam,ht:f.ht,ft:f.ft});h2hPrior.set(pk,pa);if(f.homeTeamId)lastDate.set(f.homeTeamId,date);if(f.awayTeamId)lastDate.set(f.awayTeamId,date);}
    start=end;
  }
  const baseline=finishModel(baselineMetrics),control=finishModel(controlMetrics),challenger=finishModel(challengerMetrics);
  const b0=aggregateBrierFinished(baseline),bc=aggregateBrierFinished(challenger),bp=aggregateBrierFinished(control),l0=aggregateLogLossFinished(baseline),lc=aggregateLogLossFinished(challenger),lp=aggregateLogLossFinished(control);
  const result={
    version:OPPONENT_CONDITIONED_CONGESTION_V1.version,status:'RESEARCH_ONLY',baselineLock:verifyBaseline,baseline:{engine:PRODUCTION_BASELINE_LOCK.engine,runtime:PRODUCTION_BASELINE_LOCK.runtime,primaryContract:PRODUCTION_BASELINE_LOCK.primaryContract,multiMarketVersion:MULTI_MARKET_VERSION,commitSha:PRODUCTION_BASELINE_LOCK.commitSha},
    strictPrior:true,sameDateLeakage:false,futureLeakage:false,noReconstruction:true,decisionUse:false,productionMutationAllowed:false,
    featurePolicy:{mainStrengthEffect:false,interactionOnly:true,features:['self_fatigue','self_fatigue_x_opponent_strength','opponent_fatigue_x_self_strength'],strengthClip:2,onlineLearner:'DATE_BATCHED_RECURSIVE_RIDGE',updatePolicy:'AFTER_COMPLETE_TARGET_DATE_BATCH'},
    coverage:{fixtureCount:rows.length,eligible,maturitySkipped,featureMissing,priorMissing,abstain,abstainRate:eligible?abstain/eligible:null,clipped,segments:Object.fromEntries(segment)},
    learner:{ht:htModel.snapshot(),ft:ftModel.snapshot()},metrics:{productionBaseline:baseline,matchedPoissonControl:control,challenger},
    aggregate:{productionBaseline:{brier:b0,logLoss:l0,calibrationEce:baseline.calibrationEce},matchedControl:{brier:bp,logLoss:lp,calibrationEce:control.calibrationEce},challenger:{brier:bc,logLoss:lc,calibrationEce:challenger.calibrationEce},deltaVsProduction:{brier:b0===null||bc===null?null:bc-b0,logLoss:l0===null||lc===null?null:lc-l0,calibrationEce:baseline.calibrationEce===null||challenger.calibrationEce===null?null:challenger.calibrationEce-baseline.calibrationEce},deltaVsMatchedControl:{brier:bp===null||bc===null?null:bc-bp,logLoss:lp===null||lc===null?null:lc-lp,calibrationEce:control.calibrationEce===null||challenger.calibrationEce===null?null:challenger.calibrationEce-control.calibrationEce}},
    directionalSwap:{status:'PASS_BY_SYMMETRIC_FEATURE_CONSTRUCTION',sameScoringLearnerForHomeAway:true},determinism:{status:'PASS_BY_DETERMINISTIC_DATE_BATCHED_ALGORITHM'},crossMarketCoherence:{status:'PASS',version:'CFI_CROSS_MARKET_COHERENCE_GATE_V1'},
    boardImpact:{status:'BLOCKED_NO_SYNCHRONIZED_HISTORICAL_ODDS',decisionUse:false},shadowEligible:false,promotionDecision:'HOLD',productionEligible:false,
  };
  return result;
}

async function main(){
  const corpusPath=process.argv[2],featurePath=process.argv[3],output=process.argv[4];if(!corpusPath||!featurePath)throw new Error('Usage: node --experimental-strip-types research/opponent-conditioned-congestion-v1.mjs <r0-corpus.json> <group-a-features.json> [output.json]');
  const corpus=JSON.parse(await fs.readFile(corpusPath,'utf8')),features=JSON.parse(await fs.readFile(featurePath,'utf8')),result=runOpponentConditionedCongestionV1(corpus,features);
  const text=JSON.stringify(result,null,2);if(output)await fs.writeFile(output,text+'\n');else process.stdout.write(text+'\n');
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
