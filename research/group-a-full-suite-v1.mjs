import fs from 'node:fs/promises';
import { buildPrediction } from '../src/prediction/final-engine.ts';
import { buildIndependentScoreGrid, buildMultiMarketFromScoreGrids, MULTI_MARKET_VERSION } from '../src/prediction/multi-market-v1.ts';
import { PRODUCTION_BASELINE_LOCK, verifyProductionBaselineLock } from './production-baseline-lock.mjs';

export const GROUP_A_FULL_SUITE_V1 = Object.freeze({
  version:'CFI_GROUP_A_FULL_SUITE_V1', researchOnly:true, decisionUse:false,
  baselineCommitSha:PRODUCTION_BASELINE_LOCK.commitSha, baselineEngine:PRODUCTION_BASELINE_LOCK.engine,
  runtime:PRODUCTION_BASELINE_LOCK.runtime, primaryContract:PRODUCTION_BASELINE_LOCK.primaryContract,
  multiMarketVersion:PRODUCTION_BASELINE_LOCK.multiMarketVersion,
  warmupStart:'2015-01-01', evaluationStart:'2016-01-01', evaluationEnd:'2026-08-19', holdoutStart:'2026-08-20',
  historyCap:40, minTeamPrior:6, minOnlineSamples:500, calibrationBins:10, confidenceFloor:.40,
  strengthClip:2, htDeltaCap:.25, ftDeltaCap:.50, segmentPriorWeight:500, dispersionMaxMix:.55,
});

export const GROUP_A_CHALLENGERS = Object.freeze([
  'OPPONENT_STRENGTH_ARM_V1',
  'PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1',
  'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',
  'ADAPTIVE_SCORE_DISPERSION_V1',
]);

