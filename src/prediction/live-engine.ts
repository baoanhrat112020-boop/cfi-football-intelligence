export const CFI_LIVE_VERSION='CFI_LIVE_V1';
export const CFI_LIVE_MODEL_REVISION='CFI_LIVE_CHALLENGER_V1.1';

export type LiveState={
  minute:number;
  period:'1H'|'HT'|'2H';
  homeGoals:number;
  awayGoals:number;
  htHomeGoals?:number;
  htAwayGoals?:number;
  shotsOnTargetHome?:number;
  shotsOnTargetAway?:number;
  dangerousAttacksHome?:number;
  dangerousAttacksAway?:number;
  xgHome?:number;
  xgAway?:number;
  rollingXgHome?:number;
  rollingXgAway?:number;
  substitutionsHome?:number;
  substitutionsAway?:number;
  redCardsHome?:number;
  redCardsAway?:number;
  estimatedFirstHalfStoppageMinutes?:number;
  estimatedSecondHalfStoppageMinutes?:number;
  leagueTempoFactor?:number;
};

type ScoreRow={score:string;probability:number};
type HazardProjection={
  total:number;
  home:number;
  away:number;
  effectiveFtHorizon:number;
  effectiveHtHorizon:number;
  remainingFraction:number;
  baselineRate:number;
  qualityRate:number|null;
  goalPaceRate:number;
  homeContextMultiplier:number;
  awayContextMultiplier:number;
  leagueTempoFactor:number;
  directionalShareHome:number;
};
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(x:unknown,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const optionalFinite=(x:unknown)=>Number.isFinite(Number(x))?Number(x):undefined;

export function validateLiveState(x:any):LiveState{
  const minute=finite(x?.minute,-1),homeGoals=finite(x?.homeGoals,-1),awayGoals=finite(x?.awayGoals,-1);
  const period=String(x?.period??'') as LiveState['period'];
  if(minute<0||minute>130||homeGoals<0||awayGoals<0||!['1H','HT','2H'].includes(period))throw new Error('INVALID_LIVE_STATE');
  if(period==='1H'&&minute>55)throw new Error('INVALID_LIVE_PERIOD_MINUTE');
  if(period==='HT'&&(minute<40||minute>60))throw new Error('INVALID_LIVE_PERIOD_MINUTE');
  if(period==='2H'&&minute<45)throw new Error('INVALID_LIVE_PERIOD_MINUTE');
  const hasHt=Number.isFinite(Number(x?.htHomeGoals))&&Number.isFinite(Number(x?.htAwayGoals));
  if(period==='2H'&&!hasHt)throw new Error('LIVE_HT_STATE_REQUIRED_AFTER_HALFTIME');
  const htHomeGoals=period==='HT'?homeGoals:(hasHt?finite(x?.htHomeGoals):undefined);
  const htAwayGoals=period==='HT'?awayGoals:(hasHt?finite(x?.htAwayGoals):undefined);
  if(htHomeGoals!=null&&htAwayGoals!=null&&(htHomeGoals>homeGoals||htAwayGoals>awayGoals))throw new Error('INVALID_HALFTIME_SCORE');
  const nonNegativeFields=['shotsOnTargetHome','shotsOnTargetAway','dangerousAttacksHome','dangerousAttacksAway','xgHome','xgAway','rollingXgHome','rollingXgAway','substitutionsHome','substitutionsAway','redCardsHome','redCardsAway','estimatedFirstHalfStoppageMinutes','estimatedSecondHalfStoppageMinutes'];
  for(const field of nonNegativeFields){const v=optionalFinite(x?.[field]);if(v!=null&&v<0)throw new Error(`INVALID_LIVE_FIELD_${field.toUpperCase()}`);}
  const tempo=optionalFinite(x?.leagueTempoFactor);
  if(tempo!=null&&(tempo<0.5||tempo>1.5))throw new Error('INVALID_LIVE_FIELD_LEAGUETEMPOFACTOR');
  return {minute,period,homeGoals,awayGoals,htHomeGoals,htAwayGoals,
    shotsOnTargetHome:finite(x?.shotsOnTargetHome,0),shotsOnTargetAway:finite(x?.shotsOnTargetAway,0),
    dangerousAttacksHome:finite(x?.dangerousAttacksHome,0),dangerousAttacksAway:finite(x?.dangerousAttacksAway,0),
    xgHome:optionalFinite(x?.xgHome),xgAway:optionalFinite(x?.xgAway),rollingXgHome:optionalFinite(x?.rollingXgHome),rollingXgAway:optionalFinite(x?.rollingXgAway),
    substitutionsHome:finite(x?.substitutionsHome,0),substitutionsAway:finite(x?.substitutionsAway,0),
    redCardsHome:finite(x?.redCardsHome,0),redCardsAway:finite(x?.redCardsAway,0),
    estimatedFirstHalfStoppageMinutes:optionalFinite(x?.estimatedFirstHalfStoppageMinutes),estimatedSecondHalfStoppageMinutes:optionalFinite(x?.estimatedSecondHalfStoppageMinutes),
    leagueTempoFactor:optionalFinite(x?.leagueTempoFactor)};
}

function momentum(s:LiveState){
  const sot=finite(s.shotsOnTargetHome)-finite(s.shotsOnTargetAway);
  const da=(finite(s.dangerousAttacksHome)-finite(s.dangerousAttacksAway))/20;
  const hasRolling=Number.isFinite(Number(s.rollingXgHome))&&Number.isFinite(Number(s.rollingXgAway));
  const xg=hasRolling?finite(s.rollingXgHome)-finite(s.rollingXgAway):0;
  return clamp(.09*sot+.05*da+(hasRolling?.32*xg:0),-1.25,1.25);
}
function productionFtExpectation(prematch:any){
  const home=finite(
    prematch?.scoreline?.expectedGoals?.ftHome,
    finite(prematch?.scoreline?.expected?.ft?.home,finite(prematch?.expectedGoals?.ft?.home,1.35))
  );
  const away=finite(
    prematch?.scoreline?.expectedGoals?.ftAway,
    finite(prematch?.scoreline?.expected?.ft?.away,finite(prematch?.expectedGoals?.ft?.away,1.35))
  );
  return {home,away,total:home+away};
}
function effectiveHorizons(s:LiveState){
  const first=45+clamp(finite(s.estimatedFirstHalfStoppageMinutes,3),0,10);
  const second=45+clamp(finite(s.estimatedSecondHalfStoppageMinutes,5),0,15);
  return {ht:first,ft:first+second};
}
function scoreMultiplier(goalsFor:number,goalsAgainst:number){
  const deficit=goalsAgainst-goalsFor;
  if(deficit>=2)return 1.20;
  if(deficit===1)return 1.10;
  if(deficit<=-1)return .95;
  return 1;
}
function redCardMultiplier(cards:number){return Math.pow(.70,clamp(Math.floor(finite(cards)),0,2));}
function contextualMultipliers(s:LiveState){
  return {
    home:clamp(scoreMultiplier(s.homeGoals,s.awayGoals)*redCardMultiplier(finite(s.redCardsHome)),.42,1.25),
    away:clamp(scoreMultiplier(s.awayGoals,s.homeGoals)*redCardMultiplier(finite(s.redCardsAway)),.42,1.25)
  };
}
function projectedRemainingGoals(prematch:any,s:LiveState):HazardProjection{
  const horizons=effectiveHorizons(s),minute=Math.min(horizons.ft,Math.max(0,s.minute));
  const remainingFraction=Math.max(0,horizons.ft-minute)/horizons.ft;
  const ftExp=productionFtExpectation(prematch),observed=s.homeGoals+s.awayGoals;
  const goalPaceRate=minute>8?observed/(minute/horizons.ft):ftExp.total;
  const hasXg=Number.isFinite(Number(s.xgHome))&&Number.isFinite(Number(s.xgAway));
  const qualityRate=hasXg&&minute>8?(finite(s.xgHome)+finite(s.xgAway))/(minute/horizons.ft):null;
  const baselineRate=qualityRate==null?.72*ftExp.total+.28*goalPaceRate:.68*ftExp.total+.22*qualityRate+.10*goalPaceRate;
  const prematchShare=ftExp.total>0?clamp(ftExp.home/ftExp.total,.2,.8):.5;
  const context=contextualMultipliers(s),m=momentum(s);
  const momentumTilt=Math.exp(.22*m);
  const rawHome=prematchShare*context.home*momentumTilt;
  const rawAway=(1-prematchShare)*context.away/Math.max(momentumTilt,.01);
  const directionalShareHome=clamp(rawHome/Math.max(rawHome+rawAway,.001),.12,.88);
  const weightedContext=prematchShare*context.home+(1-prematchShare)*context.away;
  const tempo=clamp(finite(s.leagueTempoFactor,1),.85,1.15);
  const total=clamp(baselineRate*remainingFraction*weightedContext*tempo,0,6);
  return {total,home:total*directionalShareHome,away:total*(1-directionalShareHome),effectiveFtHorizon:horizons.ft,effectiveHtHorizon:horizons.ht,remainingFraction,baselineRate,qualityRate,goalPaceRate,homeContextMultiplier:context.home,awayContextMultiplier:context.away,leagueTempoFactor:tempo,directionalShareHome};
}
function poissonTail(lambda:number,k:number){let term=Math.exp(-lambda),sum=term;for(let i=1;i<k;i++){term*=lambda/i;sum+=term;}return clamp(1-sum);}
function targetProbability(current:number,threshold:number,lambdaRemaining:number){const need=Math.max(0,threshold-current);return need===0?1:poissonTail(lambdaRemaining,need);}
function directionalTop3(s:LiveState,homeRemaining:number,awayRemaining:number):ScoreRow[]{
  const h0=s.homeGoals,a0=s.awayGoals;
  const candidates:Array<{score:string;d:number}>=[];
  for(let h=h0;h<=Math.min(9,h0+5);h++)for(let a=a0;a<=Math.min(9,a0+5);a++)candidates.push({score:`${h}-${a}`,d:Math.abs((h-h0)-homeRemaining)+Math.abs((a-a0)-awayRemaining)});
  const top=candidates.sort((a,b)=>a.d-b.d||a.score.localeCompare(b.score)).slice(0,3),w=top.map((x,i)=>Math.exp(-x.d)*[1,.78,.62][i]),z=w.reduce((a,b)=>a+b,0)||1;
  return top.map((x,i)=>({score:x.score,probability:w[i]/z}));
}

export function buildLivePrediction(prematch:any,rawState:any){
  const s=validateLiveState(rawState),current=s.homeGoals+s.awayGoals,projection=projectedRemainingGoals(prematch,s),remaining=projection.total;
  const htRemainingFraction=s.period==='1H'?clamp((projection.effectiveHtHorizon-s.minute)/Math.max(1,projection.effectiveFtHorizon-s.minute),0,.70):0;
  const htHomeRemaining=projection.home*htRemainingFraction,htAwayRemaining=projection.away*htRemainingFraction,htRemaining=htHomeRemaining+htAwayRemaining;
  const resolvedHtHome=s.period==='1H'?null:finite(s.htHomeGoals),resolvedHtAway=s.period==='1H'?null:finite(s.htAwayGoals),resolvedHtTotal=(resolvedHtHome??0)+(resolvedHtAway??0);
  const threeHt=s.period==='1H'?targetProbability(current,3,htRemaining):Number(resolvedHtTotal>=3);
  const sevenFt=targetProbability(current,7,remaining);
  const otherHt=s.period==='1H'?Math.max(targetProbability(s.homeGoals,4,htHomeRemaining),targetProbability(s.awayGoals,4,htAwayRemaining)):Number(Math.max(resolvedHtHome??0,resolvedHtAway??0)>=4);
  const otherFt=Math.max(targetProbability(s.homeGoals,5,projection.home),targetProbability(s.awayGoals,5,projection.away));
  const top3Ft=directionalTop3(s,projection.home,projection.away);
  const top3Ht=s.period==='1H'?directionalTop3(s,htHomeRemaining,htAwayRemaining):[{score:`${resolvedHtHome}-${resolvedHtAway}`,probability:1}];
  return {status:'SUCCESS',engine:CFI_LIVE_VERSION,modelRevision:CFI_LIVE_MODEL_REVISION,mode:'LIVE',liveState:s,prematchEngine:String(prematch?.engine??'UNKNOWN'),prematchSnapshotPolicy:'READ_ONLY_PRIOR_NO_WRITEBACK',
    markets:{'3+ HT':{final:threeHt,resolved:s.period!=='1H'},'7+ FT':{final:sevenFt},'Other HT':{final:otherHt,resolved:s.period!=='1H'},'Other FT':{final:otherFt}},
    scoreline:{ht:{final:top3Ht,resolved:s.period!=='1H'},ft:{final:top3Ft},uncertainty:remaining>2.2?'HIGH':remaining>1?'MEDIUM':'LOW'},
    mostLikelyPath:`${top3Ht[0]?.score} HT → ${top3Ft[0]?.score} FT`,
    audit:{version:CFI_LIVE_VERSION,modelRevision:CFI_LIVE_MODEL_REVISION,deterministic:true,remainingGoalExpectation:remaining,directionalRemainingGoalExpectation:{home:projection.home,away:projection.away},prematchFtExpectation:productionFtExpectation(prematch),momentum:momentum(s),hazard:{effectiveFtHorizon:projection.effectiveFtHorizon,effectiveHtHorizon:projection.effectiveHtHorizon,remainingFraction:projection.remainingFraction,baselineRate:projection.baselineRate,qualityRate:projection.qualityRate,goalPaceRate:projection.goalPaceRate,homeContextMultiplier:projection.homeContextMultiplier,awayContextMultiplier:projection.awayContextMultiplier,leagueTempoFactor:projection.leagueTempoFactor,directionalShareHome:projection.directionalShareHome},substitutionsTelemetryOnly:true,usesLiveEvidence:true,mutatesPrematch:false,resolvedHtUsesActualHalftimeScore:s.period!=='1H'}};
}
