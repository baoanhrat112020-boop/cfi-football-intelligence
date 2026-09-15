export const CFI_LIVE_VERSION='CFI_LIVE_V1';
export const CFI_LIVE_MODEL_REVISION='CFI_LIVE_CHALLENGER_V1.1';
export const CFI_LIVE_CONTRACT='CFI_LIVE_2_METHODS_X_6_TARGETS_V1';

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
type MethodValue={methodA:number;methodB:number;final:number;resolved?:boolean};
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
const mean=(a:number,b:number)=>clamp((a+b)/2);

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
  const home=finite(prematch?.scoreline?.expectedGoals?.ftHome,finite(prematch?.scoreline?.expected?.ft?.home,finite(prematch?.expectedGoals?.ft?.home,1.35)));
  const away=finite(prematch?.scoreline?.expectedGoals?.ftAway,finite(prematch?.scoreline?.expected?.ft?.away,finite(prematch?.expectedGoals?.ft?.away,1.35)));
  return {home,away,total:home+away};
}
function effectiveHorizons(s:LiveState){
  const first=45+clamp(finite(s.estimatedFirstHalfStoppageMinutes,3),0,10);
  const second=45+clamp(finite(s.estimatedSecondHalfStoppageMinutes,5),0,15);
  return {ht:first,ft:first+second};
}
function scoreMultiplier(goalsFor:number,goalsAgainst:number){const deficit=goalsAgainst-goalsFor;if(deficit>=2)return 1.20;if(deficit===1)return 1.10;if(deficit<=-1)return .95;return 1;}
function redCardMultiplier(cards:number){return Math.pow(.70,clamp(Math.floor(finite(cards)),0,2));}
function contextualMultipliers(s:LiveState){return {home:clamp(scoreMultiplier(s.homeGoals,s.awayGoals)*redCardMultiplier(finite(s.redCardsHome)),.42,1.25),away:clamp(scoreMultiplier(s.awayGoals,s.homeGoals)*redCardMultiplier(finite(s.redCardsAway)),.42,1.25)};}

function methodAProjection(prematch:any,s:LiveState):HazardProjection{
  const horizons=effectiveHorizons(s),minute=Math.min(horizons.ft,Math.max(0,s.minute));
  const remainingFraction=Math.max(0,horizons.ft-minute)/horizons.ft;
  const ftExp=productionFtExpectation(prematch),observed=s.homeGoals+s.awayGoals;
  const goalPaceRate=minute>8?observed/(minute/horizons.ft):ftExp.total;
  const baselineRate=.72*ftExp.total+.28*goalPaceRate;
  const prematchShare=ftExp.total>0?clamp(ftExp.home/ftExp.total,.2,.8):.5;
  const m=momentum(s),tilt=Math.exp(.10*m);
  const directionalShareHome=clamp((prematchShare*tilt)/Math.max(prematchShare*tilt+(1-prematchShare)/Math.max(tilt,.01),.001),.12,.88);
  const tempo=clamp(finite(s.leagueTempoFactor,1),.85,1.15);
  const total=clamp(baselineRate*remainingFraction*tempo,0,6);
  return {total,home:total*directionalShareHome,away:total*(1-directionalShareHome),effectiveFtHorizon:horizons.ft,effectiveHtHorizon:horizons.ht,remainingFraction,baselineRate,qualityRate:null,goalPaceRate,homeContextMultiplier:1,awayContextMultiplier:1,leagueTempoFactor:tempo,directionalShareHome};
}

