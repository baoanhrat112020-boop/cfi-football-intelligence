import { buildChampionV1Prediction } from './live-champion-v1-baseline.mjs';
import { buildLivePrediction } from '../src/prediction/live-engine.ts';

export const LIVE_REPLAY_MARKETS=Object.freeze(['3+ HT','7+ FT','Other HT','Other FT']);
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const prob=x=>clamp(Number(x),1e-9,1-1e-9);
const brier=(p,y)=>(Number(p)-Number(y))**2;
const logLoss=(p,y)=>{const q=prob(p);return -(Number(y)*Math.log(q)+(1-Number(y))*Math.log(1-q));};

function actuals(snapshot){return {'3+ HT':Number(snapshot?.labels?.threePlusHT),'7+ FT':Number(snapshot?.labels?.sevenPlusFT),'Other HT':Number(snapshot?.labels?.otherHT),'Other FT':Number(snapshot?.labels?.otherFT)};}
function liveState(snapshot){
  const minute=Number(snapshot.minute),secondHalf=minute>45,ht=snapshot.halftimeScore;
  return {minute,period:secondHalf?'2H':'1H',homeGoals:Number(snapshot.score.home),awayGoals:Number(snapshot.score.away),
    ...(secondHalf?{htHomeGoals:Number(ht?.home),htAwayGoals:Number(ht?.away)}:{}),
    shotsOnTargetHome:Number(snapshot.shotsOnTarget?.home??0),shotsOnTargetAway:Number(snapshot.shotsOnTarget?.away??0),
    dangerousAttacksHome:0,dangerousAttacksAway:0,xgHome:Number(snapshot.xg?.home??0),xgAway:Number(snapshot.xg?.away??0),
    redCardsHome:Number(snapshot.redCards?.home??0),redCardsAway:Number(snapshot.redCards?.away??0),
    substitutionsHome:Number(snapshot.substitutions?.home??0),substitutionsAway:Number(snapshot.substitutions?.away??0),
    ...(Number.isFinite(Number(snapshot.leagueTempoFactor))?{leagueTempoFactor:Number(snapshot.leagueTempoFactor)}:{})};
}
function prematch(snapshot){return snapshot?.prediction??snapshot;}
function calibrationError(rows,bins=10){
  if(!rows.length)return NaN;let total=0;
  for(let i=0;i<bins;i++){const lo=i/bins,hi=(i+1)/bins;const xs=rows.filter(r=>r.p>=lo&&(i===bins-1?r.p<=hi:r.p<hi));if(!xs.length)continue;const mp=xs.reduce((a,r)=>a+r.p,0)/xs.length,my=xs.reduce((a,r)=>a+r.y,0)/xs.length;total+=xs.length/rows.length*Math.abs(mp-my);}return total;
}
function aggregate(rows,key){
  const flat=[];for(const row of rows)for(const market of LIVE_REPLAY_MARKETS)flat.push({p:Number(row[key][market]),y:Number(row.actual[market])});
  return {brier:flat.reduce((a,r)=>a+brier(r.p,r.y),0)/flat.length,logLoss:flat.reduce((a,r)=>a+logLoss(r.p,r.y),0)/flat.length,calibrationError:calibrationError(flat)};
}

export function evaluateDualReplay(records){
  const rows=[];let futureLeakageCount=0,sameDateLeakageCount=0,maxDeterminismDelta=0;
  const leagues=new Set(),countries=new Set(),minutes=new Set();
  for(const r of records??[]){
    const s=r.snapshot,prior=r.priorSnapshot,fixture=r.fixture??{};
    if(!s?.provenance?.strictPrefix||s?.provenance?.futureEventsIncluded!==false){futureLeakageCount++;continue;}
    if(!prior?.strict_prior||String(prior?.status)!=='SUCCESS')continue;
    const state=liveState(s),pm=prematch(prior);
    const c1=buildChampionV1Prediction(pm,state),c2=buildLivePrediction(pm,state),c2b=buildLivePrediction(pm,state);
    const champion={},challenger={};
    for(const m of LIVE_REPLAY_MARKETS){champion[m]=Number(c1.markets[m].final);challenger[m]=Number(c2.markets[m].final);maxDeterminismDelta=Math.max(maxDeterminismDelta,Math.abs(challenger[m]-Number(c2b.markets[m].final)));}
    rows.push({champion,challenger,actual:actuals(s)});minutes.add(Number(s.minute));if(fixture.competition_name??fixture.competition_key)leagues.add(String(fixture.competition_name??fixture.competition_key));if(fixture.country)countries.add(String(fixture.country));
  }
  if(!rows.length)return {status:'HOLD',reason:'NO_ELIGIBLE_STRICT_PRIOR_REPLAY_ROWS',candidate:null,rows:[]};
  const champ=aggregate(rows,'champion'),chal=aggregate(rows,'challenger');
  const markets={};
  for(const m of LIVE_REPLAY_MARKETS){const cb=rows.reduce((a,r)=>a+brier(r.champion[m],r.actual[m]),0)/rows.length;const xb=rows.reduce((a,r)=>a+brier(r.challenger[m],r.actual[m]),0)/rows.length;markets[m]={championBrier:cb,challengerBrier:xb,brierDelta:xb-cb};}
  const candidate={meta:{strictPrior:true,futureLeakageCount,sameDateLeakageCount,deterministic:maxDeterminismDelta===0,maxDeterminismDelta,samples:rows.length,leagues:leagues.size,countries:countries.size,snapshotMinutes:[...minutes].sort((a,b)=>a-b)},champion:champ,challenger:{...chal,markets}};
  return {status:'OK',candidate,rows};
}
