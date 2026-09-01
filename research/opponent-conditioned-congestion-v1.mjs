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
  warmupStart: '2015-01-01',
  evaluationStart: '2016-01-01',
  evaluationEnd: '2026-08-19',
  holdoutStart: '2026-08-20',
  historyCap: 40,
  minTeamPrior: 6,
  minOnlineSamples: 500,
  ridge: 50,
  htDeltaCap: 0.20,
  ftDeltaCap: 0.40,
  strengthClip: 2,
  lowConfidenceAbstain: 0.40,
  calibrationBins: 10,
  swapAuditMax: 256,
});

const EPS = 1e-12;
const HT_OU = [0.5,1,1.5,2,2.5,3,3.5,4,4.5];
const FT_OU = [1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5];
const AH = [-2,-1.75,-1.5,-1.25,-1,-.75,-.5,-.25,0,.25,.5,.75,1,1.25,1.5,1.75,2];
const CHAMPION = ['3+ HT','7+ FT','Other HT','Other FT'];
const STATE_KEYS = ['fullWin','halfWin','push','halfLoss','fullLoss'];
const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const key = s => String(s ?? '').trim().toLowerCase();
const pairKey = (a,b) => [key(a),key(b)].sort().join('|');
const dateMs = d => Date.parse(`${d}T00:00:00Z`);
const dayDiff = (a,b) => Math.round((dateMs(a)-dateMs(b))/86400000);
const tail = (rows,cap) => rows.length <= cap ? rows : rows.slice(rows.length-cap);
const scoreKey = s => `${s.home}-${s.away}`;

function finiteScore(x){ return Number.isSafeInteger(Number(x)) && Number(x) >= 0; }
function canonicalRows(corpus){
  const input = Array.isArray(corpus) ? corpus : (corpus?.fixtures ?? []);
  const rows = [];
  for(const r of input){
    const matchDate = String(r.match_date ?? r.matchDate ?? '').slice(0,10);
    const homeTeam = String(r.home_team ?? r.homeTeam ?? '').trim();
    const awayTeam = String(r.away_team ?? r.awayTeam ?? '').trim();
    const ht = {home:Number(r.ht_home ?? r.ht?.home),away:Number(r.ht_away ?? r.ht?.away)};
    const ft = {home:Number(r.ft_home ?? r.ft?.home),away:Number(r.ft_away ?? r.ft?.away)};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate) || !homeTeam || !awayTeam) continue;
    if(![ht.home,ht.away,ft.home,ft.away].every(finiteScore) || ht.home>ft.home || ht.away>ft.away) continue;
    if(matchDate >= OPPONENT_CONDITIONED_CONGESTION_V1.holdoutStart) throw new Error('CONGESTION_HOLDOUT_LEAKAGE');
    rows.push({
      id:String(r.fixture_id ?? r.id ?? `${matchDate}|${homeTeam}|${awayTeam}`),
      matchDate,homeTeam,awayTeam,ht,ft,
      homeTeamId:String(r.home_team_id ?? ''),awayTeamId:String(r.away_team_id ?? ''),
      competitionKey:r.competition_key ?? null,competitionSegment:r.competition_segment ?? null,
      season:r.season ?? null,country:r.country ?? null,
    });
  }
  return [...new Map(rows.map(r => [`${r.matchDate}|${key(r.homeTeam)}|${key(r.awayTeam)}`,r])).values()]
    .sort((a,b) => a.matchDate.localeCompare(b.matchDate) || a.id.localeCompare(b.id));
}

function strengthMap(bundle){
  if(bundle?.baselineCommitSha && bundle.baselineCommitSha !== PRODUCTION_BASELINE_LOCK.commitSha) throw new Error('CONGESTION_FEATURE_BASELINE_LINEAGE_DRIFT');
  const rows = Array.isArray(bundle) ? bundle : (bundle?.strengths ?? []);
  const out = new Map();
  for(const r of rows){
    if(r.strict_prior !== true) throw new Error('CONGESTION_NON_STRICT_PRIOR_STRENGTH_ROW');
    const asOf = String(r.as_of_date ?? '').slice(0,10);
    if(asOf >= OPPONENT_CONDITIONED_CONGESTION_V1.holdoutStart) throw new Error('CONGESTION_STRENGTH_HOLDOUT_LEAKAGE');
    out.set(`${String(r.team_id)}|${asOf}`,{net_strength:Number(r.net_strength ?? 0),confidence:Number(r.confidence ?? 0)});
  }
  return out;
}

