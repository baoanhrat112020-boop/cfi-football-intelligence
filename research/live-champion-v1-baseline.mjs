const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
function momentum(s){const sot=finite(s.shotsOnTargetHome)-finite(s.shotsOnTargetAway);const da=(finite(s.dangerousAttacksHome)-finite(s.dangerousAttacksAway))/20;const red=finite(s.redCardsAway)-finite(s.redCardsHome);return clamp(.12*sot+.08*da+.35*red,-1.5,1.5)}
function ftExp(p){const home=finite(p?.scoreline?.expectedGoals?.ftHome,1.35),away=finite(p?.scoreline?.expectedGoals?.ftAway,1.35);return {home,away,total:home+away}}
function remaining(p,s){const minute=Math.min(95,Math.max(0,s.minute));const r=Math.max(0,95-minute)/95;const exp=ftExp(p).total;const observed=s.homeGoals+s.awayGoals;const pace=minute>8?observed/(minute/95):exp;return clamp((.72*exp+.28*pace)*r,0,6)}
function tail(lambda,k){let term=Math.exp(-lambda),sum=term;for(let i=1;i<k;i++){term*=lambda/i;sum+=term}return clamp(1-sum)}
function target(current,threshold,lambda){const need=Math.max(0,threshold-current);return need===0?1:tail(lambda,need)}
export function buildChampionV1Prediction(prematch,s){
 const current=s.homeGoals+s.awayGoals,rem=remaining(prematch,s);const htRem=s.period==='1H'?rem*clamp((48-s.minute)/Math.max(1,95-s.minute),0,.65):0;const htH=s.period==='1H'?null:finite(s.htHomeGoals),htA=s.period==='1H'?null:finite(s.htAwayGoals),htT=(htH??0)+(htA??0);
 const m=momentum(s),share=clamp(.5+.16*m,.18,.82);
 return {engine:'CFI_LIVE_V1_BASELINE_FROZEN',markets:{'3+ HT':{final:s.period==='1H'?target(current,3,htRem):Number(htT>=3)},'7+ FT':{final:target(current,7,rem)},'Other HT':{final:s.period==='1H'?Math.max(target(s.homeGoals,4,htRem*.55),target(s.awayGoals,4,htRem*.45)):Number(Math.max(htH??0,htA??0)>=4)},'Other FT':{final:Math.max(target(s.homeGoals,5,rem*.55),target(s.awayGoals,5,rem*.45))}},audit:{remainingGoalExpectation:rem,momentum:m,directionalShareHome:share}};
}