function methodBProjection(prematch:any,s:LiveState):HazardProjection{
  const horizons=effectiveHorizons(s),minute=Math.min(horizons.ft,Math.max(0,s.minute));
  const remainingFraction=Math.max(0,horizons.ft-minute)/horizons.ft;
  const ftExp=productionFtExpectation(prematch),observed=s.homeGoals+s.awayGoals;
  const goalPaceRate=minute>8?observed/(minute/horizons.ft):ftExp.total;
  const hasXg=Number.isFinite(Number(s.xgHome))&&Number.isFinite(Number(s.xgAway));
  const qualityRate=hasXg&&minute>8?(finite(s.xgHome)+finite(s.xgAway))/(minute/horizons.ft):null;
  const baselineRate=qualityRate==null?.72*ftExp.total+.28*goalPaceRate:.68*ftExp.total+.22*qualityRate+.10*goalPaceRate;
  const prematchShare=ftExp.total>0?clamp(ftExp.home/ftExp.total,.2,.8):.5;
  const context=contextualMultipliers(s),m=momentum(s),momentumTilt=Math.exp(.22*m);
  const rawHome=prematchShare*context.home*momentumTilt,rawAway=(1-prematchShare)*context.away/Math.max(momentumTilt,.01);
  const directionalShareHome=clamp(rawHome/Math.max(rawHome+rawAway,.001),.12,.88);
  const weightedContext=prematchShare*context.home+(1-prematchShare)*context.away;
  const tempo=clamp(finite(s.leagueTempoFactor,1),.85,1.15);
  const total=clamp(baselineRate*remainingFraction*weightedContext*tempo,0,6);
  return {total,home:total*directionalShareHome,away:total*(1-directionalShareHome),effectiveFtHorizon:horizons.ft,effectiveHtHorizon:horizons.ht,remainingFraction,baselineRate,qualityRate,goalPaceRate,homeContextMultiplier:context.home,awayContextMultiplier:context.away,leagueTempoFactor:tempo,directionalShareHome};
}

function averageProjection(a:HazardProjection,b:HazardProjection):HazardProjection{
  return {total:(a.total+b.total)/2,home:(a.home+b.home)/2,away:(a.away+b.away)/2,effectiveFtHorizon:b.effectiveFtHorizon,effectiveHtHorizon:b.effectiveHtHorizon,remainingFraction:b.remainingFraction,baselineRate:(a.baselineRate+b.baselineRate)/2,qualityRate:b.qualityRate,goalPaceRate:(a.goalPaceRate+b.goalPaceRate)/2,homeContextMultiplier:b.homeContextMultiplier,awayContextMultiplier:b.awayContextMultiplier,leagueTempoFactor:b.leagueTempoFactor,directionalShareHome:((a.home+b.home)/2)/Math.max((a.total+b.total)/2,.001)};
}
function poissonTail(lambda:number,k:number){let term=Math.exp(-lambda),sum=term;for(let i=1;i<k;i++){term*=lambda/i;sum+=term;}return clamp(1-sum);}
function targetProbability(current:number,threshold:number,lambdaRemaining:number){const need=Math.max(0,threshold-current);return need===0?1:poissonTail(lambdaRemaining,need);}
function directionalTop3(s:LiveState,homeRemaining:number,awayRemaining:number):ScoreRow[]{
  const h0=s.homeGoals,a0=s.awayGoals,candidates:Array<{score:string;d:number}>=[];
  for(let h=h0;h<=Math.min(9,h0+5);h++)for(let a=a0;a<=Math.min(9,a0+5);a++)candidates.push({score:`${h}-${a}`,d:Math.abs((h-h0)-homeRemaining)+Math.abs((a-a0)-awayRemaining)});
  const top=candidates.sort((a,b)=>a.d-b.d||a.score.localeCompare(b.score)).slice(0,3),w=top.map((x,i)=>Math.exp(-x.d)*[1,.78,.62][i]),z=w.reduce((a,b)=>a+b,0)||1;
  return top.map((x,i)=>({score:x.score,probability:w[i]/z}));
}
function market(methodA:number,methodB:number,resolved=false):MethodValue{return {methodA,methodB,final:mean(methodA,methodB),...(resolved?{resolved:true}:{})};}

