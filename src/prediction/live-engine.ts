export const CFI_LIVE_VERSION='CFI_LIVE_V1.1';
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
  redCardsHome?:number;
  redCardsAway?:number;
};

type ScoreRow={score:string;probability:number};
type MethodValue={methodA:number;methodB:number;final:number};

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(x:unknown,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const mean=(a:number,b:number)=>clamp((a+b)/2);

export function validateLiveState(x:any):LiveState{
  const minute=finite(x?.minute,-1),homeGoals=finite(x?.homeGoals,-1),awayGoals=finite(x?.awayGoals,-1);
  const period=String(x?.period??'') as LiveState['period'];
  if(minute<0||minute>130||homeGoals<0||awayGoals<0||!['1H','HT','2H'].includes(period))throw new Error('INVALID_LIVE_STATE');
  if(period==='1H'&&minute>55)throw new Error('INVALID_LIVE_PERIOD_MINUTE');
  if(period==='HT'&&(minute<40||minute>60))throw new Error('INVALID_LIVE_PERIOD_MINUTE');
  if(period==='2H'&&minute<45)throw new Error('INVALID_LIVE_PERIOD_MINUTE');

  let htHomeGoals:number|undefined,htAwayGoals:number|undefined;
  if(period!=='1H'){
    htHomeGoals=finite(x?.htHomeGoals,-1);htAwayGoals=finite(x?.htAwayGoals,-1);
    if(htHomeGoals<0||htAwayGoals<0)throw new Error('HALFTIME_SCORE_REQUIRED');
    if(period==='HT'&&(htHomeGoals!==homeGoals||htAwayGoals!==awayGoals))throw new Error('HALFTIME_SCORE_MISMATCH');
    if(period==='2H'&&(htHomeGoals>homeGoals||htAwayGoals>awayGoals))throw new Error('HALFTIME_SCORE_INVALID');
  }

  return {minute,period,homeGoals,awayGoals,htHomeGoals,htAwayGoals,
    shotsOnTargetHome:finite(x?.shotsOnTargetHome,0),shotsOnTargetAway:finite(x?.shotsOnTargetAway,0),
    dangerousAttacksHome:finite(x?.dangerousAttacksHome,0),dangerousAttacksAway:finite(x?.dangerousAttacksAway,0),
    redCardsHome:finite(x?.redCardsHome,0),redCardsAway:finite(x?.redCardsAway,0)};
}

function momentum(s:LiveState){
  const sot=finite(s.shotsOnTargetHome)-finite(s.shotsOnTargetAway);
  const da=(finite(s.dangerousAttacksHome)-finite(s.dangerousAttacksAway))/20;
  const red=finite(s.redCardsAway)-finite(s.redCardsHome);
  return clamp(.12*sot+.08*da+.35*red,-1.5,1.5);
}

function prematchExpected(prematch:any){
  const home=finite(prematch?.scoreline?.expected?.ft?.home,finite(prematch?.expectedGoals?.ft?.home,1.35));
  const away=finite(prematch?.scoreline?.expected?.ft?.away,finite(prematch?.expectedGoals?.ft?.away,1.35));
  return {home,away,total:Math.max(.1,home+away)};
}

function projectedRemainingGoals(prematch:any,s:LiveState,method:'A'|'B'){
  const minute=Math.min(95,Math.max(0,s.minute));
  const timeRemaining=Math.max(0,95-minute)/95;
  const exp=prematchExpected(prematch);
  const observed=s.homeGoals+s.awayGoals;
  const pace=minute>8?observed/(minute/95):exp.total;
  if(method==='A')return clamp((.72*exp.total+.28*pace)*timeRemaining,0,6);
  const liveActivity=minute>8?((finite(s.shotsOnTargetHome)+finite(s.shotsOnTargetAway))*.30+(finite(s.dangerousAttacksHome)+finite(s.dangerousAttacksAway))/80)/(minute/95):exp.total;
  return clamp((.58*exp.total+.22*pace+.20*clamp(liveActivity,0,8))*timeRemaining,0,6);
}

function methodShares(prematch:any,s:LiveState){
  const exp=prematchExpected(prematch),prematchShare=clamp(exp.home/exp.total,.18,.82),liveShare=clamp(.5+.16*momentum(s),.18,.82);
  return {A:clamp(.65*prematchShare+.35*liveShare,.18,.82),B:clamp(.35*prematchShare+.65*liveShare,.18,.82)};
}

function poissonTail(lambda:number,k:number){
  let term=Math.exp(-lambda),sum=term;
  for(let i=1;i<k;i++){term*=lambda/i;sum+=term;}
  return clamp(1-sum);
}

function targetProbability(current:number,threshold:number,lambdaRemaining:number){
  const need=Math.max(0,threshold-current);
  return need===0?1:poissonTail(lambdaRemaining,need);
}

function directionalTop3(s:LiveState,remaining:number,share:number):ScoreRow[]{
  const hAdd=remaining*share,aAdd=remaining*(1-share),h0=s.homeGoals,a0=s.awayGoals;
  const candidates:Array<{score:string;d:number}>=[];
  for(let h=h0;h<=Math.min(9,h0+5);h++)for(let a=a0;a<=Math.min(9,a0+5);a++){
    const d=Math.abs((h-h0)-hAdd)+Math.abs((a-a0)-aAdd);
    candidates.push({score:`${h}-${a}`,d});
  }
  const top=candidates.sort((a,b)=>a.d-b.d||a.score.localeCompare(b.score)).slice(0,3);
  const w=top.map((x,i)=>Math.exp(-x.d)*[1,.78,.62][i]),z=w.reduce((a,b)=>a+b,0)||1;
  return top.map((x,i)=>({score:x.score,probability:w[i]/z}));
}

function frozenHtScore(s:LiveState){
  if(s.period==='1H')return null;
  return {home:Number(s.htHomeGoals),away:Number(s.htAwayGoals)};
}

function market(methodA:number,methodB:number):MethodValue{return {methodA,methodB,final:mean(methodA,methodB)};}

export function buildLivePrediction(prematch:any,rawState:any){
  const s=validateLiveState(rawState),current=s.homeGoals+s.awayGoals;
  const remainingA=projectedRemainingGoals(prematch,s,'A'),remainingB=projectedRemainingGoals(prematch,s,'B'),remainingFinal=(remainingA+remainingB)/2;
  const shares=methodShares(prematch,s),shareFinal=(shares.A+shares.B)/2;
  const htFactor=s.period==='1H'?clamp((48-s.minute)/Math.max(1,95-s.minute),0,.65):0;
  const htRemainingA=remainingA*htFactor,htRemainingB=remainingB*htFactor,htRemainingFinal=remainingFinal*htFactor;
  const frozen=frozenHtScore(s);

  const threeHt=frozen?market((frozen.home+frozen.away)>=3?1:0,(frozen.home+frozen.away)>=3?1:0):market(targetProbability(current,3,htRemainingA),targetProbability(current,3,htRemainingB));
  const sevenFt=market(targetProbability(current,7,remainingA),targetProbability(current,7,remainingB));
  const otherHt=frozen?market(Math.max(frozen.home,frozen.away)>=4?1:0,Math.max(frozen.home,frozen.away)>=4?1:0):market(Math.max(targetProbability(s.homeGoals,4,htRemainingA*shares.A),targetProbability(s.awayGoals,4,htRemainingA*(1-shares.A))),Math.max(targetProbability(s.homeGoals,4,htRemainingB*shares.B),targetProbability(s.awayGoals,4,htRemainingB*(1-shares.B))));
  const otherFt=market(Math.max(targetProbability(s.homeGoals,5,remainingA*shares.A),targetProbability(s.awayGoals,5,remainingA*(1-shares.A))),Math.max(targetProbability(s.homeGoals,5,remainingB*shares.B),targetProbability(s.awayGoals,5,remainingB*(1-shares.B))));

  const top3FtA=directionalTop3(s,remainingA,shares.A),top3FtB=directionalTop3(s,remainingB,shares.B),top3FtFinal=directionalTop3(s,remainingFinal,shareFinal);
  const frozenTop=frozen?[{score:`${frozen.home}-${frozen.away}`,probability:1}]:null;
  const top3HtA=frozenTop??directionalTop3(s,htRemainingA,shares.A),top3HtB=frozenTop??directionalTop3(s,htRemainingB,shares.B),top3HtFinal=frozenTop??directionalTop3(s,htRemainingFinal,shareFinal);
  const markets={'3+ HT':threeHt,'7+ FT':sevenFt,'Other HT':otherHt,'Other FT':otherFt};
  const scoreline={ht:{methodA:top3HtA,methodB:top3HtB,final:top3HtFinal},ft:{methodA:top3FtA,methodB:top3FtB,final:top3FtFinal},uncertainty:remainingFinal>2.2?'HIGH':remainingFinal>1?'MEDIUM':'LOW'};

  return {
    status:'SUCCESS',engine:CFI_LIVE_VERSION,mode:'LIVE',contract:CFI_LIVE_CONTRACT,
    liveState:s,prematchEngine:String(prematch?.engine??'UNKNOWN'),prematchSnapshotPolicy:'READ_ONLY_PRIOR_NO_WRITEBACK',
    markets,scoreline,
    sixTargetMatrix:{contract:CFI_LIVE_CONTRACT,threshold:markets,scoreline:{'Top-3 HT':scoreline.ht,'Top-3 FT':scoreline.ft},verification:{complete:true,methodA:true,methodB:true,final:true}},
    mostLikelyPath:`${top3HtFinal[0]?.score??`${s.homeGoals}-${s.awayGoals}`} HT → ${top3FtFinal[0]?.score??`${s.homeGoals}-${s.awayGoals}`} FT`,
    globalPriorPolicy:{role:'CONTEXT_ONLY',thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false},
    audit:{version:CFI_LIVE_VERSION,deterministic:true,remainingGoalExpectation:{methodA:remainingA,methodB:remainingB,final:remainingFinal},momentum:momentum(s),usesLiveEvidence:true,mutatesPrematch:false,halftimeFrozen:s.period!=='1H',methodIntegrity:'A_B_FINAL_PRESENT'}
  };
}
