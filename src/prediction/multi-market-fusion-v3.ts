import { buildMultiMarketFromScoreGrids } from './multi-market-v1.ts';
import { buildK048TrajectoryEnsemble, K048_VERSION } from '../../research/trajectory-joint-forecast.mjs';

export const MULTI_MARKET_FUSION_V3_VERSION = 'CFI_MULTI_MARKET_FUSION_V3';
export const MULTI_MARKET_FUSION_V3_STATUS = 'SHADOW_RESEARCH';
export const MULTI_MARKET_FUSION_V3_TRAJECTORY = 'CFI_HT_FT_TRAJECTORY_K048_V2';
export const MULTI_MARKET_FUSION_V3_RESEARCH_SYMBOL = Symbol.for('CFI_MULTI_MARKET_FUSION_V3_RESEARCH_V1');

export type ScoreGridInput = {
  score?: string;
  home?: number;
  away?: number;
  total?: number;
  probability: number;
};

export type FusionExpert = {
  name: string;
  grid: ScoreGridInput[];
  baseWeight?: number;
  reliability?: number;
  effectiveSampleSize?: number;
  source?: string;
};

export type BigDbFusionContext = {
  version?: string;
  temporalAudit?: {
    targetDate?: string | null;
    maxEvidenceDate?: string | null;
    futureEvidenceCount?: number | null;
    sameDateEvidenceCount?: number | null;
    verified?: boolean;
  } | null;
  globalScorelinePrior?: unknown;
  globalPrior?: {
    fixtureCount?: number;
    markets?: Record<string, { eligible?: number; hits?: number; rate?: number | null }>;
  } | null;
  exactTeam?: {
    home?: { retrieved?: number; bigDbOnly?: number; overlap?: number };
    away?: { retrieved?: number; bigDbOnly?: number; overlap?: number };
    h2h?: { retrieved?: number; bigDbOnly?: number; overlap?: number };
  } | null;
};

export type FusionV3Input = {
  targetDate: string;
  maxEvidenceDate: string;
  evidenceCount: number;
  h2hCount?: number;
  htExperts: FusionExpert[];
  ftExperts: FusionExpert[];
  bigDb?: BigDbFusionContext | null;
  maxTrajectoryFtProjectionTv?: number;
};

type Cell = {
  score: string;
  home: number;
  away: number;
  total: number;
  probability: number;
};

type JointPath = {
  ht: string;
  ft: string;
  htHome: number;
  htAway: number;
  ftHome: number;
  ftAway: number;
  probability: number;
};

