import { buildFutureSixScorelines } from './future-six-scoreline.ts';
import { buildIndependentScoreGrid, buildMultiMarketFromScoreGrids } from './multi-market-v1.ts';
import { normalizeFixtures, type CanonicalFixture } from './final-engine.ts';

export const CHAMPION_FUSION_VERSION='CFI_MULTI_MARKET_CHAMPION_FUSION_V1';
export const CHAMPION_FUSION_STATUS='SHADOW_RESEARCH';

type GridRow={score:string;probability:number;total:number};
type ExpertName='HISTORICAL'|'RECENT_FORM'|'FUTURE_SIX'|'DIRECTIONAL_POISSON';
type ExpertGrid={name:ExpertName;grid:GridRow[];weight:number};

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const variance=(xs:number[])=>{if(xs.length<2)return null;const m=mean(xs)!;return xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1);};
const normalize=(rows:GridRow[])=>{const z=rows.reduce((s,r)=>s+r.probability,0)||1;return rows.map(r=>({...r,probability:r.probability/z}));};
const scoreParts=(score:string)=>{const m=score.match(/^(\d+)-(\d+)$/);return m?{home:Number(m[1]),away:Number(m[2])}:null;};
const fingerprint=(rows:GridRow[])=>{let h=2166136261;for(const r of rows){const s=`${r.score}:${r.probability.toFixed(10)}`;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}}return(h>>>0).toString(16).padStart(8,'0');};
const top3=(grid:GridRow[])=>[...grid].sort((a,b)=>b.probability-a.probability).slice(0,3).map(r=>({score:r.score,probability:r.probability}));
const eventMass=(grid:GridRow[],predicate:(h:number,a:number)=>boolean)=>grid.reduce((s,r)=>{const p=scoreParts(r.score);return s+(p&&predicate(p.home,p.away)?r.probability:0);},0);

function rawStrictPrior(payload:unknown,targetDate:string){
  const all=normalizeFixtures(payload);
  const prior=all.filter(r=>r.matchDate<targetDate);
  return{all,prior,excludedSameDate:all.filter(r=>r.matchDate===targetDate).length,excludedFuture:all.filter(r=>r.matchDate>targetDate).length};
}

