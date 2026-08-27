import { buildMultiMarketFromScoreGrids } from './multi-market-v1.ts';

export const CHAMPION_FUSION_VERSION='CFI_MULTI_MARKET_CHAMPION_FUSION_V1';
export const CHAMPION_FUSION_LINEAGE='CFI_FUSION_RESEARCH_V1.2';

type GridInput={score:string;probability:number;total?:number;home?:number;away?:number};
type Cell={score:string;home:number;away:number;total:number;probability:number};
type PeriodExperts={incumbent:GridInput[];futureSix:GridInput[];historical:GridInput[]};
type Context={evidenceCount:number;h2hCount:number;volatility?:number;extremeScorePressure?:number;dominance?:number;goalTempo?:number};

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
function weightVector(period:'ht'|'ft',context:Context,disagreement:number){
  const coverage=clamp(Number(context.evidenceCount||0)/40),h2h=clamp(Number(context.h2hCount||0)/6),vol=clamp(Number(context.volatility??0)),tail=clamp(Number(context.extremeScorePressure??0)),tempo=clamp(Number(context.goalTempo??0)),dom=clamp(Math.abs(Number(context.dominance??0)));
  const futureBoost=(period==='ft'?.18:.10)*vol+(period==='ft'?.16:.10)*tail+.06*tempo+.04*dom;
  const historicalBoost=.18*coverage+.05*h2h-.08*vol;
  const incumbentBoost=.16*(1-disagreement)+.08*(1-coverage);
  const raw={INCUMBENT_FINAL:.44+incumbentBoost,FUTURE_SIX:.30+futureBoost,HISTORICAL_RECENCY:.26+historicalBoost};
  const z=Object.values(raw).reduce((a,b)=>a+Math.max(.05,b),0);
  return Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,round(Math.max(.05,v)/z)])) as Record<string,number>;
}
function pool(experts:Record<string,Cell[]>,weights:Record<string,number>,temperature:number){
  const grids=Object.values(experts),keys=support(...grids),maps=Object.fromEntries(Object.entries(experts).map(([k,g])=>[k,asMap(g)]));
  const logits=keys.map(score=>{let x=0;for(const [name,w] of Object.entries(weights))x+=w*Math.log(Math.max(EPS,maps[name]?.get(score)??EPS));return{x:Math.exp(x/Math.max(1,temperature)),score};});
  const z=logits.reduce((s,r)=>s+r.x,0)||1;
  return logits.map(r=>{const s=parseScore(r.score);return{score:r.score,home:s.home,away:s.away,total:s.home+s.away,probability:r.x/z};});
}
function top3(g:Cell[]){return [...g].sort((a,b)=>b.probability-a.probability||a.total-b.total||a.score.localeCompare(b.score)).slice(0,3).map(r=>({score:r.score,probability:round(r.probability)}));}
function mass(g:Cell[],f:(r:Cell)=>boolean){return round(g.filter(f).reduce((s,r)=>s+r.probability,0));}
function periodFusion(period:'ht'|'ft',input:PeriodExperts,context:Context){
  const incumbent=normalize(input.incumbent),futureSix=normalize(input.futureSix),historical=normalize(input.historical);
  const pairwise={incumbentFutureSix:totalVariation(incumbent,futureSix),incumbentHistorical:totalVariation(incumbent,historical),futureSixHistorical:totalVariation(futureSix,historical)};
  const disagreement=(pairwise.incumbentFutureSix+pairwise.incumbentHistorical+pairwise.futureSixHistorical)/3;
  const weights=weightVector(period,context,disagreement),coverage=clamp(Number(context.evidenceCount||0)/40);
  const temperature=1+.20*(1-coverage)+.18*clamp(disagreement/.35);
  const grid=pool({INCUMBENT_FINAL:incumbent,FUTURE_SIX:futureSix,HISTORICAL_RECENCY:historical},weights,temperature);
  return{grid,weights,disagreement:round(disagreement),pairwise:Object.fromEntries(Object.entries(pairwise).map(([k,v])=>[k,round(v)])),temperature:round(temperature,6),normalizedEntropy:round(normalizedEntropy(grid),6)};
}
export function buildMultiMarketChampionFusion(args:{targetDate?:string|null;maxEvidenceDate?:string|null;ht:PeriodExperts;ft:PeriodExperts;context:Context}){
  const targetDate=String(args.targetDate??'').slice(0,10),maxEvidenceDate=String(args.maxEvidenceDate??'').slice(0,10);
  const strictPrior=/^\d{4}-\d{2}-\d{2}$/.test(targetDate)&&/^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)&&maxEvidenceDate<targetDate;
  const ht=periodFusion('ht',args.ht,args.context),ft=periodFusion('ft',args.ft,args.context);
  const multiMarket=buildMultiMarketFromScoreGrids({ht:ht.grid,ft:ft.grid});
  const champion={
    '3+ HT':mass(ht.grid,r=>r.total>=3),
    '7+ FT':mass(ft.grid,r=>r.total>=7),
    'Other HT':mass(ht.grid,r=>r.home>=4||r.away>=4),
    'Other FT':mass(ft.grid,r=>r.home>=5||r.away>=5),
    'Top-3 HT':top3(ht.grid),
    'Top-3 FT':top3(ft.grid),
  };
  const coverage=clamp(Number(args.context.evidenceCount||0)/40),avgDisagreement=(ht.disagreement+ft.disagreement)/2;
  const reasons:string[]=[];
  if(!strictPrior)reasons.push('STRICT_PRIOR_PROVENANCE_REQUIRED');
  if(Number(args.context.evidenceCount||0)<12)reasons.push('THIN_EVIDENCE');
  if(avgDisagreement>.30)reasons.push('HIGH_EXPERT_DISAGREEMENT');
  if(multiMarket.consistencyGuard.status!=='PASS')reasons.push('CROSS_MARKET_COHERENCE_FAIL');
  const severe=reasons.includes('STRICT_PRIOR_PROVENANCE_REQUIRED')||reasons.includes('CROSS_MARKET_COHERENCE_FAIL');
  const confidence=round(clamp(.18+.54*coverage+.20*(1-clamp(avgDisagreement/.40))+.08*(1-(ht.normalizedEntropy+ft.normalizedEntropy)/2)),6);
  return{
    version:CHAMPION_FUSION_VERSION,
    lineage:CHAMPION_FUSION_LINEAGE,
    status:severe?'SHADOW_BLOCKED':'SHADOW_READY',
    researchOnly:true,decisionUse:false,productionEligible:false,promotionRequired:true,championMutation:false,
    activeExperts:['INCUMBENT_FINAL','FUTURE_SIX','HISTORICAL_RECENCY'],
    candidateExperts:{F10P:'HISTORICAL_V2_INCOMPLETE',F5:'HISTORICAL_V2_INCOMPLETE',K048:'JOINT_TRAJECTORY_SHADOW_SEPARATE',K034:'REAL_MARKET_SNAPSHOT_SPECIALIST',NEGATIVE_BINOMIAL:'EMBEDDED_IN_FUTURE_SIX_TAIL'},
    gating:{mode:'CONTEXT_ADAPTIVE_DISTRIBUTION_WEIGHTS',ht:ht.weights,ft:ft.weights,context:{...args.context,coverage:round(coverage)}},
    fusion:{method:'TEMPERED_LOG_OPINION_POOL',singleLatentDistribution:true,deriveAllMarketsFromFusedDistribution:true,ht:{disagreement:ht.disagreement,pairwise:ht.pairwise,temperature:ht.temperature,normalizedEntropy:ht.normalizedEntropy},ft:{disagreement:ft.disagreement,pairwise:ft.pairwise,temperature:ft.temperature,normalizedEntropy:ft.normalizedEntropy}},
    uncertainty:{confidence,abstain:reasons.length>0,reasons},
    strictPrior:{verified:strictPrior,targetDate:targetDate||null,maxEvidenceDate:maxEvidenceDate||null},
    champion,multiMarket,
    audit:{noOutcomeKnowledge:true,noMarketOddsRequired:true,immutableShadowRequired:true,incumbentUnmodified:true,coherenceStatus:multiMarket.consistencyGuard.status},
  };
}