class RecursiveRidge {
  constructor(dim,ridge){
    this.dim=dim;this.beta=Array(dim).fill(0);
    this.p=Array.from({length:dim},(_,i)=>Array.from({length:dim},(_,j)=>i===j?1/ridge:0));
    this.n=0;
  }
  predict(x){ return this.beta.reduce((s,b,i)=>s+b*x[i],0); }
  update(x,y){
    const px=this.p.map(row=>row.reduce((s,v,j)=>s+v*x[j],0));
    const den=1+x.reduce((s,v,i)=>s+v*px[i],0); if(!(den>EPS)) return;
    const gain=px.map(v=>v/den),err=y-this.predict(x);
    this.beta=this.beta.map((b,i)=>b+gain[i]*err);
    const xp=Array.from({length:this.dim},(_,j)=>x.reduce((s,v,i)=>s+v*this.p[i][j],0));
    this.p=this.p.map((row,i)=>row.map((v,j)=>v-gain[i]*xp[j]));
    this.n++;
  }
  snapshot(){ return {n:this.n,beta:this.beta.map(x=>Number(x.toFixed(10)))}; }
}

function effectiveStrength(row,clip){
  const confidence=clamp(Number(row?.confidence ?? 0),0,1);
  const strength=clamp(Number(row?.net_strength ?? 0),-clip,clip);
  return {value:strength*confidence,confidence};
}
function fatigue(restDays){ return clamp((7-restDays)/6,0,1); }
export function congestionFeatureVector(selfRest,oppRest,selfStrength,oppStrength){
  const fs=fatigue(selfRest),fo=fatigue(oppRest);
  return [fs,fs*oppStrength,fo*selfStrength];
}

function scoreGrid(lh,la,max){ return buildIndependentScoreGrid(lh,la,max); }
function eventMass(grid,event){
  let sum=0;
  for(const r of grid){
    const hit=event==='3+ HT'?r.total>=3:event==='7+ FT'?r.total>=7:event==='Other HT'?Math.max(r.home,r.away)>=4:Math.max(r.home,r.away)>=5;
    if(hit) sum+=r.probability;
  }
  return sum;
}
function top3(grid){ return [...grid].sort((a,b)=>b.probability-a.probability||a.home-b.home||a.away-b.away).slice(0,3); }
function scoreCell(grid,actual){ return grid.find(r=>r.home===actual.home&&r.away===actual.away)?.probability ?? 0; }
function outcome1x2(s){ return s.home>s.away?'home':s.home<s.away?'away':'draw'; }

function splitQuarter(line){
  const q=Math.round(line*4)/4,frac=Math.abs(q-Math.trunc(q));
  return Math.abs(frac-.25)<1e-9||Math.abs(frac-.75)<1e-9?[q-.25,q+.25]:[q,q];
}
function cls(x){ return x>1e-9?'WIN':x<-1e-9?'LOSS':'PUSH'; }
function stateFromParts(a,b){
  const x=cls(a),y=cls(b);
  if(x==='WIN'&&y==='WIN')return'fullWin'; if(x==='LOSS'&&y==='LOSS')return'fullLoss'; if(x==='PUSH'&&y==='PUSH')return'push';
  if((x==='WIN'&&y==='PUSH')||(x==='PUSH'&&y==='WIN'))return'halfWin';
  if((x==='LOSS'&&y==='PUSH')||(x==='PUSH'&&y==='LOSS'))return'halfLoss';
  return'push';
}
function ouState(total,line){ const[a,b]=splitQuarter(line); return stateFromParts(total-a,total-b); }
function ahState(diff,line){ const[a,b]=splitQuarter(line); return stateFromParts(diff+a,diff+b); }
function settlementProbs(s){ return STATE_KEYS.map(k=>Number(s?.[k] ?? 0)); }