const EPS = 1e-12;
const clamp = (x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const round = (x:number,d=12)=>{ const p=10**d; return Math.round(x*p)/p; };
const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(String(x??'').slice(0,10));

function parseScore(score:string){
  const m=String(score??'').match(/^(\d+)-(\d+)$/);
  if(!m) throw new Error('INVALID_SCORE');
  return {home:Number(m[1]),away:Number(m[2])};
}

function normalizeGrid(rows:ScoreGridInput[],label:string):Cell[]{
  if(!Array.isArray(rows)||!rows.length) throw new Error(`${label}_GRID_REQUIRED`);
  let z=0;
  const cells=rows.map((row,index)=>{
    let home=Number(row?.home),away=Number(row?.away);
    if((!Number.isInteger(home)||home<0||!Number.isInteger(away)||away<0)&&typeof row?.score==='string'){
      const parsed=parseScore(row.score); home=parsed.home; away=parsed.away;
    }
    const probability=Number(row?.probability);
    if(!Number.isInteger(home)||home<0||!Number.isInteger(away)||away<0||!Number.isFinite(probability)||probability<0){
      throw new Error(`${label}_GRID_INVALID_${index}`);
    }
    z+=probability;
    return {score:`${home}-${away}`,home,away,total:home+away,probability};
  });
  if(!(z>0)) throw new Error(`${label}_GRID_ZERO_MASS`);
  const byScore=new Map<string,Cell>();
  for(const row of cells){
    const prior=byScore.get(row.score);
    if(prior) prior.probability+=row.probability;
    else byScore.set(row.score,{...row});
  }
  const merged=[...byScore.values()];
  const total=merged.reduce((s,r)=>s+r.probability,0);
  return merged.map(r=>({...r,probability:r.probability/total}))
    .sort((a,b)=>a.total-b.total||a.home-b.home||a.away-b.away);
}

function gridMap(rows:Cell[]){ return new Map(rows.map(r=>[r.score,r.probability])); }
function support(grids:Cell[][]){
  return [...new Set(grids.flatMap(g=>g.map(r=>r.score)))].sort((a,b)=>{
    const x=parseScore(a),y=parseScore(b);
    return x.home+x.away-y.home-y.away||x.home-y.home||x.away-y.away;
  });
}

function normalizeWeights(raw:Record<string,number>){
  const names=Object.keys(raw).sort();
  const z=names.reduce((s,k)=>s+Math.max(0,Number(raw[k])||0),0);
  if(!(z>0)) return Object.fromEntries(names.map(k=>[k,1/names.length]));
  return Object.fromEntries(names.map(k=>[k,Math.max(0,Number(raw[k])||0)/z]));
}

function roleDefaultWeight(name:string){
  const n=name.toUpperCase();
  if(/INCUMBENT|FINAL/.test(n)) return .34;
  if(/FUTURE[_ -]?SIX|STRUCTURAL/.test(n)) return .25;
  if(/HISTORICAL|EMPIRICAL/.test(n)) return .18;
  if(/RECENT|FORM/.test(n)) return .11;
  if(/BIG[_ -]?DB|BIGDT|GLOBAL_PRIOR/.test(n)) return .12;
  if(/DIRECTIONAL|RECONCILIATION/.test(n)) return .10;
  return .10;
}

function sampleFactor(n:unknown){
  const x=Math.max(0,Number(n)||0);
  if(!x) return .72;
  return .65+.35*(1-Math.exp(-x/60));
}

function arithmeticCentroid(experts:Record<string,Cell[]>,weights:Record<string,number>){
  const keys=support(Object.values(experts));
  const maps=Object.fromEntries(Object.entries(experts).map(([k,g])=>[k,gridMap(g)]));
  const out:Cell[]=[];
  for(const score of keys){
    const s=parseScore(score);
    let p=0;
    for(const [name,w] of Object.entries(weights)) p+=w*(maps[name]?.get(score)??0);
    out.push({score,home:s.home,away:s.away,total:s.home+s.away,probability:p});
  }
  return normalizeGrid(out,'CENTROID');
}

function klTo(a:Cell[],b:Cell[]){
  const ma=gridMap(a),mb=gridMap(b),keys=new Set([...ma.keys(),...mb.keys()]);
  let s=0;
  for(const k of keys){
    const p=ma.get(k)??0,q=mb.get(k)??0;
    if(p>0) s+=p*Math.log(p/Math.max(EPS,q));
  }
  return s;
}

function jsDivergence(a:Cell[],b:Cell[]){
  const ma=gridMap(a),mb=gridMap(b),keys=[...new Set([...ma.keys(),...mb.keys()])];
  const mid:ScoreGridInput[]=keys.map(score=>{
    const s=parseScore(score);
    return {score,home:s.home,away:s.away,probability:.5*((ma.get(score)??0)+(mb.get(score)??0))};
  });
  const m=normalizeGrid(mid,'JS_MID');
  return .5*klTo(a,m)+.5*klTo(b,m);
}

function totalVariation(a:Cell[],b:Cell[]){
  const ma=gridMap(a),mb=gridMap(b),keys=new Set([...ma.keys(),...mb.keys()]);
  let s=0;
  for(const k of keys) s+=Math.abs((ma.get(k)??0)-(mb.get(k)??0));
  return .5*s;
}

function normalizedEntropy(grid:Cell[]){
  if(grid.length<=1) return 0;
  let h=0;
  for(const r of grid) if(r.probability>0) h-=r.probability*Math.log(r.probability);
  return h/Math.log(grid.length);
}

function logPool(experts:Record<string,Cell[]>,weights:Record<string,number>,temperature:number){
  const keys=support(Object.values(experts));
  const maps=Object.fromEntries(Object.entries(experts).map(([k,g])=>[k,gridMap(g)]));
  const logits=keys.map(score=>{
    let x=0;
    for(const [name,w] of Object.entries(weights)) x+=w*Math.log(Math.max(EPS,maps[name]?.get(score)??EPS));
    return {score,value:Math.exp(x/Math.max(1,temperature))};
  });
  const z=logits.reduce((s,r)=>s+r.value,0)||1;
  return logits.map(r=>{
    const s=parseScore(r.score);
    return {score:r.score,home:s.home,away:s.away,total:s.home+s.away,probability:r.value/z};
  });
}

function withIncumbentFloor(weights:Record<string,number>,floor:number){
  const incumbent=Object.keys(weights).find(k=>/INCUMBENT|FINAL/i.test(k));
  if(!incumbent||weights[incumbent]>=floor) return weights;
  const remainingNames=Object.keys(weights).filter(k=>k!==incumbent);
  const z=remainingNames.reduce((s,k)=>s+weights[k],0)||1;
  const out:Record<string,number>={[incumbent]:floor};
  for(const k of remainingNames) out[k]=(1-floor)*(weights[k]/z);
  return normalizeWeights(out);
}

function fusePeriod(period:'HT'|'FT',input:FusionExpert[],evidenceCount:number){
  if(!Array.isArray(input)||input.length<2) throw new Error(`${period}_AT_LEAST_TWO_EXPERTS_REQUIRED`);
  const sorted=[...input].sort((a,b)=>a.name.localeCompare(b.name));
  const experts:Record<string,Cell[]>={};
  const initialRaw:Record<string,number>={};
  const metadata:Record<string,any>={};

  for(const expert of sorted){
    const name=String(expert.name||'').trim();
    if(!name||experts[name]) throw new Error(`${period}_EXPERT_NAME_INVALID_OR_DUPLICATE`);
    experts[name]=normalizeGrid(expert.grid,`${period}_${name}`);
    const reliability=clamp(Number(expert.reliability??.78),.20,1);
    const effectiveSampleSize=Math.max(0,Number(expert.effectiveSampleSize??0));
    const base=Math.max(.01,Number(expert.baseWeight??roleDefaultWeight(name)));
    initialRaw[name]=base*reliability*sampleFactor(effectiveSampleSize);
    metadata[name]={source:expert.source??null,baseWeight:base,reliability,effectiveSampleSize};
  }

  const initial=normalizeWeights(initialRaw);
  const centroid=arithmeticCentroid(experts,initial);
  const divergence=Object.fromEntries(Object.entries(experts).map(([name,grid])=>[name,jsDivergence(grid,centroid)]));
  const robustRaw:Record<string,number>={};
  for(const name of Object.keys(experts)){
    const penalty=Math.exp(-2.35*Math.max(0,divergence[name]));
    robustRaw[name]=initial[name]*penalty;
    metadata[name].divergenceFromCentroid=round(divergence[name],8);
    metadata[name].outlierPenalty=round(penalty,8);
  }

  const avgDivergence=Object.keys(divergence).reduce((s,k)=>s+initial[k]*divergence[k],0);
  const coverage=clamp(evidenceCount/60);
  let weights=normalizeWeights(robustRaw);
  if(evidenceCount<30||avgDivergence>.18) weights=withIncumbentFloor(weights,.28);
  const temperature=1+.16*(1-coverage)+.28*clamp(avgDivergence/.35);
  const grid=normalizeGrid(logPool(experts,weights,temperature),`${period}_FUSED`);

  return {
    grid,
    weights:Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,round(v)])),
    initialWeights:Object.fromEntries(Object.entries(initial).map(([k,v])=>[k,round(v)])),
    expertAudit:metadata,
    averageDivergence:round(avgDivergence,8),
    temperature:round(temperature,8),
    normalizedEntropy:round(normalizedEntropy(grid),8),
  };
}

