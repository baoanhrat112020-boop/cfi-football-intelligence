import { buildPrediction, type CanonicalFixture } from './final-engine.ts';
import { buildMultiMarketV1 } from './multi-market-v1.ts';
import { quarterMetrics, quarterStateFromDifference, type QuarterDistribution, type QuarterState } from './multi-market-quarter-evaluation.ts';

export const QUARTER_AH_LINES=[-1.75,-1.25,-.75,-.25,.25,.75,1.25,1.75] as const;
const teamKey=(s:string)=>s.trim().toLowerCase();
const involves=(f:CanonicalFixture,team:string)=>{const k=teamKey(team);return teamKey(f.homeTeam)===k||teamKey(f.awayTeam)===k;};
const pairMatch=(f:CanonicalFixture,home:string,away:string)=>{const h=teamKey(home),a=teamKey(away),fh=teamKey(f.homeTeam),fa=teamKey(f.awayTeam);return(fh===h&&fa===a)||(fh===a&&fa===h);};
function sorted(fixtures:CanonicalFixture[]){return[...new Map(fixtures.map(r=>[`${r.matchDate}|${teamKey(r.homeTeam)}|${teamKey(r.awayTeam)}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate)||a.id.localeCompare(b.id));}
const tail=<T>(rows:T[],cap:number)=>rows.length<=cap?rows:rows.slice(rows.length-cap);
const asQuarter=(s:any):QuarterDistribution=>({fullWin:Number(s.fullWin),halfWin:Number(s.halfWin),push:Number(s.push),halfLoss:Number(s.halfLoss),fullLoss:Number(s.fullLoss)});

type Bucket={p:QuarterDistribution;y:QuarterState};
type Buckets={ht:Record<string,{home:Bucket[];away:Bucket[]}>;ft:Record<string,{home:Bucket[];away:Bucket[]}>};
function empty():Buckets{return{ht:Object.fromEntries(QUARTER_AH_LINES.map(l=>[String(l),{home:[],away:[]}])) as any,ft:Object.fromEntries(QUARTER_AH_LINES.map(l=>[String(l),{home:[],away:[]}])) as any};}

export function walkForwardQuarterAhBacktest(fixtures:CanonicalFixture[],minTeamPrior=1,historyCap=10){
 const rows=sorted(fixtures),cap=Math.max(1,Math.floor(historyCap)),buckets=empty();let evaluated=0,skipped=0;let maxEvidenceDate:string|null=null;
 for(let i=0;i<rows.length;i++){
  const target=rows[i],prior=rows.slice(0,i).filter(r=>r.matchDate<target.matchDate);
  const hp=tail(prior.filter(r=>involves(r,target.homeTeam)),cap),ap=tail(prior.filter(r=>involves(r,target.awayTeam)),cap);
  if(hp.length<minTeamPrior||ap.length<minTeamPrior){skipped++;continue;}
  const h2h=tail(prior.filter(r=>pairMatch(r,target.homeTeam,target.awayTeam)),cap);
  const maxDate=[...hp,...ap,...h2h].reduce((m,r)=>r.matchDate>m?r.matchDate:m,'');
  if(!maxDate||maxDate>=target.matchDate)throw new Error('STRICT_PRIOR_VIOLATION');
  if(maxEvidenceDate===null||maxDate>maxEvidenceDate)maxEvidenceDate=maxDate;
  const p:any=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,language:'en',homePayload:hp,awayPayload:ap,h2hPayload:h2h});
  const e=p?.scoreline?.expectedGoals;
  if(!e||![e.htHome,e.htAway,e.ftHome,e.ftAway].every((v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0)){skipped++;continue;}
  const mm:any=buildMultiMarketV1({htHome:e.htHome,htAway:e.htAway,ftHome:e.ftHome,ftAway:e.ftAway});
  if(mm.consistencyGuard.status!=='PASS'){skipped++;continue;}
  let used=false;
  for(const part of ['ht','ft'] as const){
   const score=target[part];if(!score)continue;const diff=score.home-score.away;
   for(const line of QUARTER_AH_LINES){
    const key=String(line),dist=mm.asianHandicap[part][key];
    buckets[part][key].home.push({p:asQuarter(dist.home),y:quarterStateFromDifference(diff,line)});
    buckets[part][key].away.push({p:asQuarter(dist.away),y:quarterStateFromDifference(-diff,-line)});
   }
   used=true;
  }
  if(used)evaluated++;else skipped++;
 }
 const metrics=(part:'ht'|'ft')=>Object.fromEntries(QUARTER_AH_LINES.map(line=>{const k=String(line);return[k,{home:quarterMetrics(buckets[part][k].home),away:quarterMetrics(buckets[part][k].away)}];}));
 return{
  version:'CFI_MULTI_MARKET_QUARTER_AH_WALK_FORWARD_V1',status:'RESEARCH_ONLY',decisionUse:false,strictPrior:true,sameDateExcluded:true,leakage:false,
  minTeamPrior,historyCap:cap,evaluatedMatches:evaluated,skippedMatches:skipped,maxEvidenceDate,
  lines:[...QUARTER_AH_LINES],asianHandicap:{ht:metrics('ht'),ft:metrics('ft')},
  settlementStates:['FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS'],productionEligible:false,
 };
}
