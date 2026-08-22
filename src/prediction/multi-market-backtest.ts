import { buildPrediction, type CanonicalFixture } from './final-engine.ts';
import { buildMultiMarketV1 } from './multi-market-v1.ts';

export const HALF_OU_HT=[0.5,1.5,2.5,3.5,4.5] as const;
export const HALF_OU_FT=[1.5,2.5,3.5,4.5,5.5,6.5,7.5] as const;
export const HALF_AH=[-1.5,-0.5,0.5,1.5] as const;

type Outcome1x2='home'|'draw'|'away';
export type MultiMarketReplayPoint={
  fixtureId:string;
  targetDate:string;
  maxEvidenceDate:string;
  homePriorCount:number;
  awayPriorCount:number;
  oneXTwo:{ht:{p:{home:number;draw:number;away:number};y:Outcome1x2}|null;ft:{p:{home:number;draw:number;away:number};y:Outcome1x2}|null};
  overUnder:{ht:Record<string,{p:number;y:0|1}>;ft:Record<string,{p:number;y:0|1}>};
  asianHandicap:{ht:Record<string,{home:{p:number;y:0|1};away:{p:number;y:0|1}}>;ft:Record<string,{home:{p:number;y:0|1};away:{p:number;y:0|1}}>};
};

function outcome1x2(home:number,away:number):Outcome1x2{return home>away?'home':home<away?'away':'draw';}
function multiclassBrier(p:{home:number;draw:number;away:number},actual:Outcome1x2){
  return ((p.home-(actual==='home'?1:0))**2+(p.draw-(actual==='draw'?1:0))**2+(p.away-(actual==='away'?1:0))**2)/3;
}
const brier=(p:number,y:number)=>(p-y)**2;
const teamKey=(s:string)=>s.trim().toLowerCase();
function involves(f:CanonicalFixture,team:string){const k=teamKey(team);return teamKey(f.homeTeam)===k||teamKey(f.awayTeam)===k;}
function pairMatch(f:CanonicalFixture,home:string,away:string){const h=teamKey(home),a=teamKey(away),fh=teamKey(f.homeTeam),fa=teamKey(f.awayTeam);return (fh===h&&fa===a)||(fh===a&&fa===h);}
function dedupeAndSort(fixtures:CanonicalFixture[]){
  return [...new Map(fixtures.map(r=>[`${r.matchDate}|${teamKey(r.homeTeam)}|${teamKey(r.awayTeam)}`,r])).values()]
    .sort((a,b)=>a.matchDate.localeCompare(b.matchDate)||a.id.localeCompare(b.id));
}

export function buildMultiMarketReplayPoints(fixtures:CanonicalFixture[],minTeamPrior=8):MultiMarketReplayPoint[]{
  const sorted=dedupeAndSort(fixtures),points:MultiMarketReplayPoint[]=[];
  for(let i=0;i<sorted.length;i++){
    const target=sorted[i];
    const prior=sorted.slice(0,i).filter(r=>r.matchDate<target.matchDate);
    const homePrior=prior.filter(r=>involves(r,target.homeTeam));
    const awayPrior=prior.filter(r=>involves(r,target.awayTeam));
    if(homePrior.length<minTeamPrior||awayPrior.length<minTeamPrior)continue;
    const h2hPrior=prior.filter(r=>pairMatch(r,target.homeTeam,target.awayTeam));
    const maxEvidenceDate=[...homePrior,...awayPrior,...h2hPrior].reduce((m,r)=>r.matchDate>m?r.matchDate:m,'');
    if(!maxEvidenceDate||maxEvidenceDate>=target.matchDate)throw new Error('STRICT_PRIOR_VIOLATION');
    const p:any=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,language:'en',homePayload:homePrior,awayPayload:awayPrior,h2hPayload:h2hPrior});
    const e=p?.scoreline?.expectedGoals;
    if(!e||![e.htHome,e.htAway,e.ftHome,e.ftAway].every((v:any)=>Number.isFinite(Number(v))&&Number(v)>=0))continue;
    const mm:any=buildMultiMarketV1({htHome:Number(e.htHome),htAway:Number(e.htAway),ftHome:Number(e.ftHome),ftAway:Number(e.ftAway)});
    if(mm.consistencyGuard.status!=='PASS')continue;
    const point:MultiMarketReplayPoint={
      fixtureId:target.id,targetDate:target.matchDate,maxEvidenceDate,homePriorCount:homePrior.length,awayPriorCount:awayPrior.length,
      oneXTwo:{ht:null,ft:null},overUnder:{ht:{},ft:{}},asianHandicap:{ht:{},ft:{}},
    };
    if(target.ht){
      point.oneXTwo.ht={p:mm.oneXTwo.ht,y:outcome1x2(target.ht.home,target.ht.away)};
      const total=target.ht.home+target.ht.away;
      for(const line of HALF_OU_HT)point.overUnder.ht[String(line)]={p:mm.overUnder.ht[String(line)].over.fullWin,y:total>line?1:0};
      for(const line of HALF_AH){
        point.asianHandicap.ht[String(line)]={
          home:{p:mm.asianHandicap.ht[String(line)].home.fullWin,y:(target.ht.home-target.ht.away)+line>0?1:0},
          away:{p:mm.asianHandicap.ht[String(line)].away.fullWin,y:(target.ht.away-target.ht.home)-line>0?1:0},
        };
      }
    }
    if(target.ft){
      point.oneXTwo.ft={p:mm.oneXTwo.ft,y:outcome1x2(target.ft.home,target.ft.away)};
      const total=target.ft.home+target.ft.away;
      for(const line of HALF_OU_FT)point.overUnder.ft[String(line)]={p:mm.overUnder.ft[String(line)].over.fullWin,y:total>line?1:0};
      for(const line of HALF_AH){
        point.asianHandicap.ft[String(line)]={
          home:{p:mm.asianHandicap.ft[String(line)].home.fullWin,y:(target.ft.home-target.ft.away)+line>0?1:0},
          away:{p:mm.asianHandicap.ft[String(line)].away.fullWin,y:(target.ft.away-target.ft.home)-line>0?1:0},
        };
      }
    }
    if(point.oneXTwo.ht||point.oneXTwo.ft)points.push(point);
  }
  return points;
}