export function buildLivePrediction(prematch:any,rawState:any){
  const s=validateLiveState(rawState),current=s.homeGoals+s.awayGoals;
  const projectionA=methodAProjection(prematch,s),projectionB=methodBProjection(prematch,s),projection=averageProjection(projectionA,projectionB);
  const htFraction=s.period==='1H'?clamp((projection.effectiveHtHorizon-s.minute)/Math.max(1,projection.effectiveFtHorizon-s.minute),0,.70):0;
  const htA={home:projectionA.home*htFraction,away:projectionA.away*htFraction},htB={home:projectionB.home*htFraction,away:projectionB.away*htFraction},htFinal={home:projection.home*htFraction,away:projection.away*htFraction};
  const resolvedHtHome=s.period==='1H'?null:finite(s.htHomeGoals),resolvedHtAway=s.period==='1H'?null:finite(s.htAwayGoals),resolvedHtTotal=(resolvedHtHome??0)+(resolvedHtAway??0),resolved=s.period!=='1H';
  const threeHt=resolved?market(Number(resolvedHtTotal>=3),Number(resolvedHtTotal>=3),true):market(targetProbability(current,3,htA.home+htA.away),targetProbability(current,3,htB.home+htB.away));
  const sevenFt=market(targetProbability(current,7,projectionA.total),targetProbability(current,7,projectionB.total));
  const otherHt=resolved?market(Number(Math.max(resolvedHtHome??0,resolvedHtAway??0)>=4),Number(Math.max(resolvedHtHome??0,resolvedHtAway??0)>=4),true):market(Math.max(targetProbability(s.homeGoals,4,htA.home),targetProbability(s.awayGoals,4,htA.away)),Math.max(targetProbability(s.homeGoals,4,htB.home),targetProbability(s.awayGoals,4,htB.away)));
  const otherFt=market(Math.max(targetProbability(s.homeGoals,5,projectionA.home),targetProbability(s.awayGoals,5,projectionA.away)),Math.max(targetProbability(s.homeGoals,5,projectionB.home),targetProbability(s.awayGoals,5,projectionB.away)));
  const frozenHt=resolved?[{score:`${resolvedHtHome}-${resolvedHtAway}`,probability:1}]:null;
  const top3HtA=frozenHt??directionalTop3(s,htA.home,htA.away),top3HtB=frozenHt??directionalTop3(s,htB.home,htB.away),top3HtFinal=frozenHt??directionalTop3(s,htFinal.home,htFinal.away);
  const top3FtA=directionalTop3(s,projectionA.home,projectionA.away),top3FtB=directionalTop3(s,projectionB.home,projectionB.away),top3FtFinal=directionalTop3(s,projection.home,projection.away);
  const markets={'3+ HT':threeHt,'7+ FT':sevenFt,'Other HT':otherHt,'Other FT':otherFt};
  const scoreline={ht:{methodA:top3HtA,methodB:top3HtB,final:top3HtFinal,resolved},ft:{methodA:top3FtA,methodB:top3FtB,final:top3FtFinal},uncertainty:projection.total>2.2?'HIGH':projection.total>1?'MEDIUM':'LOW'};
  return {status:'SUCCESS',engine:CFI_LIVE_VERSION,modelRevision:CFI_LIVE_MODEL_REVISION,mode:'LIVE',contract:CFI_LIVE_CONTRACT,liveState:s,prematchEngine:String(prematch?.engine??'UNKNOWN'),prematchSnapshotPolicy:'READ_ONLY_PRIOR_NO_WRITEBACK',
    markets,scoreline,sixTargetMatrix:{contract:CFI_LIVE_CONTRACT,threshold:markets,scoreline:{'Top-3 HT':scoreline.ht,'Top-3 FT':scoreline.ft},verification:{complete:true,methodA:true,methodB:true,final:true}},
    mostLikelyPath:`${top3HtFinal[0]?.score} HT → ${top3FtFinal[0]?.score} FT`,globalPriorPolicy:{role:'CONTEXT_ONLY',thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false},
    audit:{version:CFI_LIVE_VERSION,modelRevision:CFI_LIVE_MODEL_REVISION,deterministic:true,methodIntegrity:'A_B_FINAL_PRESENT',remainingGoalExpectation:projection.total,remainingGoalExpectationMethods:{methodA:projectionA.total,methodB:projectionB.total,final:projection.total},directionalRemainingGoalExpectation:{home:projection.home,away:projection.away},prematchFtExpectation:productionFtExpectation(prematch),momentum:momentum(s),hazard:{effectiveFtHorizon:projection.effectiveFtHorizon,effectiveHtHorizon:projection.effectiveHtHorizon,remainingFraction:projection.remainingFraction,baselineRate:projection.baselineRate,qualityRate:projectionB.qualityRate,goalPaceRate:projection.goalPaceRate,homeContextMultiplier:projectionB.homeContextMultiplier,awayContextMultiplier:projectionB.awayContextMultiplier,leagueTempoFactor:projection.leagueTempoFactor,directionalShareHome:projection.directionalShareHome},substitutionsTelemetryOnly:true,usesLiveEvidence:true,mutatesPrematch:false,resolvedHtUsesActualHalftimeScore:resolved}};
}
