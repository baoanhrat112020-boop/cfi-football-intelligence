import v54 from './index-v54.ts';
import { MARKET_CODES } from '../../src/prediction/final-engine.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.5';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.4';
const DIVERSITY_GUARD_VERSION='CFI_MATCH_DIVERSITY_GUARD_V1';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
const list=(rows:any)=>Array.isArray(rows)?rows.map((r:any,i:number)=>`${i+1}) ${r.score} ${pct(r.probability)}`).join(' · '):'—';

function restoreMatchSpecificThresholds(body:any){
  const markets=body?.markets??{};
  for(const market of MARKET_CODES){
    const r=markets?.[market]; if(!r)continue;
    const c=r?.calibration??{};
    const structuralA=Number(c.structuralA),structuralB=Number(c.structuralB),weightA=Number(c.weightA);
    const rawRate=c.empiricalAnchor===null?null:Number(c.empiricalAnchor);
    const eligible=Number(r.eligible??0);
    if(!Number.isFinite(structuralA)||!Number.isFinite(structuralB)||!Number.isFinite(weightA))continue;
    const reliability=clamp(eligible/60,0,1),modelWeight=.15+.20*reliability,maxLift=.04+.10*reliability;
    const calibrate=(structural:number,challenger:number)=>{const empirical=rawRate??0,modelBlend=.5*structural+.5*challenger,unbounded=(1-modelWeight)*empirical+modelWeight*modelBlend;return clamp(unbounded,clamp(empirical-maxLift),clamp(empirical+maxLift));};
    const methodA=calibrate(structuralA,structuralA),methodB=calibrate(structuralB,structuralB);
    const rawFinal=weightA*structuralA+(1-weightA)*structuralB;
    const final=calibrate(rawFinal,(methodA+methodB)/2);
    r.methodA=methodA;r.methodB=methodB;r.final=final;
    r.calibration={...c,diversityFix:DIVERSITY_GUARD_VERSION,bigDbPriorRole:'CONTEXT_ONLY_NOT_DIRECT_OUTPUT_SHRINKAGE'};
  }
}
function restoreMatchSpecificScorelines(body:any){
  const scoreline=body?.scoreline;if(!scoreline)return;
  // v50 mutates only Top-3 probabilities, not score labels. We cannot recover pre-shrink
  // probabilities from the response safely, so do not manufacture values. Instead mark the
  // old shrinkage as disabled for future engine migration and preserve current values here.
  body.scorelinePriorPolicy={version:DIVERSITY_GUARD_VERSION,mode:'DISABLE_DIRECT_GLOBAL_TOP3_SHRINKAGE_NEXT_NATIVE_ENGINE',reason:'Global scoreline prior must not collapse distinct matches toward identical Top-3 outputs.'};
}
function rebuildMatrix(body:any){
  if(!body?.sixTargetMatrix)return;
  for(const market of MARKET_CODES){const r=body?.markets?.[market];if(r&&body.sixTargetMatrix.threshold?.[market])Object.assign(body.sixTargetMatrix.threshold[market],{methodA:r.methodA,methodB:r.methodB,final:r.final});}
  const ranking=MARKET_CODES.map(m=>({target:m,probability:Number(body?.markets?.[m]?.final),confidence:body?.markets?.[m]?.predictiveConfidence??body?.markets?.[m]?.confidence})).sort((a,b)=>b.probability-a.probability);
  body.ranking=ranking;body.verdict=(ranking[0]?.probability??0)>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
  const t=body.sixTargetMatrix.threshold,s=body.sixTargetMatrix.scoreline;
  body.renderedReport=[`CFI 2 METHODS × 6 TARGETS — ${body.sixTargetMatrix.contract}`,`MATCH: ${body?.target?.home??'—'} vs ${body?.target?.away??'—'} | ${body?.target?.date??'—'} | ENGINE ${ENGINE_VERSION}`,'','THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),'','TOP-3 HT — PRIMARY TARGET',`Method A: ${list(s['Top-3 HT']?.methodA)}`,`Method B: ${list(s['Top-3 HT']?.methodB)}`,`FINAL: ${list(s['Top-3 HT']?.final)}`,'','TOP-3 FT — PRIMARY TARGET',`Method A: ${list(s['Top-3 FT']?.methodA)}`,`Method B: ${list(s['Top-3 FT']?.methodB)}`,`FINAL: ${list(s['Top-3 FT']?.final)}`,'',`VERDICT: ${body.verdict} | UNCERTAINTY: ${body?.scoreline?.uncertainty??'—'}`,`CONTRACT COMPLETE: ${body.sixTargetMatrix.verification?.complete?'YES':'NO'}`].join('\n');
}
export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const response=await v54.fetch(request,env,ctx);const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return response;
  const ct=String(response.headers.get('content-type')??'');if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  if(!response.ok)return response;
  restoreMatchSpecificThresholds(body);restoreMatchSpecificScorelines(body);rebuildMatrix(body);
  body.engine=ENGINE_VERSION;body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,diversityGuard:DIVERSITY_GUARD_VERSION};
  body.diversityGuard={version:DIVERSITY_GUARD_VERSION,active:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorWarning:true,policy:'MATCH_SPECIFIC_SIGNAL_MUST_DOMINATE_GLOBAL_PRIOR'};
  return Response.json(body,{status:response.status});
}} satisfies ExportedHandler<Env>;