function emptyBinary(lines:readonly number[],sides:readonly string[]=['over']){
  return Object.fromEntries(lines.flatMap(line=>sides.map(side=>[`${line}:${side}`,{n:0,brier:0,positive:0}])));
}
function finalizeBinary(rows:Record<string,{n:number;brier:number;positive:number}>){
  return Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,{n:v.n,brier:v.n?v.brier/v.n:null,prevalence:v.n?v.positive/v.n:null}]));
}

export function walkForwardMultiMarketBacktest(fixtures:CanonicalFixture[],minTeamPrior=8){
  const points=buildMultiMarketReplayPoints(fixtures,minTeamPrior);
  const one={ht:{n:0,brier:0},ft:{n:0,brier:0}};
  const ouHt=emptyBinary(HALF_OU_HT),ouFt=emptyBinary(HALF_OU_FT);
  const ahHt=emptyBinary(HALF_AH,['home','away']),ahFt=emptyBinary(HALF_AH,['home','away']);
  for(const point of points){
    for(const part of ['ht','ft'] as const){
      const onePoint=point.oneXTwo[part];
      if(onePoint){one[part].n++;one[part].brier+=multiclassBrier(onePoint.p,onePoint.y);}
      const ou=part==='ht'?ouHt:ouFt;
      for(const [line,row] of Object.entries(point.overUnder[part])){const x=ou[`${line}:over`];x.n++;x.positive+=row.y;x.brier+=brier(row.p,row.y);}
      const ah=part==='ht'?ahHt:ahFt;
      for(const [line,row] of Object.entries(point.asianHandicap[part]))for(const side of ['home','away'] as const){const x=ah[`${line}:${side}`];x.n++;x.positive+=row[side].y;x.brier+=brier(row[side].p,row[side].y);}
    }
  }
  const totalTargets=dedupeAndSort(fixtures).length;
  return {
    version:'CFI_MULTI_MARKET_WALK_FORWARD_V2',status:'RESEARCH_ONLY',strictPrior:true,sameDateExcluded:true,leakage:false,decisionUse:false,
    minTeamPrior,evaluatedMatches:points.length,skippedMatches:Math.max(0,totalTargets-points.length),
    oneXTwo:{ht:{n:one.ht.n,brier:one.ht.n?one.ht.brier/one.ht.n:null},ft:{n:one.ft.n,brier:one.ft.n?one.ft.brier/one.ft.n:null}},
    overUnder:{ht:finalizeBinary(ouHt),ft:finalizeBinary(ouFt)},asianHandicap:{ht:finalizeBinary(ahHt),ft:finalizeBinary(ahFt)},
    scope:{overUnder:{ht:[...HALF_OU_HT],ft:[...HALF_OU_FT]},asianHandicap:[...HALF_AH],note:'Half-lines only in benchmark; quarter-line settlement remains shadow until a dedicated multi-outcome scoring contract is validated.'},
  };
}
