import { buildMultiMarketFromScoreGrids } from './multi-market-v1.ts';

export const CHAMPION_FUSION_VERSION='CFI_MULTI_MARKET_CHAMPION_FUSION_V1';
export const CHAMPION_FUSION_LINEAGE='CFI_FUSION_RESEARCH_V1.3_TOP1';
export const CHAMPION_FUSION_SCORELINE_CONTRACT='TOP1_HT_PLUS_TOP1_FT';

type GridInput={score:string;probability:number;total?:number;home?:number;away?:number};
type Cell={score:string;home:number;away:number;total:number;probability:number};
type PeriodExperts={incumbent:GridInput[];futureSix:GridInput[];historical:GridInput[];recent?:GridInput[];directional?:GridInput[]};
type Context={evidenceCount:number;h2hCount:number;volatility?:number;extremeScorePressure?:number;dominance?:number;goalTempo?:number;recentAcceleration?:number};

const EPS=1e-12;
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const round=(x:number,d=12)=>{const p=10**d;return Math.round(x*p)/p;};
function parseScore(score:string){const m=String(score).match(/^(\d+)-(\d+)$/);if(!m)throw new Error('INVALID_FUSION_SCORE');return{home:Number(m[1]),away:Number(m[2])};}
function normalize(rows:GridInput[]):Cell[]{
  if(!Array.isArray(rows)||!rows.length)throw new Error('FUSION_SCORE_GRID_REQUIRED');
  let z=0;const out=rows.map(r=>{const p=Number(r.probability);if(!Number.isFinite(p)||p<0)throw new Error('INVALID_FUSION_PROBABILITY');const s=parseScore(r.score),x={score:r.score,home:s.home,away:s.away,total:s.home+s.away,probability:p};z+=p;return x;});
  if(!(z>0))throw new Error('ZERO_FUSION_MASS');
  return out.map(r=>({...r,probability:r.probability/z}));
}
function asMap(rows:Cell[]){return new Map(rows.map(r=>[r.score,r.probability]));}
function support(...grids:Cell[][]){return [...new Set(grids.flatMap(g=>g.map(r=>r.score)))].sort((a,b)=>{const x=parseScore(a),y=parseScore(b);return x.total-y.total||x.home-y.home||x.away-y.away;});}
function totalVariation(a:Cell[],b:Cell[]){const ma=asMap(a),mb=asMap(b),keys=new Set([...ma.keys(),...mb.keys()]);let s=0;for(const k of keys)s+=Math.abs((ma.get(k)??0)-(mb.get(k)??0));return .5*s;}
function entropy(g:Cell[]){let h=0;for(const r of g)if(r.probability>0)h-=r.probability*Math.log(r.probability);return h;}
function normalizedEntropy(g:Cell[]){return g.length>1?entropy(g)/Math.log(g.length):0;}
function mean(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function pairwise(grids:Record<string,Cell[]>){const names=Object.keys(grids),out:Record<string,number>={};for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++)out[`${names[i]}__${names[j]}`]=totalVariation(grids[names[i]],grids[names[j]]);return out;}
function weightVector(period:'ht'|'ft',context:Context,disagreement:number,hasRecent:boolean,hasDirectional:boolean){
  const coverage=clamp(Number(context.evidenceCount||0)/40),h2h=clamp(Number(context.h2hCount||0)/6),vol=clamp(Number(context.volatility??0)),tail=clamp(Number(context.extremeScorePressure??0)),tempo=clamp(Number(context.goalTempo??0)),dom=clamp(Math.abs(Number(context.dominance??0))),accel=clamp(Math.abs(Number(context.recentAcceleration??0))/1.5);
  const raw:Record<string,number>={
    INCUMBENT_FINAL:.34+.12*(1-disagreement)+.06*(1-coverage),
    HISTORICAL:.20+.15*coverage+.05*h2h-.05*vol,
    FUTURE_SIX:.24+(period==='ft'?.14:.09)*vol+(period==='ft'?.13:.08)*tail+.05*tempo+.03*dom,
  };
  if(hasRecent)raw.RECENT_FORM=.12+.10*accel+.05*(1-coverage);
  if(hasDirectional)raw.DIRECTIONAL_RECONCILIATION=.10+.08*dom+.04*tempo;
  if(disagreement>.28){raw.INCUMBENT_FINAL+=.04;raw.HISTORICAL+=.02;if(raw.RECENT_FORM)raw.RECENT_FORM-=.02;if(raw.DIRECTIONAL_RECONCILIATION)raw.DIRECTIONAL_RECONCILIATION-=.02;}
  const z=Object.values(raw).reduce((a,b)=>a+Math.max(.04,b),0);
  return Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,round(Math.max(.04,v)/z)]));
}
function pool(experts:Record<string,Cell[]>,weights:Record<string,number>,temperature:number){
  const grids=Object.values(experts),keys=support(...grids),maps=Object.fromEntries(Object.entries(experts).map(([k,g])=>[k,asMap(g)]));
  const logits=keys.map(score=>{let x=0;for(const [name,w] of Object.entries(weights))x+=w*Math.log(Math.max(EPS,maps[name]?.get(score)??EPS));return{x:Math.exp(x/Math.max(1,temperature)),score};});
  const z=logits.reduce((s,r)=>s+r.x,0)||1;
  return logits.map(r=>{const s=parseScore(r.score);return{score:r.score,home:s.home,away:s.away,total:s.home+s.away,probability:r.x/z};});
}
function top1(g:Cell[]){const r=[...g].sort((a,b)=>b.probability-a.probability||a.total-b.total||a.score.localeCompare(b.score))[0];return r?{score:r.score,probability:round(r.probability)}:null;}
function mass(g:Cell[],f:(r:Cell)=>boolean){return round(g.filter(f).reduce((s,r)=>s+r.probability,0));}
function periodFusion(period:'ht'|'ft',input:PeriodExperts,context:Context){
  const experts:Record<string,Cell[]>={INCUMBENT_FINAL:normalize(input.incumbent),HISTORICAL:normalize(input.historical),FUTURE_SIX:normalize(input.futureSix)};
  if(input.recent?.length)experts.RECENT_FORM=normalize(input.recent);
  if(input.directional?.length)experts.DIRECTIONAL_RECONCILIATION=normalize(input.directional);
  const pair=pairwise(experts),disagreement=mean(Object.values(pair));
  const weights=weightVector(period,context,disagreement,Boolean(experts.RECENT_FORM),Boolean(experts.DIRECTIONAL_RECONCILIATION)),coverage=clamp(Number(context.evidenceCount||0)/40);
  const temperature=1+.18*(1-coverage)+.16*clamp(disagreement/.35);
  const grid=pool(experts,weights,temperature);
  return{grid,weights,disagreement:round(disagreement),pairwise:Object.fromEntries(Object.entries(pair).map(([k,v])=>[k,round(v)])),temperature:round(temperature,6),normalizedEntropy:round(normalizedEntropy(grid),6),expertFingerprints:Object.fromEntries(Object.entries(experts).map(([k,g])=>[k,gridFingerprint(g)]))};
}
function gridFingerprint(grid:Cell[]){let h=2166136261;for(const r of grid){const s=`${r.score}:${r.probability.toFixed(10)}`;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}}return(h>>>0).toString(16).padStart(8,'0');}
export function buildMultiMarketChampionFusion(args:{targetDate?:string|null;maxEvidenceDate?:string|null;ht:PeriodExperts;ft:PeriodExperts;context:Context}){
  const targetDate=String(args.targetDate??'').slice(0,10),maxEvidenceDate=String(args.maxEvidenceDate??'').slice(0,10);
  const strictPrior=/^\d{4}-\d{2}-\d{2}$/.test(targetDate)&&/^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)&&maxEvidenceDate<targetDate;
  const ht=periodFusion('ht',args.ht,args.context),ft=periodFusion('ft',args.ft,args.context);
  const multiMarket:any=buildMultiMarketFromScoreGrids({ht:ht.grid,ft:ft.grid});
  multiMarket.model={family:'CFI_CHAMPION_FUSION_SCORE_GRID_V1',source:'CONTEXT_GATED_MULTI_EXPERT_DISTRIBUTION_FUSION',singleCore:true,experts:Object.keys(ht.weights)};
  const thresholds={'3+ HT':mass(ht.grid,r=>r.total>=3),'7+ FT':mass(ft.grid,r=>r.total>=7),'Other HT':mass(ht.grid,r=>r.home>=4||r.away>=4),'Other FT':mass(ft.grid,r=>r.home>=5||r.away>=5)};
  const top1HT=top1(ht.grid),top1FT=top1(ft.grid);
  const champion:any={...thresholds,'Top-1 HT':top1HT,'Top-1 FT':top1FT,thresholds,top1HT,top1FT,scorelineContract:CHAMPION_FUSION_SCORELINE_CONTRACT};
  const coverage=clamp(Number(args.context.evidenceCount||0)/40),avgDisagreement=(ht.disagreement+ft.disagreement)/2;
  const reasons:string[]=[];
  if(!strictPrior)reasons.push('STRICT_PRIOR_PROVENANCE_REQUIRED');
  if(Number(args.context.evidenceCount||0)<12)reasons.push('THIN_EVIDENCE');
  if(avgDisagreement>.30)reasons.push('HIGH_EXPERT_DISAGREEMENT');
  if(multiMarket.consistencyGuard.status!=='PASS')reasons.push('CROSS_MARKET_COHERENCE_FAIL');
  const severe=reasons.includes('STRICT_PRIOR_PROVENANCE_REQUIRED')||reasons.includes('CROSS_MARKET_COHERENCE_FAIL');
  const confidence=round(clamp(.18+.54*coverage+.20*(1-clamp(avgDisagreement/.40))+.08*(1-(ht.normalizedEntropy+ft.normalizedEntropy)/2)),6),level=confidence>=.72?'HIGH':confidence>=.52?'MEDIUM':'LOW';
  return{
    version:CHAMPION_FUSION_VERSION,lineage:CHAMPION_FUSION_LINEAGE,scorelineContract:CHAMPION_FUSION_SCORELINE_CONTRACT,status:severe?'SHADOW_BLOCKED':'SHADOW_READY',researchOnly:true,decisionUse:false,productionEligible:false,promotionRequired:true,championMutation:false,
    architecture:'MULTI_EXPERT -> CONTEXT_GATE -> TEMPERED_DISTRIBUTION_FUSION -> SINGLE_MULTI_MARKET_CORE',
    activeExperts:Object.keys(ht.weights),
    candidateExperts:{F10P:'HISTORICAL_V2_INCOMPLETE',F5:'HISTORICAL_V2_INCOMPLETE',K048:'JOINT_TRAJECTORY_SHADOW_SEPARATE',K034:'REAL_MARKET_SNAPSHOT_SPECIALIST',NEGATIVE_BINOMIAL:'EMBEDDED_IN_FUTURE_SIX_TAIL'},
    gating:{mode:'CONTEXT_ADAPTIVE_DISTRIBUTION_WEIGHTS',ht:{weights:ht.weights,disagreement:ht.disagreement,pairwise:ht.pairwise,temperature:ht.temperature,entropy:ht.normalizedEntropy,fingerprints:ht.expertFingerprints},ft:{weights:ft.weights,disagreement:ft.disagreement,pairwise:ft.pairwise,temperature:ft.temperature,entropy:ft.normalizedEntropy,fingerprints:ft.expertFingerprints},context:{...args.context,coverage:round(coverage)}},
    fusion:{method:'TEMPERED_LOG_OPINION_POOL',singleLatentDistribution:true,deriveAllMarketsFromFusedDistribution:true},
    uncertainty:{level,confidence,abstain:reasons.length>0,reasons},coherence:{status:multiMarket.consistencyGuard.status,guard:multiMarket.consistencyGuard},
    strictPrior:{verified:strictPrior,targetDate:targetDate||null,maxEvidenceDate:maxEvidenceDate||null},champion,multiMarket,
    audit:{noOutcomeKnowledge:true,noMarketOddsRequired:true,immutableShadowRequired:true,incumbentUnmodified:true,coherenceStatus:multiMarket.consistencyGuard.status,scorelineContract:CHAMPION_FUSION_SCORELINE_CONTRACT},
  };
}