function newMetric(){ return {n:0,brierSum:0,logLossSum:0}; }
function finishMetric(m){ return {n:m.n,brier:m.n?m.brierSum/m.n:null,logLoss:m.n?m.logLossSum/m.n:null}; }
function catLoss(probs,actualIndex){
  if(actualIndex<0||actualIndex>=probs.length||probs.some(p=>!Number.isFinite(p)||p<0)) return null;
  const z=probs.reduce((a,b)=>a+b,0); if(!(z>0)) return null;
  const ps=probs.map(p=>p/z);
  return {probs:ps,brier:ps.reduce((s,p,i)=>s+(p-(i===actualIndex?1:0))**2,0)/ps.length,logLoss:-Math.log(Math.max(EPS,ps[actualIndex]))};
}
function addMetric(m,loss){ if(!loss)return; m.n++;m.brierSum+=loss.brier;m.logLossSum+=loss.logLoss; }
function newCalibration(binCount){ return {binCount,bins:Array.from({length:binCount},()=>({n:0,sumP:0,sumY:0})),total:0}; }
function addCalibration(cal,loss,actualIndex){
  if(!loss)return;
  for(let i=0;i<loss.probs.length;i++){
    const p=loss.probs[i],y=i===actualIndex?1:0,idx=Math.min(cal.binCount-1,Math.max(0,Math.floor(p*cal.binCount)));
    const bin=cal.bins[idx];bin.n++;bin.sumP+=p;bin.sumY+=y;cal.total++;
  }
}
function finishCalibration(cal){
  if(!cal.total)return null;let value=0;
  for(const bin of cal.bins){if(!bin.n)continue;value+=(bin.n/cal.total)*Math.abs(bin.sumP/bin.n-bin.sumY/bin.n);}
  return value;
}

function initMetrics(calibrationBins){
  return {
    champion:Object.fromEntries(CHAMPION.map(m=>[m,newMetric()])),
    oneXTwo:{ht:newMetric(),ft:newMetric()},
    overUnder:{ht:newMetric(),ft:newMetric()},
    asianHandicap:{ht:newMetric(),ft:newMetric()},
    scoreline:{ht:{n:0,top1:0,top3:0,logLossSum:0,logLossAvailable:true},ft:{n:0,top1:0,top3:0,logLossSum:0,logLossAvailable:true}},
    calibration:newCalibration(calibrationBins),
  };
}
function baselineTopRows(pred,part){
  return (pred?.scoreline?.[part]?.final ?? []).map(r=>{
    const [home,away]=String(r.score).split('-').map(Number);return {home,away,probability:Number(r.probability)};
  });
}
function addScoreline(metric,actual,grid=null,topRows=null){
  const rows=grid?top3(grid):(topRows??[]),actualKey=scoreKey(actual),keys=rows.map(r=>`${r.home}-${r.away}`);
  metric.n++;if(keys[0]===actualKey)metric.top1++;if(keys.includes(actualKey))metric.top3++;
  if(grid) metric.logLossSum += -Math.log(Math.max(EPS,scoreCell(grid,actual))); else metric.logLossAvailable=false;
}
function finishScoreline(m){
  return {n:m.n,top1Accuracy:m.n?m.top1/m.n:null,top3Accuracy:m.n?m.top3/m.n:null,logLoss:m.n&&m.logLossAvailable?m.logLossSum/m.n:null,fullGridAvailable:m.logLossAvailable};
}
function finishMetrics(m){
  return {
    champion:Object.fromEntries(Object.entries(m.champion).map(([k,v])=>[k,finishMetric(v)])),
    oneXTwo:{ht:finishMetric(m.oneXTwo.ht),ft:finishMetric(m.oneXTwo.ft)},
    overUnder:{ht:finishMetric(m.overUnder.ht),ft:finishMetric(m.overUnder.ft)},
    asianHandicap:{ht:finishMetric(m.asianHandicap.ht),ft:finishMetric(m.asianHandicap.ft)},
    scoreline:{ht:finishScoreline(m.scoreline.ht),ft:finishScoreline(m.scoreline.ft)},
    calibrationEce:finishCalibration(m.calibration),
    calibrationObservationCount:m.calibration.total,
  };
}

