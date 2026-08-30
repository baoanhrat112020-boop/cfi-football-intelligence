import v54 from './index-v54.ts';
import { MARKET_CODES, PRIMARY_CONTRACT } from '../../src/prediction/final-engine.ts';
import { attachMultiMarketShadow } from '../../src/prediction/multi-market-integration.ts';
import { attachCfiOutputV2 } from '../../src/presentation/cfi-output-v2.ts';
import { attachCfiOutputV3 } from '../../src/presentation/cfi-output-v3.ts';
import { attachCfiBettingBoard } from '../../src/presentation/cfi-betting-board.ts';

const ENGINE_VERSION='CFI_FINAL_V5.3.0';
const RUNTIME_VERSION='CFI_PRIMARY_TOP1_RUNTIME_V2';
const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';
const DIVERSITY_GUARD_VERSION='CFI_MATCH_DIVERSITY_GUARD_V1';
const PRODUCTION_ENTRYPOINT='index-live-router.ts';
const PREMATCH_HANDLER='index-v55.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
const exact=(row:any)=>row&&typeof row==='object'&&row.score?`${row.score} ${pct(row.probability)}`:'—';

async function callControl(env:Env,action:string,payload:Record<string,unknown>={}){
  if(!env.CFI_DB_BASE_URL)return Response.json({status:'CONFIG_REQUIRED',message:'CFI_DB_BASE_URL missing'},{status:503});
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-gpt-control');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  const text=await res.text();let body:any=text;try{body=JSON.parse(text)}catch{}
  return Response.json(body,{status:res.status});
}
function queryPayload(url:URL){
  const rawLimit=url.searchParams.get('limit'),parsedLimit=rawLimit===null?undefined:Number(rawLimit);
  return{limit:Number.isFinite(parsedLimit)?Math.max(1,Math.min(100,Math.trunc(parsedLimit!))):undefined,target_date:url.searchParams.get('target_date')||undefined,home:url.searchParams.get('home')||undefined,away:url.searchParams.get('away')||undefined,settlement_status:url.searchParams.get('settlement_status')||undefined,selected_only:url.searchParams.get('selected_only')!=='false'};
}
function preserveNativeScorelines(body:any){
  if(!body?.scoreline)return;
  body.scorelinePriorPolicy={version:DIVERSITY_GUARD_VERSION,mode:'NATIVE_MATCH_SPECIFIC_DISTRIBUTION_ONLY',reason:'Global scoreline statistics are context/provenance only and must not mutate Top-1 primary exact-score outputs or threshold outputs.'};
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
function top1From(value:any){return Array.isArray(value)?value[0]??null:value??null;}
function fusionReportLines(body:any){
  const f=body?.championFusion;if(!f)return['CHAMPION FUSION V1: UNAVAILABLE'];
  const c=f?.champion?.thresholds??{},mm=f?.multiMarket,w=f?.gating?.ft?.weights??{};
  return[
    `CHAMPION FUSION V1: ${f.status??'—'} | decisionUse=${f.decisionUse===true?'true':'false'} | coherence=${f?.coherence?.status??mm?.consistencyGuard?.status??'—'} | uncertainty=${f?.uncertainty?.level??'—'} | confidence=${pct(f?.uncertainty?.confidence)} | abstain=${f?.uncertainty?.abstain===true?'YES':'NO'}`,
    `Fusion Champion: 3+ HT ${pct(c['3+ HT'])} | 7+ FT ${pct(c['7+ FT'])} | Other HT ${pct(c['Other HT'])} | Other FT ${pct(c['Other FT'])}`,
    `Fusion Top-1 HT: ${exact(top1From(f?.champion?.top3HT))}`,
    `Fusion Top-1 FT: ${exact(top1From(f?.champion?.top3FT))}`,
    `Fusion FT 1X2: H ${pct(mm?.oneXTwo?.ft?.home)} | X ${pct(mm?.oneXTwo?.ft?.draw)} | A ${pct(mm?.oneXTwo?.ft?.away)} | FT O2.5 ${pct(mm?.overUnder?.ft?.['2.5']?.over?.fullWin)} | FT O6.5 ${pct(mm?.overUnder?.ft?.['6.5']?.over?.fullWin)}`,
    `Fusion FT weights: INC ${pct(w.INCUMBENT_FINAL)} | HIST ${pct(w.HISTORICAL)} | FUTURE_SIX ${pct(w.FUTURE_SIX)} | RECENT ${pct(w.RECENT_FORM)} | DIR ${pct(w.DIRECTIONAL_RECONCILIATION)}`,
    'Fusion policy: SHADOW_RESEARCH only; paired prospective settlement + full Multi-Market promotion gate required.'
  ];
}
function rebuildPrimaryMatrix(body:any){
  const legacy=body?.sixTargetMatrix;
  const threshold:any={};
  for(const market of MARKET_CODES){
    const r=body?.markets?.[market]??legacy?.threshold?.[market]??{};
    threshold[market]={methodA:r.methodA??null,methodB:r.methodB??null,final:r.final??null,confidence:r.predictiveConfidence??r.confidence??legacy?.threshold?.[market]?.confidence??null};
  }
  const sourceTargets=body?.primaryTargets?.scorelineTargets??{};
  const ht=sourceTargets['Top-1 HT']??body?.scoreline?.primaryTop1?.ht??{};
  const ft=sourceTargets['Top-1 FT']??body?.scoreline?.primaryTop1?.ft??{};
  const normalizeExact=(x:any,part:'ht'|'ft')=>({
    methodA:top1From(x?.methodA??body?.scoreline?.[part]?.methodA),
    methodB:top1From(x?.methodB??body?.scoreline?.[part]?.methodB),
    final:top1From(x?.final??body?.scoreline?.[part]?.final),
  });
  const exactScore={'Top-1 HT':normalizeExact(ht,'ht'),'Top-1 FT':normalizeExact(ft,'ft')};
  const thresholdComplete=MARKET_CODES.every(m=>Number.isFinite(Number(threshold[m]?.final)));
  const scorelineComplete=Boolean(exactScore['Top-1 HT'].final?.score)&&Boolean(exactScore['Top-1 FT'].final?.score);
  const verification={thresholdComplete,scorelineComplete,complete:thresholdComplete&&scorelineComplete,thresholdCount:4,top1Count:2};
  body.sixTargetMatrix={contract:PRIMARY_CONTRACT,primary:true,targetCount:6,primaryTargets:[...MARKET_CODES,'Top-1 HT','Top-1 FT'],methods:['Method A','Method B','FINAL'],threshold,scoreline:exactScore,exactScore,verification};
  body.primaryTargetMatrix={contract:PRIMARY_CONTRACT,targetCount:6,threshold,exactScore,verification};
  body.presentationContract={...(body.presentationContract??{}),contract:PRIMARY_CONTRACT,targetCount:6,scorelineOutput:'TOP1_HT_PLUS_TOP1_FT',complete:verification.complete};
  body.primaryTargets={...(body.primaryTargets??{}),contract:PRIMARY_CONTRACT,count:6,codes:[...MARKET_CODES,'Top-1 HT','Top-1 FT'],scorelineTargets:exactScore};
  const ranking=MARKET_CODES.map(m=>({target:m,probability:Number(body?.markets?.[m]?.final),confidence:body?.markets?.[m]?.predictiveConfidence??body?.markets?.[m]?.confidence})).sort((a,b)=>b.probability-a.probability);
  body.ranking=ranking;body.verdict=(ranking[0]?.probability??0)>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
  body.renderedReport=[`CFI 4 THRESHOLDS + TOP-1 HT + TOP-1 FT — ${PRIMARY_CONTRACT}`,`MATCH: ${body?.target?.home??'—'} vs ${body?.target?.away??'—'} | ${body?.target?.date??'—'} | ENGINE ${ENGINE_VERSION}`,'','THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',...MARKET_CODES.map(m=>`${m}: A ${pct(threshold[m]?.methodA)} | B ${pct(threshold[m]?.methodB)} | FINAL ${pct(threshold[m]?.final)} | ${threshold[m]?.confidence??'—'}`),'','TOP-1 HT — PRIMARY TARGET',`Method A: ${exact(exactScore['Top-1 HT'].methodA)}`,`Method B: ${exact(exactScore['Top-1 HT'].methodB)}`,`FINAL: ${exact(exactScore['Top-1 HT'].final)}`,'','TOP-1 FT — PRIMARY TARGET',`Method A: ${exact(exactScore['Top-1 FT'].methodA)}`,`Method B: ${exact(exactScore['Top-1 FT'].methodB)}`,`FINAL: ${exact(exactScore['Top-1 FT'].final)}`,'',`VERDICT: ${body.verdict} | UNCERTAINTY: ${body?.scoreline?.uncertainty??'—'}`,`CONTRACT COMPLETE: ${verification.complete?'YES':'NO'}`,'',...fusionReportLines(body)].join('\n');
}
function normalizeReleaseTelemetry(body:any){
  body.engine=ENGINE_VERSION;
  body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,primaryContract:PRIMARY_CONTRACT,productionEntrypoint:PRODUCTION_ENTRYPOINT,prematchHandler:PREMATCH_HANDLER,championFusion:body?.championFusion?.version??null};
  body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIGDB_VERSION};
  body.release={...(body.release??{}),engine:ENGINE_VERSION,runtime:RUNTIME_VERSION,primaryContract:PRIMARY_CONTRACT,bigDbRetrieval:BIGDB_VERSION,productionEntrypoint:PRODUCTION_ENTRYPOINT,prematchHandler:PREMATCH_HANDLER,championFusion:body?.championFusion?.version??null};
  body.diversityGuard={version:DIVERSITY_GUARD_VERSION,active:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false,policy:'MATCH_SPECIFIC_SIGNAL_MUST_DOMINATE_GLOBAL_PRIOR'};
}
const nonNegativeCount=(v:any)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
function zeroEvidenceGuard(body:any){
  const exactTeam=body?.bigDbRetrieval?.exactTeam;
  const input=body?.bigDbRetrieval?.predictionInput;
  const counts=body?.evidence?.counts;
  const home=nonNegativeCount(exactTeam?.home?.retrieved)??nonNegativeCount(input?.homeFixtures)??nonNegativeCount(counts?.homeFixtures);
  const away=nonNegativeCount(exactTeam?.away?.retrieved)??nonNegativeCount(input?.awayFixtures)??nonNegativeCount(counts?.awayFixtures);
  const h2h=nonNegativeCount(exactTeam?.h2h?.retrieved)??nonNegativeCount(input?.h2hFixtures)??nonNegativeCount(counts?.h2hFixtures);
  const observed=home!==null||away!==null||h2h!==null;
  const blocked=observed&&((home??0)<=0||(away??0)<=0);
  return {blocked,home,away,h2h,reason:blocked?'ZERO_EXACT_TEAM_EVIDENCE':null};
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/api/audit-3d'&&request.method==='GET')return callControl(env,'AUDIT_3D',queryPayload(url));
  let input:any={};try{input=await request.clone().json()}catch{}
  const response=await v54.fetch(request,env,ctx);
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
      delete body.renderedReport;delete body.presentationContract;delete body.primaryTargetMatrix;delete body.sixTargetMatrix;delete body.markets;delete body.scoreline;delete body.ranking;delete body.verdict;
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
    rebuildPrimaryMatrix(body);
    attachMultiMarketShadow(body);
    attachCfiOutputV2(body,input?.odds?.values??input?.odds??{});
    attachCfiOutputV3(body,input);
    attachCfiBettingBoard(body);
    body.runtime={...(body.runtime??{}),predictionPath:'NATIVE_V5_3_TOP1_STRICT_PRIOR_BIGDB_V2_1_2',diversityGuard:DIVERSITY_GUARD_VERSION,championFusion:body?.championFusion?.version??null};
    if(body?.status==='DATA_READY'){
      body.upstreamStatus='DATA_READY';
      body.status='SUCCESS';
    }
  } else if(body?.error==='TARGET_DATE_REQUIRED'||body?.status==='STRICT_PRIOR_GATE_ERROR') {
    body.runtime={...(body.runtime??{}),predictionPath:'STRICT_PRIOR_FAIL_CLOSED'};
  }
  return Response.json(body,{status:response.status});
}} satisfies ExportedHandler<Env>;