function addCount(rows:ScoreGridInput[],score:string,weight:number){
  if(!Number.isFinite(weight)||weight<=0) return;
  const s=parseScore(score);
  rows.push({score,home:s.home,away:s.away,probability:weight});
}

export function normalizeBigDbScorelinePrior(payload:unknown){
  const ht:ScoreGridInput[]=[],ft:ScoreGridInput[]=[];
  if(!payload) return {ht,ft};

  const direct=payload as any;
  const directHt=direct?.ht??direct?.HT??direct?.halfTime??direct?.half_time;
  const directFt=direct?.ft??direct?.FT??direct?.fullTime??direct?.full_time;
  if(Array.isArray(directHt)){
    for(const r of directHt){
      const score=String(r?.score??r?.scoreline??(Number.isInteger(r?.home)&&Number.isInteger(r?.away)?`${r.home}-${r.away}`:''));
      const w=Number(r?.probability??r?.rate??r?.count??r?.n);
      if(score) addCount(ht,score,w);
    }
  }
  if(Array.isArray(directFt)){
    for(const r of directFt){
      const score=String(r?.score??r?.scoreline??(Number.isInteger(r?.home)&&Number.isInteger(r?.away)?`${r.home}-${r.away}`:''));
      const w=Number(r?.probability??r?.rate??r?.count??r?.n);
      if(score) addCount(ft,score,w);
    }
  }

  const rows=Array.isArray(payload)?payload:Array.isArray(direct?.rows)?direct.rows:Array.isArray(direct?.data)?direct.data:[];
  for(const r of rows){
    const period=String(r?.period??r?.phase??r?.scope??'').toUpperCase();
    const genericScore=String(r?.score??r?.scoreline??'');
    const genericWeight=Number(r?.probability??r?.rate??r?.count??r?.n);
    if(genericScore&&period.includes('HT')) addCount(ht,genericScore,genericWeight);
    if(genericScore&&period.includes('FT')) addCount(ft,genericScore,genericWeight);

    const htScore=String(r?.ht_score??r?.halftime_score??(Number.isInteger(r?.ht_home)&&Number.isInteger(r?.ht_away)?`${r.ht_home}-${r.ht_away}`:''));
    const ftScore=String(r?.ft_score??r?.fulltime_score??(Number.isInteger(r?.ft_home)&&Number.isInteger(r?.ft_away)?`${r.ft_home}-${r.ft_away}`:''));
    if(htScore) addCount(ht,htScore,Number(r?.ht_probability??r?.ht_rate??r?.ht_count??genericWeight));
    if(ftScore) addCount(ft,ftScore,Number(r?.ft_probability??r?.ft_rate??r?.ft_count??genericWeight));
  }

  const safe=(rows:ScoreGridInput[],label:string)=>{
    if(!rows.length) return [];
    try{return normalizeGrid(rows,label).map(({score,home,away,total,probability})=>({score,home,away,total,probability}));}
    catch{return [];}
  };
  return {ht:safe(ht,'BIGDB_HT'),ft:safe(ft,'BIGDB_FT')};
}