function recordModel(metrics,{mm,htGrid,ftGrid,pred,target}){
  const rowB=[],rowL=[];
  const championP={
    '3+ HT':htGrid?eventMass(htGrid,'3+ HT'):Number(pred?.markets?.['3+ HT']?.final),
    '7+ FT':ftGrid?eventMass(ftGrid,'7+ FT'):Number(pred?.markets?.['7+ FT']?.final),
    'Other HT':htGrid?eventMass(htGrid,'Other HT'):Number(pred?.markets?.['Other HT']?.final),
    'Other FT':ftGrid?eventMass(ftGrid,'Other FT'):Number(pred?.markets?.['Other FT']?.final),
  };
  const champY={'3+ HT':target.ht.home+target.ht.away>=3,'7+ FT':target.ft.home+target.ft.away>=7,'Other HT':Math.max(target.ht.home,target.ht.away)>=4,'Other FT':Math.max(target.ft.home,target.ft.away)>=5};
  for(const m of CHAMPION){
    const y=champY[m]?1:0,loss=catLoss([1-championP[m],championP[m]],y);addMetric(metrics.champion[m],loss);addCalibration(metrics.calibration,loss,y);if(loss){rowB.push(loss.brier);rowL.push(loss.logLoss);}
  }
  for(const part of ['ht','ft']){
    const actual=target[part],out=outcome1x2(actual),one=mm.oneXTwo[part],idx=['home','draw','away'].indexOf(out);
    let loss=catLoss([one.home,one.draw,one.away],idx);addMetric(metrics.oneXTwo[part],loss);addCalibration(metrics.calibration,loss,idx);if(loss){rowB.push(loss.brier);rowL.push(loss.logLoss);}
    const total=actual.home+actual.away,ouLines=part==='ht'?HT_OU:FT_OU;
    for(const line of ouLines){
      const state=ouState(total,line),si=STATE_KEYS.indexOf(state);loss=catLoss(settlementProbs(mm.overUnder[part][String(line)].over),si);
      addMetric(metrics.overUnder[part],loss);addCalibration(metrics.calibration,loss,si);if(loss){rowB.push(loss.brier);rowL.push(loss.logLoss);}
    }
    const diff=actual.home-actual.away;
    for(const line of AH){
      const state=ahState(diff,line),si=STATE_KEYS.indexOf(state);loss=catLoss(settlementProbs(mm.asianHandicap[part][String(line)].home),si);
      addMetric(metrics.asianHandicap[part],loss);addCalibration(metrics.calibration,loss,si);if(loss){rowB.push(loss.brier);rowL.push(loss.logLoss);}
    }
  }
  addScoreline(metrics.scoreline.ht,target.ht,htGrid,htGrid?null:baselineTopRows(pred,'ht'));
  addScoreline(metrics.scoreline.ft,target.ft,ftGrid,ftGrid?null:baselineTopRows(pred,'ft'));
  return {brier:rowB.length?rowB.reduce((a,b)=>a+b,0)/rowB.length:null,logLoss:rowL.length?rowL.reduce((a,b)=>a+b,0)/rowL.length:null};
}

