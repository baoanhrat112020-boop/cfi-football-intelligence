import prematch from './index-v55.ts';
import { buildPrediction } from '../../src/prediction/final-engine.ts';
import { buildLivePrediction, CFI_LIVE_VERSION } from '../../src/prediction/live-engine.ts';
import { classifyMatchState, normalizeMatchState, resolveTargetDate } from '../../src/runtime/match-state-routing.ts';
import { routePreKickoffRequest } from '../../src/runtime/pre-kickoff-routing.ts';

const PREMATCH_ENGINE='CFI_FINAL_V5.2.5';
const PREMATCH_RUNTIME='CFI_SIX_TARGET_RUNTIME_V1.4';
const PREMATCH_PATH='NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2';
const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';
const DIVERSITY_GUARD='CFI_MATCH_DIVERSITY_GUARD_V1';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function fetchBigDb(env:Env,input:any){
  if(!env.CFI_DB_BASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});
  const b=await readJson(r);
  if(!r.ok||b?.status!=='OK')throw new Error(`BIG_DB_LIVE_PRIOR_FAILED:${b?.error??r.status}`);
  return b;
}

function exactTeamEvidenceAudit(big:any){
  const home=Number(big?.exactTeam?.home?.retrieved);
  const away=Number(big?.exactTeam?.away?.retrieved);
  const h2h=Number(big?.exactTeam?.h2h?.retrieved);
  const homeValid=Number.isFinite(home)&&home>0;
  const awayValid=Number.isFinite(away)&&away>0;
  return {verified:homeValid&&awayValid,home:Number.isFinite(home)?home:null,away:Number.isFinite(away)?away:null,h2h:Number.isFinite(h2h)?h2h:null};
}

function temporalEvidenceAudit(big:any,targetDate:string){
  const src=big?.temporalAudit;
  if(!src||typeof src!=='object')return {verified:false,error:'TEMPORAL_AUDIT_REQUIRED',targetDate};
  const observedTarget=String(src?.targetDate??big?.targetDate??'').slice(0,10);
  const maxEvidenceDate=src?.maxEvidenceDate?String(src.maxEvidenceDate).slice(0,10):null;
  const futureEvidenceCount=Number(src?.futureEvidenceCount);
  const sameDateEvidenceCount=Number(src?.sameDateEvidenceCount);
  if(observedTarget!==targetDate)return {verified:false,error:'TEMPORAL_TARGET_DATE_MISMATCH',targetDate,observedTarget:observedTarget||null,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount};
  if(!Number.isFinite(futureEvidenceCount)||!Number.isFinite(sameDateEvidenceCount))return {verified:false,error:'TEMPORAL_COUNTS_REQUIRED',targetDate,maxEvidenceDate,futureEvidenceCount:null,sameDateEvidenceCount:null};
  if(futureEvidenceCount!==0||sameDateEvidenceCount!==0)return {verified:false,error:'TEMPORAL_FUTURE_OR_SAME_DATE_EVIDENCE',targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount};
  if(src?.verified!==true||!maxEvidenceDate||maxEvidenceDate>=targetDate)return {verified:false,error:'TEMPORAL_AUDIT_NOT_VERIFIED',targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount,observable:Boolean(src?.observable)};
  return {verified:true,error:null,targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount,observable:Boolean(src?.observable),exactTeamMaxEvidenceDate:src?.exactTeamMaxEvidenceDate??null,globalPriorMaxEvidenceDate:src?.globalPriorMaxEvidenceDate??null,rule:'fixtureDate < targetDate'};
}