const EPS=1e-12;
const HT_OU=[.5,1,1.5,2,2.5,3,3.5,4,4.5];
const FT_OU=[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5];
const AH=[-2,-1.75,-1.5,-1.25,-1,-.75,-.5,-.25,0,.25,.5,.75,1,1.25,1.5,1.75,2];
const CHAMPION=['3+ HT','7+ FT','Other HT','Other FT'];
const STATES=['fullWin','halfWin','push','halfLoss','fullLoss'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const k=x=>String(x??'').trim().toLowerCase();
const pk=(a,b)=>[k(a),k(b)].sort().join('|');
const finiteScore=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0;
const scoreKey=s=>`${s.home}-${s.away}`;
const tail=(a,n)=>a.length<=n?a:a.slice(a.length-n);

function canonicalRows(corpus){
  const input=Array.isArray(corpus)?corpus:(corpus?.fixtures??[]),out=[];
  for(const r of input){
    const matchDate=String(r.match_date??r.matchDate??'').slice(0,10),homeTeam=String(r.home_team??r.homeTeam??'').trim(),awayTeam=String(r.away_team??r.awayTeam??'').trim();
    const ht={home:Number(r.ht_home??r.ht?.home),away:Number(r.ht_away??r.ht?.away)},ft={home:Number(r.ft_home??r.ft?.home),away:Number(r.ft_away??r.ft?.away)};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeTeam||!awayTeam)continue;
    if(![ht.home,ht.away,ft.home,ft.away].every(finiteScore)||ht.home>ft.home||ht.away>ft.away)continue;
    if(matchDate>=GROUP_A_FULL_SUITE_V1.holdoutStart)throw new Error('GROUP_A_HOLDOUT_LEAKAGE');
    out.push({id:String(r.fixture_id??r.id??`${matchDate}|${homeTeam}|${awayTeam}`),matchDate,homeTeam,awayTeam,ht,ft,
      homeTeamId:String(r.home_team_id??''),awayTeamId:String(r.away_team_id??''),competitionKey:r.competition_key??null,
      competitionSegment:r.competition_segment??null,season:r.season??null,country:r.country??null});
  }
  return [...new Map(out.map(r=>[`${r.matchDate}|${k(r.homeTeam)}|${k(r.awayTeam)}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate)||a.id.localeCompare(b.id));
}

function strengthIndex(bundle){
  if(bundle?.baselineCommitSha&&bundle.baselineCommitSha!==PRODUCTION_BASELINE_LOCK.commitSha)throw new Error('GROUP_A_FEATURE_BASELINE_LINEAGE_DRIFT');
  const rows=Array.isArray(bundle)?bundle:(bundle?.strengths??[]),byTeamDate=new Map(),dailyComp=new Map();
  for(const r of rows){
    if(r.strict_prior!==true)throw new Error('GROUP_A_NON_STRICT_PRIOR_STRENGTH_ROW');
    const date=String(r.as_of_date??'').slice(0,10);if(date>=GROUP_A_FULL_SUITE_V1.holdoutStart)throw new Error('GROUP_A_STRENGTH_HOLDOUT_LEAKAGE');
    const row={teamId:String(r.team_id),date,competitionKey:r.competition_key??null,segment:r.segment_v2??null,confidence:Number(r.confidence??0),
      attack:Number(r.attack_index??0),defense:Number(r.defense_index??0),net:Number(r.net_strength??0)};
    byTeamDate.set(`${row.teamId}|${date}`,row);
    if(row.competitionKey){const q=`${date}|${row.competitionKey}`,s=dailyComp.get(q)??{n:0,sum:0};s.n++;s.sum+=row.net;dailyComp.set(q,s);}
  }
  return {byTeamDate,dailyComp};
}
function compMean(index,date,competitionKey){const s=index.dailyComp.get(`${date}|${competitionKey}`);return s?.n?s.sum/s.n:null;}
function eff(s){const c=clamp(Number(s?.confidence??0),0,1);return {confidence:c,attack:clamp(Number(s?.attack??0),-2,2)*c,defense:clamp(Number(s?.defense??0),-2,2)*c,net:clamp(Number(s?.net??0),-2,2)*c};}

class Ridge{
  constructor(dim,ridge=50){this.dim=dim;this.beta=Array(dim).fill(0);this.p=Array.from({length:dim},(_,i)=>Array.from({length:dim},(_,j)=>i===j?1/ridge:0));this.n=0;}
  predict(x){return this.beta.reduce((s,b,i)=>s+b*x[i],0);}
  update(x,y){const px=this.p.map(row=>row.reduce((s,v,j)=>s+v*x[j],0)),den=1+x.reduce((s,v,i)=>s+v*px[i],0);if(!(den>EPS))return;const g=px.map(v=>v/den),e=y-this.predict(x);this.beta=this.beta.map((b,i)=>b+g[i]*e);const xp=Array.from({length:this.dim},(_,j)=>x.reduce((s,v,i)=>s+v*this.p[i][j],0));this.p=this.p.map((row,i)=>row.map((v,j)=>v-g[i]*xp[j]));this.n++;}
  snapshot(){return {n:this.n,beta:this.beta.map(v=>Number(v.toFixed(10)))}};
}
class RunningResidual{
  constructor(){this.n=0;this.h=0;this.a=0;}
  add(h,a){this.n++;this.h+=h;this.a+=a;}
  means(){return this.n?{n:this.n,h:this.h/this.n,a:this.a/this.n}:{n:0,h:0,a:0};}
}
class RunningDisp{
  constructor(){this.n=0;this.sum=0;}
  add(actual,mu){if(mu>EPS&&Number.isFinite(actual)){this.n++;this.sum+=((actual-mu)**2)/mu;}}
  value(){return this.n?this.sum/this.n:1;}
}

function splitQuarter(line){const q=Math.round(line*4)/4,f=Math.abs(q-Math.trunc(q));return Math.abs(f-.25)<1e-9||Math.abs(f-.75)<1e-9?[q-.25,q+.25]:[q,q];}
const cls=x=>x>1e-9?'WIN':x<-1e-9?'LOSS':'PUSH';
function stateParts(a,b){const x=cls(a),y=cls(b);if(x==='WIN'&&y==='WIN')return'fullWin';if(x==='LOSS'&&y==='LOSS')return'fullLoss';if(x==='PUSH'&&y==='PUSH')return'push';if((x==='WIN'&&y==='PUSH')||(x==='PUSH'&&y==='WIN'))return'halfWin';if((x==='LOSS'&&y==='PUSH')||(x==='PUSH'&&y==='LOSS'))return'halfLoss';return'push';}
const ouState=(t,l)=>{const[a,b]=splitQuarter(l);return stateParts(t-a,t-b)};
const ahState=(d,l)=>{const[a,b]=splitQuarter(l);return stateParts(d+a,d+b)};
const settlement=s=>STATES.map(x=>Number(s?.[x]??0));
function catLoss(p,idx){if(idx<0||idx>=p.length||p.some(x=>!Number.isFinite(x)||x<0))return null;const z=p.reduce((a,b)=>a+b,0);if(!(z>0))return null;const q=p.map(x=>x/z);return {p:q,brier:q.reduce((s,x,i)=>s+(x-(i===idx?1:0))**2,0)/q.length,logLoss:-Math.log(Math.max(EPS,q[idx]))};}
function metric(){return {n:0,brier:0,logLoss:0};} function add(m,l){if(!l)return;m.n++;m.brier+=l.brier;m.logLoss+=l.logLoss;} function done(m){return {n:m.n,brier:m.n?m.brier/m.n:null,logLoss:m.n?m.logLoss/m.n:null};}
function cal(bins=10){return {n:0,b:Array.from({length:bins},()=>({n:0,p:0,y:0}))};}
function addCal(c,l,idx){if(!l)return;for(let i=0;i<l.p.length;i++){const p=l.p[i],j=Math.min(c.b.length-1,Math.floor(p*c.b.length)),b=c.b[j];b.n++;b.p+=p;b.y+=i===idx?1:0;c.n++;}}
function doneCal(c){if(!c.n)return null;return c.b.reduce((s,b)=>b.n?s+b.n/c.n*Math.abs(b.p/b.n-b.y/b.n):s,0);}
function scoreMetric(){return {n:0,t1:0,t3:0,ll:0,full:true};}
function top3(grid){return [...grid].sort((a,b)=>b.probability-a.probability||a.home-b.home||a.away-b.away).slice(0,3);}
function addScore(m,actual,grid=null,rows=null){const q=grid?top3(grid):(rows??[]),keys=q.map(x=>`${x.home}-${x.away}`),ak=scoreKey(actual);m.n++;if(keys[0]===ak)m.t1++;if(keys.includes(ak))m.t3++;if(grid){const p=grid.find(x=>x.home===actual.home&&x.away===actual.away)?.probability??0;m.ll+=-Math.log(Math.max(EPS,p));}else m.full=false;}
function doneScore(m){return {n:m.n,top1Accuracy:m.n?m.t1/m.n:null,top3Accuracy:m.n?m.t3/m.n:null,logLoss:m.n&&m.full?m.ll/m.n:null,fullGridAvailable:m.full};}
function initMetrics(){return {champion:Object.fromEntries(CHAMPION.map(x=>[x,metric()])),oneXTwo:{ht:metric(),ft:metric()},overUnder:{ht:metric(),ft:metric()},asianHandicap:{ht:metric(),ft:metric()},scoreline:{ht:scoreMetric(),ft:scoreMetric()},calibration:cal(GROUP_A_FULL_SUITE_V1.calibrationBins)};}
function eventMass(grid,event){let s=0;for(const r of grid){const hit=event==='3+ HT'?r.total>=3:event==='7+ FT'?r.total>=7:event==='Other HT'?Math.max(r.home,r.away)>=4:Math.max(r.home,r.away)>=5;if(hit)s+=r.probability;}return s;}
function baselineRows(pred,part){return (pred?.scoreline?.[part]?.final??[]).map(r=>{const[h,a]=String(r.score).split('-').map(Number);return {home:h,away:a,probability:Number(r.probability)}});}
function outcome(s){return s.home>s.away?'home':s.home<s.away?'away':'draw';}
function record(m,{mm,htGrid,ftGrid,pred,target}){
  const rowB=[],rowL=[],cp={'3+ HT':htGrid?eventMass(htGrid,'3+ HT'):Number(pred?.markets?.['3+ HT']?.final),'7+ FT':ftGrid?eventMass(ftGrid,'7+ FT'):Number(pred?.markets?.['7+ FT']?.final),'Other HT':htGrid?eventMass(htGrid,'Other HT'):Number(pred?.markets?.['Other HT']?.final),'Other FT':ftGrid?eventMass(ftGrid,'Other FT'):Number(pred?.markets?.['Other FT']?.final)};
  const cy={'3+ HT':target.ht.home+target.ht.away>=3,'7+ FT':target.ft.home+target.ft.away>=7,'Other HT':Math.max(target.ht.home,target.ht.away)>=4,'Other FT':Math.max(target.ft.home,target.ft.away)>=5};
  for(const x of CHAMPION){const y=cy[x]?1:0,l=catLoss([1-cp[x],cp[x]],y);add(m.champion[x],l);addCal(m.calibration,l,y);if(l){rowB.push(l.brier);rowL.push(l.logLoss)}}
  for(const part of ['ht','ft']){const actual=target[part],idx=['home','draw','away'].indexOf(outcome(actual)),one=mm.oneXTwo[part];let l=catLoss([one.home,one.draw,one.away],idx);add(m.oneXTwo[part],l);addCal(m.calibration,l,idx);if(l){rowB.push(l.brier);rowL.push(l.logLoss)};const total=actual.home+actual.away;for(const line of part==='ht'?HT_OU:FT_OU){const si=STATES.indexOf(ouState(total,line));l=catLoss(settlement(mm.overUnder[part][String(line)].over),si);add(m.overUnder[part],l);addCal(m.calibration,l,si);if(l){rowB.push(l.brier);rowL.push(l.logLoss)}}const diff=actual.home-actual.away;for(const line of AH){const si=STATES.indexOf(ahState(diff,line));l=catLoss(settlement(mm.asianHandicap[part][String(line)].home),si);add(m.asianHandicap[part],l);addCal(m.calibration,l,si);if(l){rowB.push(l.brier);rowL.push(l.logLoss)}}}
  addScore(m.scoreline.ht,target.ht,htGrid,htGrid?null:baselineRows(pred,'ht'));addScore(m.scoreline.ft,target.ft,ftGrid,ftGrid?null:baselineRows(pred,'ft'));
  return {brier:rowB.length?rowB.reduce((a,b)=>a+b,0)/rowB.length:null,logLoss:rowL.length?rowL.reduce((a,b)=>a+b,0)/rowL.length:null};
}
function finish(m){return {champion:Object.fromEntries(Object.entries(m.champion).map(([x,v])=>[x,done(v)])),oneXTwo:{ht:done(m.oneXTwo.ht),ft:done(m.oneXTwo.ft)},overUnder:{ht:done(m.overUnder.ht),ft:done(m.overUnder.ft)},asianHandicap:{ht:done(m.asianHandicap.ht),ft:done(m.asianHandicap.ft)},scoreline:{ht:doneScore(m.scoreline.ht),ft:doneScore(m.scoreline.ft)},calibrationEce:doneCal(m.calibration)};}
function aggregate(m){const b=[],l=[];for(const x of Object.values(m.champion)){if(x.brier!==null)b.push(x.brier);if(x.logLoss!==null)l.push(x.logLoss)}for(const fam of ['oneXTwo','overUnder','asianHandicap'])for(const part of ['ht','ft']){const x=m[fam][part];if(x.brier!==null)b.push(x.brier);if(x.logLoss!==null)l.push(x.logLoss)}return {brier:b.reduce((a,x)=>a+x,0)/b.length,logLoss:l.reduce((a,x)=>a+x,0)/l.length,calibrationEce:m.calibrationEce};}
function segAdd(map,seg,name,row){const s=map.get(seg)??{n:0,baseline:{n:0,b:0,l:0},challenger:{n:0,b:0,l:0}};if(name==='challenger')s.n++;const q=s[name];if(row.brier!==null){q.n++;q.b+=row.brier;q.l+=row.logLoss}map.set(seg,s);}
function segDone(map){return Object.fromEntries([...map.entries()].map(([x,s])=>[x,{n:s.n,baseline:{n:s.baseline.n,brier:s.baseline.n?s.baseline.b/s.baseline.n:null,logLoss:s.baseline.n?s.baseline.l/s.baseline.n:null},challenger:{n:s.challenger.n,brier:s.challenger.n?s.challenger.b/s.challenger.n:null,logLoss:s.challenger.n?s.challenger.l/s.challenger.n:null}}]));}
function pairCandidateSegments(candidateSegments,baselineSegments){return Object.fromEntries(Object.entries(candidateSegments).map(([seg,row])=>[seg,{...row,baseline:baselineSegments?.[seg]?.baseline??{n:0,brier:null,logLoss:null}}]));}
function capPush(map,key,value,cap){const a=map.get(key)??[];a.push(value);if(a.length>cap)a.splice(0,a.length-cap);map.set(key,a);}
function fnv(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,'0');}
function normalizeGrid(rows){const z=rows.reduce((s,r)=>s+r.probability,0);return rows.map(r=>({...r,probability:r.probability/z}));}
function mixtureGrid(lh,la,d,max){if(!(d>1e-9))return buildIndependentScoreGrid(lh,la,max);const lo=Math.max(.05,1-d),hi=1+d,a=buildIndependentScoreGrid(lh*lo,la*lo,max),b=buildIndependentScoreGrid(lh*hi,la*hi,max),m=new Map();for(const r of a)m.set(`${r.home}-${r.away}`,{...r,probability:.5*r.probability});for(const r of b){const q=m.get(`${r.home}-${r.away}`)??{...r,probability:0};q.probability+=.5*r.probability;m.set(`${r.home}-${r.away}`,q)}return normalizeGrid([...m.values()]);}

function candidateState(){return {metrics:initMetrics(),segments:new Map(),eligible:0,active:0,abstain:0,featureMissing:0,coherenceFailures:0,clipped:0};}
function finishCandidate(name,s,baselineFinished,baselineSegmentFinished,learner,extra={}){const m=finish(s.metrics),a=aggregate(m),b=aggregate(baselineFinished),segments=pairCandidateSegments(segDone(s.segments),baselineSegmentFinished);const regressions=[];for(const fam of ['oneXTwo','overUnder','asianHandicap'])for(const part of ['ht','ft']){const d=(m[fam][part].brier??0)-(baselineFinished[fam][part].brier??0);if(d>.0005)regressions.push(`${fam}.${part}:brier:+${d.toFixed(6)}`)}for(const [seg,v] of Object.entries(segments)){if(v.n>=500&&v.challenger.brier!==null&&v.baseline.brier!==null&&v.challenger.brier-v.baseline.brier>.0005)regressions.push(`segment.${seg}:brier:+${(v.challenger.brier-v.baseline.brier).toFixed(6)}`)}const blockers=['BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS','NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'];if(regressions.length)blockers.push('UNACCEPTABLE_FULL_CONTRACT_REGRESSION');if(!s.eligible)blockers.push('NO_ELIGIBLE_ROWS');return {version:name,status:'RESEARCH_ONLY',decisionUse:false,productionMutationAllowed:false,strictPrior:true,sameDateLeakage:false,futureLeakage:false,noReconstruction:true,coverage:{eligible:s.eligible,active:s.active,abstain:s.abstain,featureMissing:s.featureMissing,coherenceFailures:s.coherenceFailures,clipped:s.clipped},metrics:m,aggregate:{baseline:b,challenger:a,deltaVsProduction:{brier:a.brier-b.brier,logLoss:a.logLoss-b.logLoss,calibrationEce:(a.calibrationEce??0)-(b.calibrationEce??0)}},segments,learner,regressions,hardBlockers:blockers,shadowEligible:false,promotionDecision:'HOLD',productionEligible:false,...extra};}

export function runGroupAFullSuiteV1(corpus,featureBundle,options={}){
  const baselineLock=options.skipSourceLock===true?{status:'TEST_ONLY_SKIP'}:verifyProductionBaselineLock(options.baselineLockOptions??{});
  if(PRODUCTION_BASELINE_LOCK.multiMarketVersion!==MULTI_MARKET_VERSION)throw new Error('GROUP_A_MULTI_MARKET_VERSION_DRIFT');
  const rows=canonicalRows(corpus),si=strengthIndex(featureBundle),historyCap=Math.max(6,Math.floor(options.historyCap??GROUP_A_FULL_SUITE_V1.historyCap));
  const evalStart=String(options.evaluationStart??GROUP_A_FULL_SUITE_V1.evaluationStart),evalEnd=String(options.evaluationEnd??GROUP_A_FULL_SUITE_V1.evaluationEnd),minPrior=Math.max(1,Math.floor(options.minTeamPrior??GROUP_A_FULL_SUITE_V1.minTeamPrior)),minOnline=Math.max(0,Math.floor(options.minOnlineSamples??GROUP_A_FULL_SUITE_V1.minOnlineSamples));
  const team=new Map(),h2h=new Map(),lastComp=new Map();
  const baselineMetrics=initMetrics(),baselineSegments=new Map();
  const states=Object.fromEntries(GROUP_A_CHALLENGERS.map(x=>[x,candidateState()]));
  const oppHt=new Ridge(4,80),oppFt=new Ridge(4,80),bridgeHt=new Ridge(1,80),bridgeFt=new Ridge(1,80);
  const globalHt=new RunningResidual(),globalFt=new RunningResidual(),segHt=new Map(),segFt=new Map(),globalDispHt=new RunningDisp(),globalDispFt=new RunningDisp(),segDispHt=new Map(),segDispFt=new Map();
  let priorMissing=0,baseMissing=0,baselineEligible=0;
  for(let start=0;start<rows.length;){const date=rows[start].matchDate;let end=start+1;while(end<rows.length&&rows[end].matchDate===date)end++;const batch=rows.slice(start,end),updates=[];
    for(const target of batch){const hp=tail(team.get(k(target.homeTeam))??[],historyCap),ap=tail(team.get(k(target.awayTeam))??[],historyCap),hh=tail(h2h.get(pk(target.homeTeam,target.awayTeam))??[],historyCap);if(hp.length<minPrior||ap.length<minPrior){priorMissing++;continue}const hs=target.homeTeamId?si.byTeamDate.get(`${target.homeTeamId}|${date}`):null,as=target.awayTeamId?si.byTeamDate.get(`${target.awayTeamId}|${date}`):null;if(!hs||!as){for(const s of Object.values(states))s.featureMissing++;continue}const he=eff(hs),ae=eff(as),pred=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:date,language:'en',homePayload:hp,awayPayload:ap,h2hPayload:hh}),e=pred?.scoreline?.expectedGoals,base={htHome:Number(e?.htHome),htAway:Number(e?.htAway),ftHome:Number(e?.ftHome),ftAway:Number(e?.ftAway)};if(!Object.values(base).every(v=>Number.isFinite(v)&&v>=0)||pred?.multiMarket?.consistencyGuard?.status!=='PASS'){baseMissing++;continue}const inEval=date>=evalStart&&date<=evalEnd;if(inEval){const rb=record(baselineMetrics,{mm:pred.multiMarket,htGrid:null,ftGrid:null,pred,target});segAdd(baselineSegments,target.competitionSegment||'UNKNOWN','baseline',rb);baselineEligible++}
      const oppXh=[1,he.attack,ae.defense,he.net-ae.net],oppXa=[1,ae.attack,he.defense,ae.net-he.net];
      const prevH=target.homeTeamId?lastComp.get(target.homeTeamId):null,prevA=target.awayTeamId?lastComp.get(target.awayTeamId):null,cur=target.competitionKey;
      const curMean=cur?compMean(si,date,cur):null,prevHm=prevH?compMean(si,date,prevH):null,prevAm=prevA?compMean(si,date,prevA):null,bridgeH=prevH&&cur&&prevH!==cur&&curMean!==null&&prevHm!==null?curMean-prevHm:0,bridgeA=prevA&&cur&&prevA!==cur&&curMean!==null&&prevAm!==null?curMean-prevAm:0;
      updates.push({oppXh,oppXa,bridgeH,bridgeA,htRh:target.ht.home-base.htHome,htRa:target.ht.away-base.htAway,ftRh:target.ft.home-base.ftHome,ftRa:target.ft.away-base.ftAway,seg:target.competitionSegment||'UNKNOWN',htTotal:target.ht.home+target.ht.away,ftTotal:target.ft.home+target.ft.away,baseHt:base.htHome+base.htAway,baseFt:base.ftHome+base.ftAway});
      if(!inEval)continue;
      const run=(name,adj,grids,active,abstain=false)=>{const s=states[name];if(abstain){s.abstain++;return}if((name==='OPPONENT_STRENGTH_ARM_V1'&&(oppHt.n<minOnline||oppFt.n<minOnline))||(name==='PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1'&&(bridgeHt.n<Math.max(50,Math.floor(minOnline/5))||bridgeFt.n<Math.max(50,Math.floor(minOnline/5))))){return}let htGrid,ftGrid;if(grids){htGrid=grids.ht;ftGrid=grids.ft}else{htGrid=buildIndependentScoreGrid(adj.htHome,adj.htAway,10);ftGrid=buildIndependentScoreGrid(adj.ftHome,adj.ftAway,14)}const mm=buildMultiMarketFromScoreGrids({ht:htGrid,ft:ftGrid});if(mm.consistencyGuard?.status!=='PASS'){s.coherenceFailures++;return}const rq=record(s.metrics,{mm,htGrid,ftGrid,pred:null,target});segAdd(s.segments,target.competitionSegment||'UNKNOWN','challenger',rq);s.eligible++;if(active)s.active++;};
      const oppActive=Math.abs(he.net)>1e-6||Math.abs(ae.net)>1e-6,oppAbstain=Math.min(he.confidence,ae.confidence)<GROUP_A_FULL_SUITE_V1.confidenceFloor,od={htHome:clamp(oppHt.predict(oppXh),-.25,.25),htAway:clamp(oppHt.predict(oppXa),-.25,.25),ftHome:clamp(oppFt.predict(oppXh),-.5,.5),ftAway:clamp(oppFt.predict(oppXa),-.5,.5)};run('OPPONENT_STRENGTH_ARM_V1',{htHome:Math.max(.01,base.htHome+od.htHome),htAway:Math.max(.01,base.htAway+od.htAway),ftHome:Math.max(.02,base.ftHome+od.ftHome),ftAway:Math.max(.02,base.ftAway+od.ftAway)},null,oppActive,oppAbstain);
      const bd={htHome:clamp(bridgeHt.predict([bridgeH]),-.2,.2),htAway:clamp(bridgeHt.predict([bridgeA]),-.2,.2),ftHome:clamp(bridgeFt.predict([bridgeH]),-.4,.4),ftAway:clamp(bridgeFt.predict([bridgeA]),-.4,.4)};run('PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1',{htHome:Math.max(.01,base.htHome+bd.htHome),htAway:Math.max(.01,base.htAway+bd.htAway),ftHome:Math.max(.02,base.ftHome+bd.ftHome),ftAway:Math.max(.02,base.ftAway+bd.ftAway)},null,Math.abs(bridgeH)+Math.abs(bridgeA)>1e-9,false);
      const seg=target.competitionSegment||'UNKNOWN',gh=globalHt.means(),gf=globalFt.means(),sh=(segHt.get(seg)??new RunningResidual()).means(),sf=(segFt.get(seg)??new RunningResidual()).means(),wh=sh.n/(sh.n+GROUP_A_FULL_SUITE_V1.segmentPriorWeight),wf=sf.n/(sf.n+GROUP_A_FULL_SUITE_V1.segmentPriorWeight),hd={h:(1-wh)*gh.h+wh*sh.h,a:(1-wh)*gh.a+wh*sh.a},fd={h:(1-wf)*gf.h+wf*sf.h,a:(1-wf)*gf.a+wf*sf.a};run('HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',{htHome:Math.max(.01,base.htHome+clamp(hd.h,-.2,.2)),htAway:Math.max(.01,base.htAway+clamp(hd.a,-.2,.2)),ftHome:Math.max(.02,base.ftHome+clamp(fd.h,-.4,.4)),ftAway:Math.max(.02,base.ftAway+clamp(fd.a,-.4,.4))},null,sh.n>0||sf.n>0,false);
      const dhg=globalDispHt.value(),dfg=globalDispFt.value(),dhs=segDispHt.get(seg)?.value()??dhg,dfs=segDispFt.get(seg)?.value()??dfg,wdh=(segDispHt.get(seg)?.n??0)/((segDispHt.get(seg)?.n??0)+GROUP_A_FULL_SUITE_V1.segmentPriorWeight),wdf=(segDispFt.get(seg)?.n??0)/((segDispFt.get(seg)?.n??0)+GROUP_A_FULL_SUITE_V1.segmentPriorWeight),Dht=(1-wdh)*dhg+wdh*dhs,Dft=(1-wdf)*dfg+wdf*dfs,imbHt=Math.abs(base.htHome-base.htAway)/Math.max(.1,base.htHome+base.htAway),imbFt=Math.abs(base.ftHome-base.ftAway)/Math.max(.1,base.ftHome+base.ftAway),unc=1-Math.min(he.confidence,ae.confidence),mixHt=clamp(Math.sqrt(Math.max(0,Dht-1)/Math.max(.1,base.htHome+base.htAway))*(1+.25*imbHt+.25*unc),0,GROUP_A_FULL_SUITE_V1.dispersionMaxMix),mixFt=clamp(Math.sqrt(Math.max(0,Dft-1)/Math.max(.1,base.ftHome+base.ftAway))*(1+.25*imbFt+.25*unc),0,GROUP_A_FULL_SUITE_V1.dispersionMaxMix);run('ADAPTIVE_SCORE_DISPERSION_V1',null,{ht:mixtureGrid(base.htHome,base.htAway,mixHt,10),ft:mixtureGrid(base.ftHome,base.ftAway,mixFt,14)},mixHt>1e-6||mixFt>1e-6,false);
    }
    for(const u of updates){oppHt.update(u.oppXh,u.htRh);oppHt.update(u.oppXa,u.htRa);oppFt.update(u.oppXh,u.ftRh);oppFt.update(u.oppXa,u.ftRa);if(Math.abs(u.bridgeH)>1e-9){bridgeHt.update([u.bridgeH],u.htRh);bridgeFt.update([u.bridgeH],u.ftRh)}if(Math.abs(u.bridgeA)>1e-9){bridgeHt.update([u.bridgeA],u.htRa);bridgeFt.update([u.bridgeA],u.ftRa)}globalHt.add(u.htRh,u.htRa);globalFt.add(u.ftRh,u.ftRa);const sh=segHt.get(u.seg)??new RunningResidual(),sf=segFt.get(u.seg)??new RunningResidual();sh.add(u.htRh,u.htRa);sf.add(u.ftRh,u.ftRa);segHt.set(u.seg,sh);segFt.set(u.seg,sf);globalDispHt.add(u.htTotal,u.baseHt);globalDispFt.add(u.ftTotal,u.baseFt);const dh=segDispHt.get(u.seg)??new RunningDisp(),df=segDispFt.get(u.seg)??new RunningDisp();dh.add(u.htTotal,u.baseHt);df.add(u.ftTotal,u.baseFt);segDispHt.set(u.seg,dh);segDispFt.set(u.seg,df)}
    for(const f of batch){const c={id:f.id,matchDate:f.matchDate,homeTeam:f.homeTeam,awayTeam:f.awayTeam,ht:f.ht,ft:f.ft};capPush(team,k(f.homeTeam),c,historyCap);capPush(team,k(f.awayTeam),c,historyCap);capPush(h2h,pk(f.homeTeam,f.awayTeam),c,historyCap);if(f.homeTeamId)lastComp.set(f.homeTeamId,f.competitionKey);if(f.awayTeamId)lastComp.set(f.awayTeamId,f.competitionKey)}start=end;}
  const b=finish(baselineMetrics),bs=segDone(baselineSegments),suite={};suite.OPPONENT_STRENGTH_ARM_V1=finishCandidate('OPPONENT_STRENGTH_ARM_V1',states.OPPONENT_STRENGTH_ARM_V1,b,bs,{ht:oppHt.snapshot(),ft:oppFt.snapshot()},{featurePolicy:'STRICT_PRIOR_ATTACK_DEFENSE_NET_STRENGTH_DATE_BATCHED_RIDGE'});suite.PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1=finishCandidate('PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1',states.PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1,b,bs,{ht:bridgeHt.snapshot(),ft:bridgeFt.snapshot()},{featurePolicy:'COMPETITION_MEAN_STRENGTH_BRIDGE_ON_ACTUAL_PRIOR_COMPETITION_TRANSITIONS'});suite.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1=finishCandidate('HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',states.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1,b,bs,{globalHt:globalHt.means(),globalFt:globalFt.means(),segments:segHt.size},{featurePolicy:'PARTIAL_POOLING_SEGMENT_RESIDUAL_INTENSITY'});suite.ADAPTIVE_SCORE_DISPERSION_V1=finishCandidate('ADAPTIVE_SCORE_DISPERSION_V1',states.ADAPTIVE_SCORE_DISPERSION_V1,b,bs,{globalHt:globalDispHt.value(),globalFt:globalDispFt.value(),segments:segDispHt.size},{featurePolicy:'STRICT_PRIOR_SEGMENT_DISPERSION_PLUS_FAVORITE_IMBALANCE_AND_STRENGTH_UNCERTAINTY_COMMON_POISSON_MIXTURE'});
  const fingerprint=fnv(JSON.stringify(Object.fromEntries(Object.entries(suite).map(([x,v])=>[x,{coverage:v.coverage,aggregate:v.aggregate,regressions:v.regressions,learner:v.learner}]))));
  return {version:GROUP_A_FULL_SUITE_V1.version,status:'RESEARCH_ONLY',baselineLock,baseline:{engine:PRODUCTION_BASELINE_LOCK.engine,runtime:PRODUCTION_BASELINE_LOCK.runtime,primaryContract:PRODUCTION_BASELINE_LOCK.primaryContract,multiMarketVersion:MULTI_MARKET_VERSION,commitSha:PRODUCTION_BASELINE_LOCK.commitSha},strictPrior:true,sameDateLeakage:false,futureLeakage:false,noReconstruction:true,decisionUse:false,productionMutationAllowed:false,coverage:{fixtureCount:rows.length,baselineEligible,priorMissing,baseMissing},baselineMetrics:b,baselineSegments:bs,challengers:suite,determinism:{fingerprint,status:'FINGERPRINT_EMITTED'},groupAVerdict:Object.values(suite).every(x=>x.hardBlockers.length===0)?'PASS':'HOLD'};
}

async function main(){const corpus=JSON.parse(await fs.readFile(process.argv[2],'utf8')),features=JSON.parse(await fs.readFile(process.argv[3],'utf8')),output=process.argv[4]??'group-a-full-suite-result.json',result=runGroupAFullSuiteV1(corpus,features);await fs.writeFile(output,JSON.stringify(result)+'\n');process.stdout.write(JSON.stringify({output,version:result.version,coverage:result.coverage,groupAVerdict:result.groupAVerdict,challengers:Object.fromEntries(Object.entries(result.challengers).map(([k,v])=>[k,{coverage:v.coverage,delta:v.aggregate.deltaVsProduction,regressions:v.regressions,hardBlockers:v.hardBlockers,promotionDecision:v.promotionDecision}]))},null,2)+'\n');}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1});