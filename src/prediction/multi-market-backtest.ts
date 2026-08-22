import { buildPrediction, type CanonicalFixture } from './final-engine.ts';
import { buildMultiMarketV1 } from './multi-market-v1.ts';

const HALF_OU_HT=[0.5,1.5,2.5,3.5,4.5] as const;
const HALF_OU_FT=[1.5,2.5,3.5,4.5,5.5,6.5,7.5] as const;
const HALF_AH=[-1.5,-0.5,0.5,1.5] as const;

function outcome1x2(home:number,away:number){return home>away?'home':home<away?'away':'draw';}
function multiclassBrier(p:{home:number;draw:number;away:number},actual:'home'|'draw'|'away'){
  return ((p.home-(actual==='home'?1:0))**2+(p.draw-(actual==='draw'?1:0))**2+(p.away-(actual==='away'?1:0))**2)/3;
}
const brier=(p:number,y:number)=>(p-y)**2;

function emptyBinary(lines:readonly number[],sides:readonly string[]=['over']){
  return Object.fromEntries(lines.flatMap(line=>sides.map(side=>[`${line}:${side}`,{n:0,brier:0,positive:0}])));
}
function finalizeBinary(rows:Record<string,{n:number;brier:number;positive:number}>){
  return Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,{n:v.n,brier:v.n?v.brier/v.n:null,prevalence:v.n?v.positive/v.n:null}]));
}

export function walkForwardMultiMarketBacktest(fixtures:CanonicalFixture[],minPrior=8){
  const sorted=[...new Map(fixtures.map(r=>[`${r.matchDate}|${r.homeTeam}|${r.awayTeam}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
  const one={ht:{n:0,brier:0},ft:{n:0,brier:0}};
  const ouHt=emptyBinary(HALF_OU_HT),ouFt=emptyBinary(HALF_OU_FT);
  const ahHt=emptyBinary(HALF_AH,['home','away']),ahFt=emptyBinary(HALF_AH,['home','away']);
  let evaluated=0,skipped=0;
  for(let i=minPrior;i<sorted.length;i++){
    const target=sorted[i];
    const prior=sorted.slice(0,i).filter(r=>r.matchDate<target.matchDate);
    if(!prior.length){skipped++;continue;}
    const p:any=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,language:'en',homePayload:prior,awayPayload:prior,h2hPayload:prior});
    const e=p?.scoreline?.expectedGoals;
    if(!e||![e.htHome,e.htAway,e.ftHome,e.ftAway].every((v:any)=>Number.isFinite(Number(v))&&Number(v)>=0)){skipped++;continue;}
    const mm:any=buildMultiMarketV1({htHome:Number(e.htHome),htAway:Number(e.htAway),ftHome:Number(e.ftHome),ftAway:Number(e.ftAway)});
    if(mm.consistencyGuard.status!=='PASS'){skipped++;continue;}
    let used=false;
    if(target.ht){
      used=true;one.ht.n++;one.ht.brier+=multiclassBrier(mm.oneXTwo.ht,outcome1x2(target.ht.home,target.ht.away));
      const total=target.ht.home+target.ht.away;
      for(const line of HALF_OU_HT){const y=total>line?1:0,row=ouHt[`${line}:over`];row.n++;row.positive+=y;row.brier+=brier(mm.overUnder.ht[String(line)].over.fullWin,y);}
      for(const line of HALF_AH){
        const yh=(target.ht.home-target.ht.away)+line>0?1:0,ya=(target.ht.away-target.ht.home)-line>0?1:0;
        const rh=ahHt[`${line}:home`],ra=ahHt[`${line}:away`];rh.n++;rh.positive+=yh;rh.brier+=brier(mm.asianHandicap.ht[String(line)].home.fullWin,yh);ra.n++;ra.positive+=ya;ra.brier+=brier(mm.asianHandicap.ht[String(line)].away.fullWin,ya);
      }
    }
    if(target.ft){
      used=true;one.ft.n++;one.ft.brier+=multiclassBrier(mm.oneXTwo.ft,outcome1x2(target.ft.home,target.ft.away));
      const total=target.ft.home+target.ft.away;
      for(const line of HALF_OU_FT){const y=total>line?1:0,row=ouFt[`${line}:over`];row.n++;row.positive+=y;row.brier+=brier(mm.overUnder.ft[String(line)].over.fullWin,y);}
      for(const line of HALF_AH){
        const yh=(target.ft.home-target.ft.away)+line>0?1:0,ya=(target.ft.away-target.ft.home)-line>0?1:0;
        const rh=ahFt[`${line}:home`],ra=ahFt[`${line}:away`];rh.n++;rh.positive+=yh;rh.brier+=brier(mm.asianHandicap.ft[String(line)].home.fullWin,yh);ra.n++;ra.positive+=ya;ra.brier+=brier(mm.asianHandicap.ft[String(line)].away.fullWin,ya);
      }
    }
    if(used)evaluated++;else skipped++;
  }
  return {
    version:'CFI_MULTI_MARKET_WALK_FORWARD_V1',
    status:'RESEARCH_ONLY',
    strictPrior:true,
    leakage:false,
    decisionUse:false,
    evaluatedMatches:evaluated,
    skippedMatches:skipped,
    oneXTwo:{ht:{n:one.ht.n,brier:one.ht.n?one.ht.brier/one.ht.n:null},ft:{n:one.ft.n,brier:one.ft.n?one.ft.brier/one.ft.n:null}},
    overUnder:{ht:finalizeBinary(ouHt),ft:finalizeBinary(ouFt)},
    asianHandicap:{ht:finalizeBinary(ahHt),ft:finalizeBinary(ahFt)},
    scope:{overUnder:{ht:[...HALF_OU_HT],ft:[...HALF_OU_FT]},asianHandicap:[...HALF_AH],note:'Half-lines only in V1 benchmark; quarter-line settlement remains shadow until a dedicated multi-outcome scoring contract is validated.'},
  };
}
