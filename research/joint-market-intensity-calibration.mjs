import { fairTwoWayProbabilities, fairThreeWayProbabilities, validateMarketSnapshot } from './market-snapshot-contract.mjs';

export const K034_JOINT_MARKET_INTENSITY_VERSION='CFI_K034_JOINT_MARKET_INTENSITY_V1';
export const K034_CONTRACT=Object.freeze({version:K034_JOINT_MARKET_INTENSITY_VERSION,researchOnly:true,decisionUse:false,baselineLock:'R0_IMMUTABLE',productionEligible:false,syntheticAllowed:false,reconstructedAllowed:false,strictPriorRequired:true});

const fact=[1,1,2,6,24,120,720,5040,40320,362880,3628800];
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/(fact[k]??Array.from({length:k},(_,i)=>i+1).reduce((a,b)=>a*b,1));
function model(lambdaHome,lambdaAway,line){
  let h=0,d=0,a=0,o=0,u=0,push=0;
  for(let x=0;x<=10;x++)for(let y=0;y<=10;y++){
    const p=pois(x,lambdaHome)*pois(y,lambdaAway),t=x+y;
    if(x>y)h+=p; else if(x===y)d+=p; else a+=p;
    if(t>line)o+=p; else if(t<line)u+=p; else push+=p;
  }
  const z=h+d+a; h/=z;d/=z;a/=z;
  const ou=o+u; return {home:h,draw:d,away:a,over:ou>0?o/ou:0.5,under:ou>0?u/ou:0.5,push};
}
const sq=x=>x*x;
export function fitJointMarketIntensity({oneXTwoSnapshot,overUnderSnapshot,synthetic=false,reconstructed=false}={}){
  if(synthetic||reconstructed)throw new Error('REAL_MARKET_SNAPSHOTS_REQUIRED');
  const a=validateMarketSnapshot(oneXTwoSnapshot??{}),b=validateMarketSnapshot(overUnderSnapshot??{});
  if(!a.valid)throw new Error('MARKET_SNAPSHOT_INVALID');
  if(oneXTwoSnapshot?.market_family!=='1X2'||oneXTwoSnapshot?.period!=='FT')throw new Error('VALID_FT_1X2_SNAPSHOT_REQUIRED');
  if(!b.valid)throw new Error('MARKET_SNAPSHOT_INVALID');
  if(overUnderSnapshot?.market_family!=='OVER_UNDER'||overUnderSnapshot?.period!=='FT')throw new Error('VALID_FT_OU_SNAPSHOT_REQUIRED');
  if(String(oneXTwoSnapshot.fixture_id??oneXTwoSnapshot.verified_fixture_id)!==String(overUnderSnapshot.fixture_id??overUnderSnapshot.verified_fixture_id))throw new Error('FIXTURE_MISMATCH');
  if(Date.parse(oneXTwoSnapshot.captured_at)>=Date.parse(oneXTwoSnapshot.kickoff_at)||Date.parse(overUnderSnapshot.captured_at)>=Date.parse(overUnderSnapshot.kickoff_at))throw new Error('STRICT_PRIOR_MARKET_FAILURE');
  const p1=fairThreeWayProbabilities(oneXTwoSnapshot.odds_home,oneXTwoSnapshot.odds_draw,oneXTwoSnapshot.odds_away);
  const p2=fairTwoWayProbabilities(overUnderSnapshot.odds_over,overUnderSnapshot.odds_under);
  const target={home:p1.home,draw:p1.draw,away:p1.away,over:p2.a,under:p2.b};
  let best=null;
  for(let lh=0.2;lh<=4.0001;lh+=0.05)for(let la=0.2;la<=4.0001;la+=0.05){
    const m=model(lh,la,Number(overUnderSnapshot.line));
    const loss=sq(m.home-target.home)+sq(m.draw-target.draw)+sq(m.away-target.away)+sq(m.over-target.over)+sq(m.under-target.under);
    if(!best||loss<best.loss-1e-15||(Math.abs(loss-best.loss)<=1e-15&&(lh<best.lambdaHome||(lh===best.lambdaHome&&la<best.lambdaAway))))best={lambdaHome:Number(lh.toFixed(2)),lambdaAway:Number(la.toFixed(2)),loss,model:m};
  }
  return {version:K034_JOINT_MARKET_INTENSITY_VERSION,status:'READY',researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',fixtureId:String(oneXTwoSnapshot.fixture_id??oneXTwoSnapshot.verified_fixture_id),capturedAtMax:new Date(Math.max(Date.parse(oneXTwoSnapshot.captured_at),Date.parse(overUnderSnapshot.captured_at))).toISOString(),kickoffAt:oneXTwoSnapshot.kickoff_at,targetFairProbabilities:target,fit:{lambdaHome:best.lambdaHome,lambdaAway:best.lambdaAway,totalIntensity:Number((best.lambdaHome+best.lambdaAway).toFixed(2)),squaredError:Number(best.loss.toFixed(10)),implied:best.model},audit:{strictPrior:true,pairedMarkets:['FT_1X2',`FT_OU_${overUnderSnapshot.line}`],vig:{oneXTwo:p1.vig,overUnder:p2.vig},deterministicGrid:{min:.2,max:4,step:.05}}};
}