function strictPriorAudit(targetDate:string,maxEvidenceDate:string){
  const target=String(targetDate??'').slice(0,10),maxEvidence=String(maxEvidenceDate??'').slice(0,10);
  const verified=validDate(target)&&validDate(maxEvidence)&&maxEvidence<target;
  return {verified,targetDate:target||null,maxEvidenceDate:maxEvidence||null,rule:'maxEvidenceDate < targetDate'};
}

function bigDbAudit(bigDb:BigDbFusionContext|undefined|null,targetDate:string){
  if(!bigDb) return {usable:false,reasons:['BIGDB_NOT_SUPPLIED'],scorelinePrior:{ht:[],ft:[]},weight:0,effectiveSampleSize:0};
  const temporal=bigDb.temporalAudit??null;
  const target=String(targetDate??'').slice(0,10);
  const maxEvidence=String(temporal?.maxEvidenceDate??'').slice(0,10);
  const future=Number(temporal?.futureEvidenceCount);
  const same=Number(temporal?.sameDateEvidenceCount);
  const temporalVerified=temporal?.verified===true&&validDate(target)&&validDate(maxEvidence)&&maxEvidence<target&&future===0&&same===0;
  const scorelinePrior=normalizeBigDbScorelinePrior(bigDb.globalScorelinePrior);
  const reasons:string[]=[];
  if(!temporalVerified) reasons.push('BIGDB_STRICT_PRIOR_NOT_VERIFIED');
  if(!scorelinePrior.ht.length) reasons.push('BIGDB_HT_SCORELINE_PRIOR_UNAVAILABLE');
  if(!scorelinePrior.ft.length) reasons.push('BIGDB_FT_SCORELINE_PRIOR_UNAVAILABLE');

  const fixtureCount=Math.max(0,Number(bigDb.globalPrior?.fixtureCount??0));
  const exact=bigDb.exactTeam??{};
  const exactRows=Math.max(0,Number(exact.home?.retrieved??0))+Math.max(0,Number(exact.away?.retrieved??0))-Math.max(0,Number(exact.h2h?.retrieved??0));
  const coverageGlobal=1-Math.exp(-fixtureCount/5000);
  const coverageTeam=clamp(exactRows/80);
  const weight=clamp(.08+.10*coverageGlobal+.07*coverageTeam,.08,.25);
  const effectiveSampleSize=Math.max(fixtureCount,exactRows);
  return {usable:reasons.length===0,reasons,scorelinePrior,weight,effectiveSampleSize,fixtureCount,exactRows,temporalVerified};
}

