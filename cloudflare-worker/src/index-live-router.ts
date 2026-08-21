import prematch from './index-v55.ts';
import { buildPrediction } from '../../src/prediction/final-engine.ts';
import { buildLivePrediction, CFI_LIVE_VERSION } from '../../src/prediction/live-engine.ts';

const PREMATCH_ENGINE='CFI_FINAL_V5.2.5';
const PREMATCH_RUNTIME='CFI_SIX_TARGET_RUNTIME_V1.4';
const PREMATCH_PATH='NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2';
const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';
const DIVERSITY_GUARD='CFI_MATCH_DIVERSITY_GUARD_V1';
const PREMATCH_STATES=new Set(['SCHEDULED','COUNTDOWN','NOT_STARTED','NOTSTARTED','NS','PREMATCH','PRE_MATCH','UPCOMING']);
const TERMINAL_STATES=new Set(['FT','FINISHED','FINAL','CANCELLED','CANCELED','POSTPONED','ABANDONED']);

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
function normalizeState(v:any){return String(v??'').trim().toUpperCase().replace(/[\s-]+/g,'_');}
export function classifyMatchState(input:any){
  const period=normalizeState(input?.live?.period);
  if(['1H','HT','2H'].includes(period))return 'LIVE';
  const explicit=normalizeState(input?.matchStatus??input?.fixtureStatus??input?.match_state??input?.fixture_state??input?.status);
  if(PREMATCH_STATES.has(explicit))return 'PREMATCH';
  if(TERMINAL_STATES.has(explicit))return 'TERMINAL';
  if(input?.live&&Number.isFinite(Number(input.live.minute)))return 'LIVE';
  return 'UNKNOWN';
}
async function routePreKickoffToPrematch(request:Request,input:any,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);url.pathname='/api/predict';
  const headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');headers.set('accept','application/json');
  const payload={home:String(input?.home??'').trim(),away:String(input?.away??'').trim(),target_date:String(input?.target_date??input?.matchDate??'').slice(0,10),language:String(input?.language??'vi')};
  const response=await prematch.fetch(new Request(url.toString(),{method:'POST',headers,body:JSON.stringify(payload)}),env,ctx);
  const body:any=await readJson(response);if(!body||typeof body!=='object')return response;
  body.matchStateRouting={inputState:normalizeState(input?.matchStatus??input?.fixtureStatus??input?.match_state??input?.fixture_state??input?.status),classifiedAs:'PREMATCH',requestedEndpoint:'/api/predict-live',executedEndpoint:'/api/predict',reason:'PRE_KICKOFF_COUNTDOWN_IS_PREMATCH'};
  body.runtime={...(body.runtime??{}),matchStateRouting:'PRE_KICKOFF_TO_PREMATCH'};
  return Response.json(body,{status:response.status});
}
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
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim(),targetDate=String(input?.target_date??input?.matchDate??'').slice(0,10);
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_REQUIRED',strictPrior:{required:true,verified:false,targetDate:null,failClosed:true},runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_STRICT_FAIL_CLOSED'}},{status:400});
  const matchState=classifyMatchState(input);
  if(matchState==='PREMATCH')return routePreKickoffToPrematch(request,input,env,ctx);
  if(matchState==='TERMINAL')return Response.json({status:'MATCH_STATE_ERROR',error:'MATCH_NOT_PREDICTABLE',matchState:normalizeState(input?.matchStatus??input?.fixtureStatus??input?.status)},{status:409});
  if(!input?.live)return Response.json({status:'LIVE_INPUT_ERROR',error:'LIVE_STATE_REQUIRED'},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate});
    const temporal=big?.temporalAudit??{};
    if(!temporal?.verified||Number(temporal?.futureEvidenceCount??0)!==0||Number(temporal?.sameDateEvidenceCount??0)!==0){
      return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'LIVE_PRIOR_TEMPORAL_AUDIT_FAILED',strictPrior:{required:true,verified:false,targetDate,failClosed:true},temporalAudit:temporal,runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_STRICT_FAIL_CLOSED'}},{status:500});
    }
    const prior:any=buildPrediction({home,away,targetDate,language:String(input?.language??'vi'),homePayload:{fixtures:big?.fixtures?.home??[]},awayPayload:{fixtures:big?.fixtures?.away??[]},h2hPayload:{fixtures:big?.fixtures?.h2h??[]}});
    const live:any=buildLivePrediction(prior,input.live);
    return Response.json({...live,target:{home,away,date:targetDate},runtime:{version:'CFI_LIVE_RUNTIME_V1',engine:CFI_LIVE_VERSION,predictionPath:'PREMATCH_V5_2_5_PRIOR_PLUS_LIVE_STATE_V1',prematchEngine:PREMATCH_ENGINE},strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,bigDbRetrieval:{version:BIGDB_VERSION,exactTeam:big?.exactTeam??null,predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length}},isolation:{prematchFrozen:true,prematchSnapshotWrite:false,liveSnapshotWrite:false,liveEvidenceSeparated:true}});
  }catch(e:any){
    return Response.json({status:'ERROR',error:'CFI_LIVE_PREDICTION_FAILURE',message:String(e?.message||e),runtime:{engine:CFI_LIVE_VERSION,predictionPath:'LIVE_FAIL_CLOSED'}},{status:500});
  }
}} satisfies ExportedHandler<Env>;
