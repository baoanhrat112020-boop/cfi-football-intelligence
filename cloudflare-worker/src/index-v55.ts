import v54 from './index-v54.ts';
import { MARKET_CODES } from '../../src/prediction/final-engine.ts';
import { attachMultiMarketShadow } from '../../src/prediction/multi-market-integration.ts';
import { attachCfiOutputV2 } from '../../src/presentation/cfi-output-v2.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.5';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.4';
const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';
const DIVERSITY_GUARD_VERSION='CFI_MATCH_DIVERSITY_GUARD_V1';
const PRODUCTION_ENTRYPOINT='index-live-router.ts';
const PREMATCH_HANDLER='index-v55.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
const list=(rows:any)=>Array.isArray(rows)?rows.map((r:any,i:number)=>`${i+1}) ${r.score} ${pct(r.probability)}`).join(' · '):'—';

function preserveNativeScorelines(body:any){
  if(!body?.scoreline)return;
  body.scorelinePriorPolicy={version:DIVERSITY_GUARD_VERSION,mode:'NATIVE_MATCH_SPECIFIC_DISTRIBUTION_ONLY',reason:'Global scoreline statistics are context/provenance only and must not mutate Top-3 or threshold outputs.'};
}
function consistencyViolations(body:any){
  const violations:string[]=[];
  for(const market of MARKET_CODES){
    const r=body?.markets?.[market];
    if(!r)continue;
    const final=Number(r.final),scorelineMass=Number(r.scorelineMass);
    if(!Number.isFinite(final)||!Number.isFinite(scorelineMass)||final!==scorelineMass)violations.push(market);
    if(r?.consistency&&(r.consistency.status!=='PASS'||Number(r.consistency.finalDelta)!==0))violations.push(`${market}:consistency`);
  }
  return violations;
}
function rebuildMatrix(body:any){
  if(!body?.sixTargetMatrix)return;
  for(const market of MARKET_CODES){const r=body?.markets?.[market];if(r&&body.sixTargetMatrix.threshold?.[market])Object.assign(body.sixTargetMatrix.threshold[market],{methodA:r.methodA,methodB:r.methodB,final:r.final});}
  const ranking=MARKET_CODES.map(m=>({target:m,probability:Number(body?.markets?.[m]?.final),confidence:body?.markets?.[m]?.predictiveConfidence??body?.markets?.[m]?.confidence})).sort((a,b)=>b.probability-a.probability);
  body.ranking=ranking;body.verdict=(ranking[0]?.probability??0)>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
  const t=body.sixTargetMatrix.threshold,s=body.sixTargetMatrix.scoreline;
  body.renderedReport=[`CFI 2 METHODS × 6 TARGETS — ${body.sixTargetMatrix.contract}`,`MATCH: ${body?.target?.home??'—'} vs ${body?.target?.away??'—'} | ${body?.target?.date??'—'} | ENGINE ${ENGINE_VERSION}`,'','THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),'','TOP-3 HT — PRIMARY TARGET',`Method A: ${list(s['Top-3 HT']?.methodA)}`,`Method B: ${list(s['Top-3 HT']?.methodB)}`,`FINAL: ${list(s['Top-3 HT']?.final)}`,'','TOP-3 FT — PRIMARY TARGET',`Method A: ${list(s['Top-3 FT']?.methodA)}`,`Method B: ${list(s['Top-3 FT']?.methodB)}`,`FINAL: ${list(s['Top-3 FT']?.final)}`,'',`VERDICT: ${body.verdict} | UNCERTAINTY: ${body?.scoreline?.uncertainty??'—'}`,`CONTRACT COMPLETE: ${body.sixTargetMatrix.verification?.complete?'YES':'NO'}`].join('\n');
}
function normalizeReleaseTelemetry(body:any){
  body.engine=ENGINE_VERSION;
  body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,productionEntrypoint:PRODUCTION_ENTRYPOINT,prematchHandler:PREMATCH_HANDLER};
  body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIGDB_VERSION};
  body.release={...(body.release??{}),engine:ENGINE_VERSION,runtime:RUNTIME_VERSION,bigDbRetrieval:BIGDB_VERSION,productionEntrypoint:PRODUCTION_ENTRYPOINT,prematchHandler:PREMATCH_HANDLER};
  body.diversityGuard={version:DIVERSITY_GUARD_VERSION,active:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false,policy:'MATCH_SPECIFIC_SIGNAL_MUST_DOMINATE_GLOBAL_PRIOR'};
}
const nonNegativeCount=(v:any)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
function zeroEvidenceGuard(body:any){
  const exact=body?.bigDbRetrieval?.exactTeam;
  const input=body?.bigDbRetrieval?.predictionInput;
  const counts=body?.evidence?.counts;
  const home=nonNegativeCount(exact?.home?.retrieved)??nonNegativeCount(input?.homeFixtures)??nonNegativeCount(counts?.homeFixtures);
  const away=nonNegativeCount(exact?.away?.retrieved)??nonNegativeCount(input?.awayFixtures)??nonNegativeCount(counts?.awayFixtures);
  const h2h=nonNegativeCount(exact?.h2h?.retrieved)??nonNegativeCount(input?.h2hFixtures)??nonNegativeCount(counts?.h2hFixtures);
  const observed=home!==null||away!==null||h2h!==null;
  const blocked=observed&&((home??0)<=0||(away??0)<=0);
  return {blocked,home,away,h2h,reason:blocked?'ZERO_EXACT_TEAM_EVIDENCE':null};
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  let input:any={};try{input=await request.clone().json()}catch{}
  const response=await v54.fetch(request,env,ctx);const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return response;
  const ct=String(response.headers.get('content-type')??'');if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  normalizeReleaseTelemetry(body);
  if(response.ok){
    const z=zeroEvidenceGuard(body);
    if(z.blocked){
      body.status='INSUFFICIENT_DATA';body.error='ZERO_EXACT_TEAM_EVIDENCE';
      body.zeroEvidenceGuard={status:'FAIL_CLOSED',...z,globalPriorFallbackAllowed:false,normalPredictionRendered:false};
      body.runtime={...(body.runtime??{}),predictionPath:'EXACT_TEAM_EVIDENCE_FAIL_CLOSED',diversityGuard:DIVERSITY_GUARD_VERSION};
      delete body.renderedReport;delete body.presentationContract;delete body.sixTargetMatrix;delete body.markets;delete body.scoreline;delete body.ranking;delete body.verdict;
      return Response.json(body,{status:422});
    }
    preserveNativeScorelines(body);
    const violations=consistencyViolations(body);
    if(violations.length){
      body.status='CFI_CONSISTENCY_GATE_ERROR';body.error='SCORELINE_MARKET_INCONSISTENCY';
      body.consistencyGuard={status:'FAIL',violations};
      body.runtime={...(body.runtime??{}),predictionPath:'CONSISTENCY_FAIL_CLOSED',diversityGuard:DIVERSITY_GUARD_VERSION};
      return Response.json(body,{status:500});
    }
    body.consistencyGuard={status:'PASS',violations:[]};
    rebuildMatrix(body);
    attachMultiMarketShadow(body);
    attachCfiOutputV2(body,input?.odds??{});
    body.runtime={...(body.runtime??{}),predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2',diversityGuard:DIVERSITY_GUARD_VERSION};
    if(body?.status==='DATA_READY'){
      body.upstreamStatus='DATA_READY';
      body.status='SUCCESS';
    }
  } else if(body?.error==='TARGET_DATE_REQUIRED'||body?.status==='STRICT_PRIOR_GATE_ERROR') {
    body.runtime={...(body.runtime??{}),predictionPath:'STRICT_PRIOR_FAIL_CLOSED'};
  }
  return Response.json(body,{status:response.status});
}} satisfies ExportedHandler<Env>;