function projectTrajectoryFallback(ht:Cell[],ft:Cell[],maxFtProjectionTv:number){
  const paths:JointPath[]=[];
  for(const h of ht){
    const allowed=ft.filter(f=>f.home>=h.home&&f.away>=h.away);
    const z=allowed.reduce((s,f)=>s+f.probability,0);
    if(z<=EPS&&h.probability>1e-10) throw new Error(`TRAJECTORY_SUPPORT_GAP_${h.score}`);
    for(const f of allowed){
      const probability=h.probability*(f.probability/Math.max(EPS,z));
      if(probability<=0) continue;
      paths.push({ht:h.score,ft:f.score,htHome:h.home,htAway:h.away,ftHome:f.home,ftAway:f.away,probability});
    }
  }
  const z=paths.reduce((s,r)=>s+r.probability,0)||1;
  for(const p of paths) p.probability/=z;

  const htMass=new Map<string,number>(),ftMass=new Map<string,number>();
  for(const p of paths){
    htMass.set(p.ht,(htMass.get(p.ht)??0)+p.probability);
    ftMass.set(p.ft,(ftMass.get(p.ft)??0)+p.probability);
  }
  const htProjected=normalizeGrid([...htMass.entries()].map(([score,probability])=>({score,probability})),'TRAJECTORY_HT');
  const ftProjected=normalizeGrid([...ftMass.entries()].map(([score,probability])=>({score,probability})),'TRAJECTORY_FT');
  const htTv=totalVariation(ht,htProjected),ftTv=totalVariation(ft,ftProjected);
  const invalidPathMass=paths.filter(p=>p.ftHome<p.htHome||p.ftAway<p.htAway).reduce((s,p)=>s+p.probability,0);
  const status=invalidPathMass<=1e-12&&ftTv<=maxFtProjectionTv?'PASS':'FAIL';
  const topPaths=[...paths].sort((a,b)=>b.probability-a.probability||a.ht.localeCompare(b.ht)||a.ft.localeCompare(b.ft)).slice(0,20)
    .map(p=>({...p,probability:round(p.probability)}));
  return {
    paths,
    ht:htProjected,
    ft:ftProjected,
    audit:{
      version:MULTI_MARKET_FUSION_V3_TRAJECTORY,
      status,
      pathCount:paths.length,
      probabilityMass:round(paths.reduce((s,p)=>s+p.probability,0)),
      invalidPathMass:round(invalidPathMass),
      htProjectionTotalVariation:round(htTv,8),
      ftProjectionTotalVariation:round(ftTv,8),
      maxFtProjectionTv,
      topPaths,
    }
  };
}


