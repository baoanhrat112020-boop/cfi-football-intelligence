export const CFI_LIVE_VERSION='CFI_LIVE_V1';

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
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(x:unknown,d=0)=>Number.isFinite(Number(x))?Number(x):d;

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
function projectedRemainingGoals(prematch:any,s:LiveState){
  const minute=Math.min(95,Math.max(0,s.minute));
  const remaining=Math.max(0,95-minute)/95;
  const ftExp=finite(prematch?.scoreline?.expected?.ft?.home,finite(prematch?.expectedGoals?.ft?.home,1.35))+finite(prematch?.scoreline?.expected?.ft?.away,finite(prematch?.expectedGoals?.ft?.away,1.35));
  const observed=s.homeGoals+s.awayGoals;
  const pace=minute>8?observed/(minute/95):ftExp;
  return clamp((.72*ftExp+.28*pace)*remaining,0,6);
}
function poissonTail(lambda:number,k:number){let term=Math.exp(-lambda),sum=term;for(let i=1;i<k;i++){term*=lambda/i;sum+=term;}return clamp(1-sum);}
function targetProbability(current:number,threshold:number,lambdaRemaining:number){const need=Math.max(0,threshold-current);return need===0?1:poissonTail(lambdaRemaining,need);}
function directionalTop3(s:LiveState,remaining:number):ScoreRow[]{
  const m=momentum(s),share=clamp(.5+.16*m,.18,.82),hAdd=remaining*share,aAdd=remaining*(1-share),h0=s.homeGoals,a0=s.awayGoals;
  const candidates:Array<{score:string;d:number}>=[];
  for(let h=h0;h<=Math.min(9,h0+5);h++)for(let a=a0;a<=Math.min(9,a0+5);a++)candidates.push({score:`${h}-${a}`,d:Math.abs((h-h0)-hAdd)+Math.abs((a-a0)-aAdd)});
  const top=candidates.sort((a,b)=>a.d-b.d||a.score.localeCompare(b.score)).slice(0,3),w=top.map((x,i)=>Math.exp(-x.d)*[1,.78,.62][i]),z=w.reduce((a,b)=>a+b,0)||1;
  return top.map((x,i)=>({score:x.score,probability:w[i]/z}));
}

export function buildLivePrediction(prematch:any,rawState:any){
  const s=validateLiveState(rawState),current=s.homeGoals+s.awayGoals,remaining=projectedRemainingGoals(prematch,s);
  const htRemaining=s.period==='1H'?remaining*clamp((48-s.minute)/Math.max(1,95-s.minute),0,.65):0;
  const resolvedHtHome=s.period==='1H'?null:finite(s.htHomeGoals),resolvedHtAway=s.period==='1H'?null:finite(s.htAwayGoals),resolvedHtTotal=(resolvedHtHome??0)+(resolvedHtAway??0);
  const threeHt=s.period==='1H'?targetProbability(current,3,htRemaining):Number(resolvedHtTotal>=3);
  const sevenFt=targetProbability(current,7,remaining);
  const otherHt=s.period==='1H'?Math.max(targetProbability(s.homeGoals,4,htRemaining*.55),targetProbability(s.awayGoals,4,htRemaining*.45)):Number(Math.max(resolvedHtHome??0,resolvedHtAway??0)>=4);
  const otherFt=Math.max(targetProbability(s.homeGoals,5,remaining*.55),targetProbability(s.awayGoals,5,remaining*.45));
  const top3Ft=directionalTop3(s,remaining);
  const top3Ht=s.period==='1H'?directionalTop3(s,htRemaining):[{score:`${resolvedHtHome}-${resolvedHtAway}`,probability:1}];
  return {status:'SUCCESS',engine:CFI_LIVE_VERSION,mode:'LIVE',liveState:s,prematchEngine:String(prematch?.engine??'UNKNOWN'),prematchSnapshotPolicy:'READ_ONLY_PRIOR_NO_WRITEBACK',
    markets:{'3+ HT':{final:threeHt,resolved:s.period!=='1H'},'7+ FT':{final:sevenFt},'Other HT':{final:otherHt,resolved:s.period!=='1H'},'Other FT':{final:otherFt}},
    scoreline:{ht:{final:top3Ht,resolved:s.period!=='1H'},ft:{final:top3Ft},uncertainty:remaining>2.2?'HIGH':remaining>1?'MEDIUM':'LOW'},
    mostLikelyPath:`${top3Ht[0]?.score} HT → ${top3Ft[0]?.score} FT`,
    audit:{version:CFI_LIVE_VERSION,deterministic:true,remainingGoalExpectation:remaining,momentum:momentum(s),usesLiveEvidence:true,mutatesPrematch:false,resolvedHtUsesActualHalftimeScore:s.period!=='1H'}};
}