function aggregateMetrics(m){
  const b=[],l=[];
  for(const row of Object.values(m.champion)){if(row.brier!==null)b.push(row.brier);if(row.logLoss!==null)l.push(row.logLoss);}
  for(const part of ['ht','ft']) for(const family of ['oneXTwo','overUnder','asianHandicap']){
    const row=m[family][part];if(row.brier!==null)b.push(row.brier);if(row.logLoss!==null)l.push(row.logLoss);
  }
  return {brier:b.length?b.reduce((a,x)=>a+x,0)/b.length:null,logLoss:l.length?l.reduce((a,x)=>a+x,0)/l.length:null,calibrationEce:m.calibrationEce};
}
function segmentAdd(map,segment,model,row){
  const k=String(segment || 'UNKNOWN');if(!map.has(k))map.set(k,{n:0,productionBaseline:{brier:0,logLoss:0,n:0},matchedControl:{brier:0,logLoss:0,n:0},challenger:{brier:0,logLoss:0,n:0}});
  const s=map.get(k);if(model==='challenger')s.n++;
  const x=s[model];if(row.brier!==null&&row.logLoss!==null){x.n++;x.brier+=row.brier;x.logLoss+=row.logLoss;}
}
function finishSegments(map){
  return Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,s])=>[k,{n:s.n,...Object.fromEntries(['productionBaseline','matchedControl','challenger'].map(m=>[m,{n:s[m].n,brier:s[m].n?s[m].brier/s[m].n:null,logLoss:s[m].n?s[m].logLoss/s[m].n:null}]))}]));
}
function maxDiff(a,b){return Math.abs(Number(a)-Number(b));}
function settlementMaxDiff(a,b){return Math.max(...STATE_KEYS.map(k=>maxDiff(a?.[k]??0,b?.[k]??0)));}
function swapAudit(htGrid,ftGrid,htAway,htHome,ftAway,ftHome){
  const sht=scoreGrid(htAway,htHome,10),sft=scoreGrid(ftAway,ftHome,14),a=buildMultiMarketFromScoreGrids({ht:htGrid,ft:ftGrid}),b=buildMultiMarketFromScoreGrids({ht:sht,ft:sft});
  let worst=0;
  for(const part of ['ht','ft']){
    worst=Math.max(worst,maxDiff(a.oneXTwo[part].home,b.oneXTwo[part].away),maxDiff(a.oneXTwo[part].away,b.oneXTwo[part].home),maxDiff(a.oneXTwo[part].draw,b.oneXTwo[part].draw));
    const lines=part==='ht'?HT_OU:FT_OU;for(const line of lines)worst=Math.max(worst,settlementMaxDiff(a.overUnder[part][String(line)].over,b.overUnder[part][String(line)].over));
    for(const line of AH)worst=Math.max(worst,settlementMaxDiff(a.asianHandicap[part][String(line)].home,b.asianHandicap[part][String(-line)].away));
  }
  for(const r of htGrid){const q=sht.find(x=>x.home===r.away&&x.away===r.home);worst=Math.max(worst,maxDiff(r.probability,q?.probability??0));}
  for(const r of ftGrid){const q=sft.find(x=>x.home===r.away&&x.away===r.home);worst=Math.max(worst,maxDiff(r.probability,q?.probability??0));}
  return worst;
}
function fnv(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
function cappedPush(map,k,value,cap){const arr=map.get(k)??[];arr.push(value);if(arr.length>cap)arr.splice(0,arr.length-cap);map.set(k,arr);}

export function runOpponentConditionedCongestionV1(corpus,featureBundle,options={}){
  const baselineLock=options.skipSourceLock===true?{status:'TEST_ONLY_SKIP'}:verifyProductionBaselineLock(options.baselineLockOptions ?? {});
  if(PRODUCTION_BASELINE_LOCK.multiMarketVersion!==MULTI_MARKET_VERSION) throw new Error('CONGESTION_MULTI_MARKET_VERSION_DRIFT');
  const rows=canonicalRows(corpus),strengths=strengthMap(featureBundle);
  const minTeamPrior=Math.max(1,Math.floor(options.minTeamPrior ?? OPPONENT_CONDITIONED_CONGESTION_V1.minTeamPrior));
  const minOnlineSamples=Math.max(0,Math.floor(options.minOnlineSamples ?? OPPONENT_CONDITIONED_CONGESTION_V1.minOnlineSamples));
  const historyCap=Math.max(minTeamPrior,Math.floor(options.historyCap ?? OPPONENT_CONDITIONED_CONGESTION_V1.historyCap));
  const ridge=Number(options.ridge ?? OPPONENT_CONDITIONED_CONGESTION_V1.ridge);
  const htCap=Number(options.htDeltaCap ?? OPPONENT_CONDITIONED_CONGESTION_V1.htDeltaCap),ftCap=Number(options.ftDeltaCap ?? OPPONENT_CONDITIONED_CONGESTION_V1.ftDeltaCap);
  const confidenceFloor=Number(options.lowConfidenceAbstain ?? OPPONENT_CONDITIONED_CONGESTION_V1.lowConfidenceAbstain);
  const evalStart=String(options.evaluationStart ?? OPPONENT_CONDITIONED_CONGESTION_V1.evaluationStart),evalEnd=String(options.evaluationEnd ?? OPPONENT_CONDITIONED_CONGESTION_V1.evaluationEnd);
  const calibrationBins=Math.max(2,Math.floor(options.calibrationBins ?? OPPONENT_CONDITIONED_CONGESTION_V1.calibrationBins));
  const swapAuditMax=Math.max(1,Math.floor(options.swapAuditMax ?? OPPONENT_CONDITIONED_CONGESTION_V1.swapAuditMax));
  const teamPrior=new Map(),h2hPrior=new Map(),lastDate=new Map();
  const htModel=new RecursiveRidge(3,ridge),ftModel=new RecursiveRidge(3,ridge);
  const metrics={productionBaseline:initMetrics(calibrationBins),matchedControl:initMetrics(calibrationBins),challenger:initMetrics(calibrationBins)};
  const segments=new Map();
  let priorMissing=0,featureMissing=0,abstain=0,maturitySkipped=0,eligible=0,clipped=0,coherenceFailures=0,swapWorst=0,swapAudited=0;

  for(let start=0;start<rows.length;){
    const date=rows[start].matchDate;let end=start+1;while(end<rows.length&&rows[end].matchDate===date)end++;
    const batch=rows.slice(start,end),updates=[];
    for(const target of batch){
      const hp=tail(teamPrior.get(key(target.homeTeam)) ?? [],historyCap),ap=tail(teamPrior.get(key(target.awayTeam)) ?? [],historyCap),h2h=tail(h2hPrior.get(pairKey(target.homeTeam,target.awayTeam)) ?? [],historyCap);
      if(hp.length<minTeamPrior||ap.length<minTeamPrior){priorMissing++;continue;}
      const hd=target.homeTeamId?lastDate.get(target.homeTeamId):null,ad=target.awayTeamId?lastDate.get(target.awayTeamId):null;
      const hs=target.homeTeamId?strengths.get(`${target.homeTeamId}|${date}`):null,as=target.awayTeamId?strengths.get(`${target.awayTeamId}|${date}`):null;
      if(!hd||!ad||!hs||!as){featureMissing++;continue;}
      if(hd>=date||ad>=date)throw new Error('CONGESTION_SAME_DATE_REST_LEAKAGE');
      const hRest=dayDiff(date,hd),aRest=dayDiff(date,ad);if(hRest<1||aRest<1)throw new Error('CONGESTION_INVALID_REST_DAYS');
      const he=effectiveStrength(hs,OPPONENT_CONDITIONED_CONGESTION_V1.strengthClip),ae=effectiveStrength(as,OPPONENT_CONDITIONED_CONGESTION_V1.strengthClip);
      const pred=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:date,language:'en',homePayload:hp,awayPayload:ap,h2hPayload:h2h});
      const e=pred?.scoreline?.expectedGoals,base={htHome:Number(e?.htHome),htAway:Number(e?.htAway),ftHome:Number(e?.ftHome),ftAway:Number(e?.ftAway)};
      if(!Object.values(base).every(v=>Number.isFinite(v)&&v>=0)||!pred?.multiMarket){featureMissing++;continue;}
      const xh=congestionFeatureVector(hRest,aRest,he.value,ae.value),xa=congestionFeatureVector(aRest,hRest,ae.value,he.value);
      if(Math.min(he.confidence,ae.confidence)<confidenceFloor){abstain++;continue;}
      updates.push({xh,xa,htHome:target.ht.home-base.htHome,htAway:target.ht.away-base.htAway,ftHome:target.ft.home-base.ftHome,ftAway:target.ft.away-base.ftAway});
      if(date<evalStart||date>evalEnd)continue;
      if(htModel.n<minOnlineSamples||ftModel.n<minOnlineSamples){maturitySkipped++;continue;}
      const raw={htHome:htModel.predict(xh),htAway:htModel.predict(xa),ftHome:ftModel.predict(xh),ftAway:ftModel.predict(xa)};
      const delta={htHome:clamp(raw.htHome,-htCap,htCap),htAway:clamp(raw.htAway,-htCap,htCap),ftHome:clamp(raw.ftHome,-ftCap,ftCap),ftAway:clamp(raw.ftAway,-ftCap,ftCap)};
      if(Object.keys(delta).some(k=>Math.abs(delta[k]-raw[k])>1e-12))clipped++;
      const adj={htHome:clamp(base.htHome+delta.htHome,.01,8),htAway:clamp(base.htAway+delta.htAway,.01,8),ftHome:clamp(base.ftHome+delta.ftHome,.02,12),ftAway:clamp(base.ftAway+delta.ftAway,.02,12)};
      adj.ftHome=Math.max(adj.ftHome,adj.htHome);adj.ftAway=Math.max(adj.ftAway,adj.htAway);
      const cHt=scoreGrid(base.htHome,base.htAway,10),cFt=scoreGrid(base.ftHome,base.ftAway,14),qHt=scoreGrid(adj.htHome,adj.htAway,10),qFt=scoreGrid(adj.ftHome,adj.ftAway,14);
      const control=buildMultiMarketFromScoreGrids({ht:cHt,ft:cFt}),challenger=buildMultiMarketFromScoreGrids({ht:qHt,ft:qFt});
      if(pred.multiMarket.consistencyGuard?.status!=='PASS'||control.consistencyGuard?.status!=='PASS'||challenger.consistencyGuard?.status!=='PASS'){coherenceFailures++;continue;}
      const rb=recordModel(metrics.productionBaseline,{mm:pred.multiMarket,htGrid:null,ftGrid:null,pred,target});
      const rc=recordModel(metrics.matchedControl,{mm:control,htGrid:cHt,ftGrid:cFt,pred:null,target});
      const rq=recordModel(metrics.challenger,{mm:challenger,htGrid:qHt,ftGrid:qFt,pred:null,target});
      segmentAdd(segments,target.competitionSegment,'productionBaseline',rb);segmentAdd(segments,target.competitionSegment,'matchedControl',rc);segmentAdd(segments,target.competitionSegment,'challenger',rq);
      if(swapAudited<swapAuditMax){swapWorst=Math.max(swapWorst,swapAudit(qHt,qFt,adj.htAway,adj.htHome,adj.ftAway,adj.ftHome));swapAudited++;}
      eligible++;
    }
    for(const u of updates){htModel.update(u.xh,u.htHome);htModel.update(u.xa,u.htAway);ftModel.update(u.xh,u.ftHome);ftModel.update(u.xa,u.ftAway);}
    for(const f of batch){
      const compact={id:f.id,matchDate:f.matchDate,homeTeam:f.homeTeam,awayTeam:f.awayTeam,ht:f.ht,ft:f.ft};
      cappedPush(teamPrior,key(f.homeTeam),compact,historyCap);cappedPush(teamPrior,key(f.awayTeam),compact,historyCap);cappedPush(h2hPrior,pairKey(f.homeTeam,f.awayTeam),compact,historyCap);
      if(f.homeTeamId)lastDate.set(f.homeTeamId,date);if(f.awayTeamId)lastDate.set(f.awayTeamId,date);
    }
    start=end;
  }

  const finished={productionBaseline:finishMetrics(metrics.productionBaseline),matchedControl:finishMetrics(metrics.matchedControl),challenger:finishMetrics(metrics.challenger)};
  const aggregate={productionBaseline:aggregateMetrics(finished.productionBaseline),matchedControl:aggregateMetrics(finished.matchedControl),challenger:aggregateMetrics(finished.challenger)};
  const delta=(a,b)=>a===null||b===null?null:a-b;
  const hardBlockers=['BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS','NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'];
  if(coherenceFailures)hardBlockers.push('CROSS_MARKET_COHERENCE_FAILURE');
  if(swapWorst>1e-10)hardBlockers.push('DIRECTIONAL_SWAP_SYMMETRY_FAILURE');
  if(!eligible)hardBlockers.push('NO_ELIGIBLE_PAIRED_REPLAY_ROWS');
  const segmentResult=finishSegments(segments);
  const fingerprint=fnv(JSON.stringify({coverage:{eligible,priorMissing,featureMissing,abstain,maturitySkipped,clipped},learner:{ht:htModel.snapshot(),ft:ftModel.snapshot()},aggregate,segments:segmentResult,swapWorst,swapAudited}));
  return {
    version:OPPONENT_CONDITIONED_CONGESTION_V1.version,status:'RESEARCH_ONLY',baselineLock,
    baseline:{engine:PRODUCTION_BASELINE_LOCK.engine,runtime:PRODUCTION_BASELINE_LOCK.runtime,primaryContract:PRODUCTION_BASELINE_LOCK.primaryContract,multiMarketVersion:MULTI_MARKET_VERSION,commitSha:PRODUCTION_BASELINE_LOCK.commitSha},
    strictPrior:true,sameDateLeakage:false,futureLeakage:false,noReconstruction:true,decisionUse:false,productionMutationAllowed:false,
    replayPolicy:{warmupStart:OPPONENT_CONDITIONED_CONGESTION_V1.warmupStart,evaluationStart:evalStart,evaluationEnd:evalEnd,holdoutStart:OPPONENT_CONDITIONED_CONGESTION_V1.holdoutStart,historyCap,minTeamPrior,minOnlineSamples,calibrationBins,swapAuditMax,updatePolicy:'AFTER_COMPLETE_TARGET_DATE_BATCH'},
    featurePolicy:{mainStrengthEffect:false,interactionOnlyStrength:true,features:['self_fatigue','self_fatigue_x_opponent_strength','opponent_fatigue_x_self_strength'],strengthClip:OPPONENT_CONDITIONED_CONGESTION_V1.strengthClip,confidenceFloor,onlineLearner:'DATE_BATCHED_RECURSIVE_RIDGE'},
    coverage:{fixtureCount:rows.length,eligible,priorMissing,featureMissing,abstain,maturitySkipped,clipped,coherenceFailures,segments:segmentResult},
    learner:{ht:htModel.snapshot(),ft:ftModel.snapshot()},metrics:finished,
    aggregate:{...aggregate,deltaVsProduction:{brier:delta(aggregate.challenger.brier,aggregate.productionBaseline.brier),logLoss:delta(aggregate.challenger.logLoss,aggregate.productionBaseline.logLoss),calibrationEce:delta(aggregate.challenger.calibrationEce,aggregate.productionBaseline.calibrationEce)},deltaVsMatchedControl:{brier:delta(aggregate.challenger.brier,aggregate.matchedControl.brier),logLoss:delta(aggregate.challenger.logLoss,aggregate.matchedControl.logLoss),calibrationEce:delta(aggregate.challenger.calibrationEce,aggregate.matchedControl.calibrationEce)}},
    scorelineComparison:{top1Top3Paired:true,productionBaselineFullGridLogLossAvailable:false,matchedControlFullGridLogLossAvailable:true,challengerFullGridLogLossAvailable:true},
    directionalSwap:{status:swapWorst<=1e-10?'PASS':'FAIL',maxProbabilityDelta:swapWorst,tolerance:1e-10,auditedRows:swapAudited,maxAuditedRows:swapAuditMax},
    determinism:{status:'FINGERPRINT_EMITTED_REPLAY_TWICE_TO_VERIFY',fingerprint},
    memoryPolicy:{calibration:'STREAMING_FIXED_BINS',history:'CAPPED_TO_HISTORY_POLICY',unboundedCalibrationRows:false},
    crossMarketCoherence:{status:coherenceFailures?'FAIL':'PASS',version:'CFI_CROSS_MARKET_COHERENCE_GATE_V1',failures:coherenceFailures},
    boardImpact:{status:'BLOCKED_NO_SYNCHRONIZED_HISTORICAL_ODDS',decisionUse:false},hardBlockers,
    shadowEligible:false,promotionDecision:'HOLD',productionEligible:false,
  };
}

async function main(){
  const corpusPath=process.argv[2],featurePath=process.argv[3],output=process.argv[4];
  if(!corpusPath||!featurePath)throw new Error('Usage: node --experimental-strip-types research/opponent-conditioned-congestion-v1.mjs <r0-corpus.json> <group-a-features.json> [output.json]');
  const corpus=JSON.parse(await fs.readFile(corpusPath,'utf8')),features=JSON.parse(await fs.readFile(featurePath,'utf8'));
  const result=runOpponentConditionedCongestionV1(corpus,features),text=JSON.stringify(result,null,2);
  if(output)await fs.writeFile(output,text+'\n');else process.stdout.write(text+'\n');
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