function projectTrajectory(ht:Cell[],ft:Cell[],maxFtProjectionTv:number,targetDate:string,maxEvidenceDate:string){
  try{
    const ensemble:any=buildK048TrajectoryEnsemble({
      targetDate:String(targetDate??'').slice(0,10),
      maxEvidenceDate:String(maxEvidenceDate??'').slice(0,10),
      htMarginal:ht.map(r=>({score:r.score,probability:r.probability})),
      ftMarginal:ft.map(r=>({score:r.score,probability:r.probability})),
      iterations:1400,
      tolerance:1e-9,
    });
    const paths:JointPath[]=ensemble.trajectories.map((row:any)=>{
      const h=parseScore(row.ht),f=parseScore(row.ft);
      return {ht:row.ht,ft:row.ft,htHome:h.home,htAway:h.away,ftHome:f.home,ftAway:f.away,probability:Number(row.probability)};
    });
    const invalidPathMass=paths.filter(p=>p.ftHome<p.htHome||p.ftAway<p.htAway).reduce((s,p)=>s+p.probability,0);
    const topPaths=[...paths].sort((a,b)=>b.probability-a.probability||a.ht.localeCompare(b.ht)||a.ft.localeCompare(b.ft)).slice(0,20)
      .map(p=>({...p,probability:round(p.probability)}));
    return{
      paths,
      ht,
      ft,
      audit:{
        version:MULTI_MARKET_FUSION_V3_TRAJECTORY,
        k048Version:K048_VERSION,
        status:invalidPathMass<=1e-12&&ensemble?.marginalAudit?.status==='PASS'?'PASS':'FAIL',
        method:'K048_IPF_MARGINAL_PRESERVING',
        pathCount:paths.length,
        probabilityMass:round(paths.reduce((s,p)=>s+p.probability,0)),
        invalidPathMass:round(invalidPathMass),
        htProjectionTotalVariation:0,
        ftProjectionTotalVariation:0,
        maxFtProjectionTv,
        marginalAudit:ensemble.marginalAudit,
        topPaths,
      },
    };
  }catch(error){
    const projected=projectTrajectoryFallback(ht,ft,maxFtProjectionTv);
    return{
      ...projected,
      audit:{
        ...projected.audit,
        version:MULTI_MARKET_FUSION_V3_TRAJECTORY,
        k048Version:K048_VERSION,
        status:'FAIL',
        method:'COHERENCE_FALLBACK_ONLY',
        k048Failure:error instanceof Error?error.message:String(error),
        promotionUseAllowed:false,
      },
    };
  }
}

function mass(grid:Cell[],predicate:(r:Cell)=>boolean){
  return round(grid.filter(predicate).reduce((s,r)=>s+r.probability,0));
}

function top1(grid:Cell[]){
  const r=[...grid].sort((a,b)=>b.probability-a.probability||a.total-b.total||a.score.localeCompare(b.score))[0];
  return r?{score:r.score,probability:round(r.probability)}:null;
}