async function syncedStatus(request:Request,env:Env,ctx:ExecutionContext){
  const response=await prematch.fetch(request,env,ctx);
  const body:any=await readJson(response);
  if(!body||typeof body!=='object')return response;
  body.engine=PREMATCH_ENGINE;
  body.runtime={...(body.runtime??{}),version:PREMATCH_RUNTIME,engine:PREMATCH_ENGINE,predictionPath:PREMATCH_PATH,productionEntrypoint:'index-live-router.ts',prematchEntrypoint:'index-v55.ts'};
  body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIGDB_VERSION};
  body.diversityGuard={version:DIVERSITY_GUARD,active:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false};
  body.live={supported:true,engine:CFI_LIVE_VERSION,runtimeVersion:'CFI_LIVE_RUNTIME_V1',predictionPath:'PREMATCH_V5_2_5_PRIOR_PLUS_LIVE_STATE_V1',endpoint:'/api/predict-live',preKickoffFallback:'SCHEDULED_COUNTDOWN_NOT_STARTED_TO_PREMATCH'};
  return Response.json(body,{status:response.status});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/api/status'&&request.method==='GET')return syncedStatus(request,env,ctx);
  if(url.pathname!=='/api/predict-live'||request.method!=='POST')return prematch.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400})}
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim();
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  const matchState=classifyMatchState(input);
  if(matchState==='PREMATCH')return routePreKickoffRequest(request,input,(r,e,c)=>prematch.fetch(r,e,c),env,ctx);
  if(matchState==='TERMINAL')return Response.json({status:'MATCH_STATE_ERROR',error:'MATCH_NOT_PREDICTABLE',matchState:normalizeMatchState(input?.matchStatus??input?.fixtureStatus??input?.status)},{status:409});
  const resolvedTarget=resolveTargetDate(input),targetDate=resolvedTarget.date??'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_REQUIRED',strictPrior:{required:true,verified:false,targetDate:null,failClosed:true},runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_STRICT_FAIL_CLOSED'}},{status:400});
  if(!input?.live)return Response.json({status:'LIVE_INPUT_ERROR',error:'LIVE_STATE_REQUIRED'},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate});
    const exact=exactTeamEvidenceAudit(big);
    if(!exact.verified){
      return Response.json({status:'INSUFFICIENT_DATA',error:'ZERO_EXACT_TEAM_EVIDENCE',target:{home,away,date:targetDate},exactTeam:exact,strictPrior:{required:true,verified:false,targetDate,failClosed:true},runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_INSUFFICIENT_DATA'}},{status:422});
    }
    const temporal=temporalEvidenceAudit(big,targetDate);
    if(!temporal.verified){
      return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:temporal.error,strictPrior:{required:true,verified:false,targetDate,failClosed:true},temporalEvidenceAudit:temporal,runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_STRICT_FAIL_CLOSED'}},{status:500});
    }
    const prior:any=buildPrediction({home,away,targetDate,language:String(input?.language??'vi'),homePayload:{fixtures:big?.fixtures?.home??[]},awayPayload:{fixtures:big?.fixtures?.away??[]},h2hPayload:{fixtures:big?.fixtures?.h2h??[]}});
    if(prior?.status!=='DATA_READY'||Number(prior?.evidence?.htCoverage??0)<=0||Number(prior?.evidence?.ftCoverage??0)<=0){
      return Response.json({status:'INSUFFICIENT_DATA',error:'LIVE_PRIOR_SCORE_EVIDENCE_REQUIRED',target:{home,away,date:targetDate},evidence:prior?.evidence??null,exactTeam:exact,strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_INSUFFICIENT_DATA'}},{status:422});
    }
    const live:any=buildLivePrediction(prior,input.live);
    return Response.json({...live,target:{home,away,date:targetDate},runtime:{version:'CFI_LIVE_RUNTIME_V1',engine:CFI_LIVE_VERSION,predictionPath:'PREMATCH_V5_2_5_PRIOR_PLUS_LIVE_STATE_V1',prematchEngine:PREMATCH_ENGINE,targetDateSource:resolvedTarget.source},strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,bigDbRetrieval:{version:BIGDB_VERSION,exactTeam:big?.exactTeam??null,predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length}},isolation:{prematchFrozen:true,prematchSnapshotWrite:false,liveSnapshotWrite:false,liveEvidenceSeparated:true}});
  }catch(e:any){
    return Response.json({status:'ERROR',error:'CFI_LIVE_PREDICTION_FAILURE',message:String(e?.message||e),runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_FAIL_CLOSED'}},{status:500});
  }
}} satisfies ExportedHandler<Env>;