function uniqueRows(groups:CanonicalFixture[]){
  return[...new Map(groups.map(r=>[`${r.matchDate}|${r.homeTeam.toLowerCase()}|${r.awayTeam.toLowerCase()}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
}

function teamRows(rows:CanonicalFixture[],team:string){const k=team.toLowerCase();return rows.filter(r=>r.homeTeam.toLowerCase()===k||r.awayTeam.toLowerCase()===k).sort((a,b)=>a.matchDate.localeCompare(b.matchDate));}
function teamGoals(rows:CanonicalFixture[],team:string,part:'ht'|'ft',forGoals=true){const k=team.toLowerCase();return teamRows(rows,team).flatMap(r=>{const p=r[part];if(!p)return[];const home=r.homeTeam.toLowerCase()===k;return[forGoals?(home?p.home:p.away):(home?p.away:p.home)];});}
function weightedMean(xs:number[],decay=.92){if(!xs.length)return null;let s=0,z=0;xs.forEach((x,i)=>{const w=Math.pow(decay,xs.length-1-i);s+=x*w;z+=w;});return s/z;}

function empiricalGrid(rows:CanonicalFixture[],part:'ht'|'ft',maxGoals:number,tailLimit?:number):GridRow[]{
  const usable=rows.filter(r=>r[part]);
  const source=tailLimit?usable.slice(-tailLimit):usable;
  const counts=new Map<string,number>();let z=0;
  source.forEach((r,i)=>{const p=r[part]!;const h=Math.min(maxGoals,p.home),a=Math.min(maxGoals,p.away),key=`${h}-${a}`,w=Math.pow(.94,source.length-1-i);counts.set(key,(counts.get(key)??0)+w);z+=w;});
  const alpha=.08,cells=(maxGoals+1)*(maxGoals+1),den=z+alpha*cells,grid:GridRow[]=[];
  for(let h=0;h<=maxGoals;h++)for(let a=0;a<=maxGoals;a++){const score=`${h}-${a}`;grid.push({score,total:h+a,probability:((counts.get(score)??0)+alpha)/den});}
  return normalize(grid);
}

function poissonDirectionalGrid(args:{home:string;away:string;homeRows:CanonicalFixture[];awayRows:CanonicalFixture[];part:'ht'|'ft';maxGoals:number}){
  const {home,away,homeRows,awayRows,part,maxGoals}=args;
  const fallback=part==='ht'?.68:1.35;
  const hf=weightedMean(teamGoals(homeRows,home,part,true))??fallback;
  const ha=weightedMean(teamGoals(homeRows,home,part,false))??fallback;
  const af=weightedMean(teamGoals(awayRows,away,part,true))??fallback;
  const aa=weightedMean(teamGoals(awayRows,away,part,false))??fallback;
  const homeLambda=clamp((hf+aa)/2,.05,part==='ht'?4.5:7.5),awayLambda=clamp((af+ha)/2,.05,part==='ht'?4.5:7.5);
  const grid=buildIndependentScoreGrid(homeLambda,awayLambda,maxGoals).map(r=>({score:`${r.home}-${r.away}`,total:r.total,probability:r.probability}));
  return{grid:normalize(grid),homeLambda,awayLambda};
}

function totalSeries(rows:CanonicalFixture[],part:'ht'|'ft'){return rows.flatMap(r=>r[part]?[r[part]!.home+r[part]!.away]:[]);}
function dispersion(rows:CanonicalFixture[],part:'ht'|'ft'){
  const xs=totalSeries(rows,part),m=mean(xs),v=variance(xs);
  return{sample:xs.length,mean:m,variance:v,ratio:m&&v!==null?v/m:null};
}

function pairwiseTv(grids:GridRow[][]){
  if(grids.length<2)return 0;
  let sum=0,n=0;
  for(let i=0;i<grids.length;i++)for(let j=i+1;j<grids.length;j++){
    const a=new Map(grids[i].map(r=>[r.score,r.probability])),b=new Map(grids[j].map(r=>[r.score,r.probability]));
    const keys=new Set([...a.keys(),...b.keys()]);let d=0;for(const k of keys)d+=Math.abs((a.get(k)??0)-(b.get(k)??0));sum+=d/2;n++;
  }
  return n?sum/n:0;
}

function contextWeights(args:{sample:number;dispersionRatio:number|null;recentAcceleration:number;directionStrength:number;disagreement:number}){
  let w:{[K in ExpertName]:number}={HISTORICAL:.26,RECENT_FORM:.22,FUTURE_SIX:.32,DIRECTIONAL_POISSON:.20};
  if(args.sample>=60){w.HISTORICAL+=.07;w.RECENT_FORM+=.02;w.FUTURE_SIX-=.04;w.DIRECTIONAL_POISSON-=.05;}
  else if(args.sample<24){w.HISTORICAL-=.08;w.FUTURE_SIX+=.06;w.DIRECTIONAL_POISSON+=.02;}
  if((args.dispersionRatio??1)>1.25){w.FUTURE_SIX+=.06;w.RECENT_FORM+=.04;w.DIRECTIONAL_POISSON-=.07;w.HISTORICAL-=.03;}
  if(Math.abs(args.recentAcceleration)>=.35){w.RECENT_FORM+=.07;w.HISTORICAL-=.03;w.DIRECTIONAL_POISSON-=.02;w.FUTURE_SIX-=.02;}
  if(args.directionStrength>=.35){w.DIRECTIONAL_POISSON+=.05;w.HISTORICAL-=.02;w.RECENT_FORM-=.01;w.FUTURE_SIX-=.02;}
  if(args.disagreement>=.28){w.FUTURE_SIX+=.03;w.HISTORICAL+=.02;w.RECENT_FORM-=.03;w.DIRECTIONAL_POISSON-=.02;}
  for(const k of Object.keys(w) as ExpertName[])w[k]=Math.max(.05,w[k]);
  const z=Object.values(w).reduce((a,b)=>a+b,0);for(const k of Object.keys(w) as ExpertName[])w[k]/=z;
  return w;
}

function fuse(experts:ExpertGrid[],maxGoals:number):GridRow[]{
  const maps=new Map(experts.map(e=>[e.name,new Map(e.grid.map(r=>[r.score,r.probability]))]));
  const out:GridRow[]=[];
  for(let h=0;h<=maxGoals;h++)for(let a=0;a<=maxGoals;a++){
    const score=`${h}-${a}`;let p=0;for(const e of experts)p+=(maps.get(e.name)?.get(score)??0)*e.weight;
    out.push({score,total:h+a,probability:p});
  }
  return normalize(out);
}

function periodFusion(args:{part:'ht'|'ft';home:string;away:string;homeRows:CanonicalFixture[];awayRows:CanonicalFixture[];unique:CanonicalFixture[];futureGrid:GridRow[]}){
  const maxGoals=args.part==='ht'?10:14;
  const historical=empiricalGrid(args.unique,args.part,maxGoals);
  const recent=empiricalGrid(args.unique,args.part,maxGoals,args.part==='ht'?24:30);
  const directional=poissonDirectionalGrid({home:args.home,away:args.away,homeRows:args.homeRows,awayRows:args.awayRows,part:args.part,maxGoals});
  const future=normalize(args.futureGrid.filter(r=>{const p=scoreParts(r.score);return p&&p.home<=maxGoals&&p.away<=maxGoals;}).map(r=>({score:r.score,total:r.total,probability:r.probability})));
  const before=[historical,recent,future,directional.grid];
  const disagreement=pairwiseTv(before);
  const d=dispersion(args.unique,args.part);
  const recentTotals=totalSeries(args.unique,args.part).slice(-8),priorTotals=totalSeries(args.unique,args.part).slice(-16,-8);
  const recentAcceleration=(mean(recentTotals)??0)-(mean(priorTotals)??mean(recentTotals)??0);
  const directionStrength=clamp(Math.abs(directional.homeLambda-directional.awayLambda)/(args.part==='ht'?2.2:3.5));
  const weights=contextWeights({sample:d.sample,dispersionRatio:d.ratio,recentAcceleration,directionStrength,disagreement});
  const experts:ExpertGrid[]=[
    {name:'HISTORICAL',grid:historical,weight:weights.HISTORICAL},
    {name:'RECENT_FORM',grid:recent,weight:weights.RECENT_FORM},
    {name:'FUTURE_SIX',grid:future,weight:weights.FUTURE_SIX},
    {name:'DIRECTIONAL_POISSON',grid:directional.grid,weight:weights.DIRECTIONAL_POISSON},
  ];
  const grid=fuse(experts,maxGoals);
  return{grid,weights,disagreement,dispersion:d,recentAcceleration,directionStrength,directional:{homeLambda:directional.homeLambda,awayLambda:directional.awayLambda},experts:Object.fromEntries(experts.map(e=>[e.name,{weight:e.weight,fingerprint:fingerprint(e.grid),top3:top3(e.grid)}]))};
}

function championProbabilities(ht:GridRow[],ft:GridRow[]){return{
  '3+ HT':eventMass(ht,(h,a)=>h+a>=3),
  '7+ FT':eventMass(ft,(h,a)=>h+a>=7),
  'Other HT':eventMass(ht,(h,a)=>h>=4||a>=4),
  'Other FT':eventMass(ft,(h,a)=>h>=5||a>=5),
};}

function mmDelta(a:any,b:any){
  const n=(x:any)=>Number.isFinite(Number(x))?Number(x):null;
  const delta=(x:any,y:any)=>{const a=n(x),b=n(y);return a===null||b===null?null:a-b;};
  return{
    oneXTwo:{ht:{home:delta(a?.oneXTwo?.ht?.home,b?.oneXTwo?.ht?.home),draw:delta(a?.oneXTwo?.ht?.draw,b?.oneXTwo?.ht?.draw),away:delta(a?.oneXTwo?.ht?.away,b?.oneXTwo?.ht?.away)},ft:{home:delta(a?.oneXTwo?.ft?.home,b?.oneXTwo?.ft?.home),draw:delta(a?.oneXTwo?.ft?.draw,b?.oneXTwo?.ft?.draw),away:delta(a?.oneXTwo?.ft?.away,b?.oneXTwo?.ft?.away)}},
    overUnder:{htOver2_5:delta(a?.overUnder?.ht?.['2.5']?.over?.fullWin,b?.overUnder?.ht?.['2.5']?.over?.fullWin),ftOver2_5:delta(a?.overUnder?.ft?.['2.5']?.over?.fullWin,b?.overUnder?.ft?.['2.5']?.over?.fullWin),ftOver6_5:delta(a?.overUnder?.ft?.['6.5']?.over?.fullWin,b?.overUnder?.ft?.['6.5']?.over?.fullWin)},
  };
}

export function buildChampionFusionV1(args:{home:string;away:string;targetDate:string;homePayload:unknown;awayPayload:unknown;h2hPayload:unknown;incumbentMultiMarket?:any}){
  const h=rawStrictPrior(args.homePayload,args.targetDate),a=rawStrictPrior(args.awayPayload,args.targetDate),x=rawStrictPrior(args.h2hPayload,args.targetDate);
  const homeRows=h.prior,awayRows=a.prior,h2hRows=x.prior,unique=uniqueRows([...homeRows,...awayRows,...h2hRows]);
  if(!unique.length)throw new Error('CHAMPION_FUSION_STRICT_PRIOR_EVIDENCE_REQUIRED');
  const maxEvidenceDate=unique.at(-1)!.matchDate;
  if(maxEvidenceDate>=args.targetDate)throw new Error('CHAMPION_FUSION_STRICT_PRIOR_FAILURE');
  const future=buildFutureSixScorelines({home:args.home,away:args.away,homeRows,awayRows});
  const ht=periodFusion({part:'ht',home:args.home,away:args.away,homeRows,awayRows,unique,futureGrid:future.ht});
  const ft=periodFusion({part:'ft',home:args.home,away:args.away,homeRows,awayRows,unique,futureGrid:future.ft});
  const multiMarket:any=buildMultiMarketFromScoreGrids({ht:ht.grid,ft:ft.grid});
  multiMarket.model={family:'CFI_CHAMPION_FUSION_SCORE_GRID_V1',source:'CONTEXT_GATED_MULTI_EXPERT_DISTRIBUTION_FUSION',singleCore:true,experts:['HISTORICAL','RECENT_FORM','FUTURE_SIX','DIRECTIONAL_POISSON']};
  const champion=championProbabilities(ht.grid,ft.grid);
  const uncertainty=Math.max(ht.disagreement,ft.disagreement)>=.32||unique.length<20?'HIGH':Math.max(ht.disagreement,ft.disagreement)>=.20?'MEDIUM':'LOW';
  return{
    version:CHAMPION_FUSION_VERSION,status:CHAMPION_FUSION_STATUS,decisionUse:false,researchOnly:true,productionEligible:false,promotionRequired:true,
    architecture:'MULTI_EXPERT -> CONTEXT_GATE -> DISTRIBUTION_FUSION -> SINGLE_JOINT_MARKET_CORE',
    champion:{thresholds:champion,top3HT:top3(ht.grid),top3FT:top3(ft.grid)},
    multiMarket,
    gating:{ht:{weights:ht.weights,disagreement:ht.disagreement,dispersion:ht.dispersion,recentAcceleration:ht.recentAcceleration,directionStrength:ht.directionStrength},ft:{weights:ft.weights,disagreement:ft.disagreement,dispersion:ft.dispersion,recentAcceleration:ft.recentAcceleration,directionStrength:ft.directionStrength}},
    experts:{ht:ht.experts,ft:ft.experts},
    distributionAudit:{ht:{fingerprint:fingerprint(ht.grid),mass:ht.grid.reduce((s,r)=>s+r.probability,0)},ft:{fingerprint:fingerprint(ft.grid),mass:ft.grid.reduce((s,r)=>s+r.probability,0)}},
    strictPrior:{verified:true,targetDate:args.targetDate,maxEvidenceDate,futureEvidenceCount:0,sameDateEvidenceCount:0,excludedFromInput:{future:h.excludedFuture+a.excludedFuture+x.excludedFuture,sameDate:h.excludedSameDate+a.excludedSameDate+x.excludedSameDate},rule:'fixtureDate < targetDate'},
    coherence:{status:multiMarket?.consistencyGuard?.status??'UNKNOWN',violations:multiMarket?.consistencyGuard?.violations??[]},
    uncertainty,
    incumbentDelta:args.incumbentMultiMarket?mmDelta(multiMarket,args.incumbentMultiMarket):null,
    promotionGate:{historicalFullContractRequired:true,prospectivePairedSettlementRequired:true,segmentRegressionRequired:true,decisionUseUntilPromoted:false},
  };
}