function fingerprint(ht:Cell[],ft:Cell[],weightsHt:Record<string,number>,weightsFt:Record<string,number>){
  let h=2166136261;
  const text=[
    ...ht.map(r=>`H:${r.score}:${r.probability.toFixed(12)}`),
    ...ft.map(r=>`F:${r.score}:${r.probability.toFixed(12)}`),
    ...Object.entries(weightsHt).sort().map(([k,v])=>`WH:${k}:${v.toFixed(12)}`),
    ...Object.entries(weightsFt).sort().map(([k,v])=>`WF:${k}:${v.toFixed(12)}`),
  ].join('|');
  for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0).toString(16).padStart(8,'0');
}

export function getMultiMarketFusionV3ResearchState(result:any){
  return result?.[MULTI_MARKET_FUSION_V3_RESEARCH_SYMBOL]??null;
}

export function buildMultiMarketFusionV3(args:FusionV3Input){
  const strictPrior=strictPriorAudit(args.targetDate,args.maxEvidenceDate);
  const bigDb=bigDbAudit(args.bigDb,args.targetDate);
  const htExperts=[...args.htExperts],ftExperts=[...args.ftExperts];

  if(bigDb.usable){
    htExperts.push({
      name:'BIGDB_GLOBAL_PRIOR',
      grid:bigDb.scorelinePrior.ht,
      baseWeight:bigDb.weight,
      reliability:.88,
      effectiveSampleSize:bigDb.effectiveSampleSize,
      source:'cfi-bigdb-retrieval.globalScorelinePrior',
    });
    ftExperts.push({
      name:'BIGDB_GLOBAL_PRIOR',
      grid:bigDb.scorelinePrior.ft,
      baseWeight:bigDb.weight,
      reliability:.88,
      effectiveSampleSize:bigDb.effectiveSampleSize,
      source:'cfi-bigdb-retrieval.globalScorelinePrior',
    });
  }

  const ht=fusePeriod('HT',htExperts,Math.max(0,Number(args.evidenceCount)||0));
  const ft=fusePeriod('FT',ftExperts,Math.max(0,Number(args.evidenceCount)||0));
  const maxProjection=clamp(Number(args.maxTrajectoryFtProjectionTv??.10),.01,.50);
  const trajectory=projectTrajectory(ht.grid,ft.grid,maxProjection,args.targetDate,args.maxEvidenceDate);
  const multiMarket:any=buildMultiMarketFromScoreGrids({ht:trajectory.ht,ft:trajectory.ft});
  multiMarket.model={
    family:MULTI_MARKET_FUSION_V3_VERSION,
    source:'ROBUST_LOG_OPINION_POOL_PLUS_STRICT_PRIOR_BIGDB_PLUS_HT_FT_TRAJECTORY',
    singleCore:true,
    trajectoryVersion:MULTI_MARKET_FUSION_V3_TRAJECTORY,
  };

  const thresholds={
    '3+ HT':mass(trajectory.ht,r=>r.total>=3),
    '7+ FT':mass(trajectory.ft,r=>r.total>=7),
    'Other HT':mass(trajectory.ht,r=>r.home>=4||r.away>=4),
    'Other FT':mass(trajectory.ft,r=>r.home>=5||r.away>=5),
  };
  const equivalence={
    ht3PlusVsOver2_5:round(Math.abs(thresholds['3+ HT']-Number(multiMarket.derivedChecks?.htOver2_5??NaN)),12),
    ft7PlusVsOver6_5:round(Math.abs(thresholds['7+ FT']-Number(multiMarket.derivedChecks?.ftOver6_5??NaN)),12),
  };
  const equivalencePass=Number.isFinite(equivalence.ht3PlusVsOver2_5)&&Number.isFinite(equivalence.ft7PlusVsOver6_5)&&equivalence.ht3PlusVsOver2_5<=1e-10&&equivalence.ft7PlusVsOver6_5<=1e-10;
  const coherenceStatus=multiMarket.consistencyGuard?.status==='PASS'&&trajectory.audit.status==='PASS'&&equivalencePass?'PASS':'FAIL';
  const avgDisagreement=(ht.averageDivergence+ft.averageDivergence)/2;
  const coverage=clamp(Math.max(0,Number(args.evidenceCount)||0)/60);
  const trajectoryPenalty=clamp(trajectory.audit.ftProjectionTotalVariation/maxProjection);
  const confidence=round(clamp(.18+.44*coverage+.20*(1-clamp(avgDisagreement/.30))+.12*(1-trajectoryPenalty)+.06*(strictPrior.verified?1:0)),6);
  const confidenceLevel=confidence>=.74?'HIGH':confidence>=.54?'MEDIUM':'LOW';
  const status=strictPrior.verified&&coherenceStatus==='PASS'?'SHADOW_READY':'SHADOW_BLOCKED';

  const result:any={
    version:MULTI_MARKET_FUSION_V3_VERSION,
    status,
    mode:MULTI_MARKET_FUSION_V3_STATUS,
    researchOnly:true,
    decisionUse:false,
    productionEligible:false,
    promotionRequired:true,
    championMutation:false,
    strictPrior,
    bigDb:{
      version:args.bigDb?.version??null,
      used:bigDb.usable,
      reasons:bigDb.reasons,
      temporalVerified:bigDb.temporalVerified??false,
      fixtureCount:bigDb.fixtureCount??0,
      exactRows:bigDb.exactRows??0,
      expertWeight:bigDb.usable?round(bigDb.weight):0,
    },
    fusion:{
      ht:{weights:ht.weights,initialWeights:ht.initialWeights,averageDivergence:ht.averageDivergence,temperature:ht.temperature,normalizedEntropy:ht.normalizedEntropy,expertAudit:ht.expertAudit},
      ft:{weights:ft.weights,initialWeights:ft.initialWeights,averageDivergence:ft.averageDivergence,temperature:ft.temperature,normalizedEntropy:ft.normalizedEntropy,expertAudit:ft.expertAudit},
      fingerprint:fingerprint(trajectory.ht,trajectory.ft,ht.weights,ft.weights),
    },
    trajectory:trajectory.audit,
    multiMarket,
    fusionMarket:{
      thresholds,
      top1HT:top1(trajectory.ht),
      top1FT:top1(trajectory.ft),
      oneXTwo:multiMarket.oneXTwo,
      overUnder:multiMarket.overUnder,
      asianHandicap:multiMarket.asianHandicap,
      scorelineContract:'JOINT_HT_TO_FT_TRAJECTORY',
      rankingPolicy:'NO_CROSS_TYPE_RANKING_WITHOUT_MARKET_SPECIFIC_CALIBRATION',
    },
    coherence:{
      status:coherenceStatus,
      multiMarket:multiMarket.consistencyGuard,
      trajectory:trajectory.audit.status,
      thresholdEquivalence:equivalence,
      thresholdEquivalencePass:equivalencePass,
    },
    uncertainty:{
      confidence,
      level:confidenceLevel,
      evidenceCount:Math.max(0,Number(args.evidenceCount)||0),
      h2hCount:Math.max(0,Number(args.h2hCount)||0),
      averageExpertDivergence:round(avgDisagreement,8),
      ftProjectionTotalVariation:trajectory.audit.ftProjectionTotalVariation,
    },
  };

  Object.defineProperty(result,MULTI_MARKET_FUSION_V3_RESEARCH_SYMBOL,{
    value:Object.freeze({
      htGrid:Object.freeze(trajectory.ht.map(r=>Object.freeze({...r}))),
      ftGrid:Object.freeze(trajectory.ft.map(r=>Object.freeze({...r}))),
      jointPaths:Object.freeze(trajectory.paths.map(r=>Object.freeze({...r}))),
    }),
    enumerable:false,writable:false,configurable:false,
  });
  return result;
}
