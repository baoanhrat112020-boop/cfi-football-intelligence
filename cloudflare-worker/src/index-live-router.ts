import prematch from './index-v55.ts';
import { buildPrediction, MARKET_CODES } from '../../src/prediction/final-engine.ts';
import { buildLivePrediction, CFI_LIVE_VERSION } from '../../src/prediction/live-engine.ts';

const LIVE_RUNTIME_VERSION='CFI_LIVE_RUNTIME_V1.1';
const PREMATCH_ENGINE='CFI_FINAL_V5.2.5';
const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';
const PRODUCTION_ENTRYPOINT='index-live-router.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function fetchBigDb(env:Env,input:any){
  if(!env.CFI_DB_BASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)}),b=await readJson(r);
  if(!r.ok||b?.status!=='OK')throw new Error(`BIG_DB_LIVE_PRIOR_FAILED:${b?.error??r.status}`);
  return b;
}

function sidePresent(x:any){return typeof x==='string'?x.trim().length>0:Boolean(x&&typeof x==='object');}
function sideVerified(x:any){
  if(!x||typeof x!=='object')return false;
  if(x.verified===true||x.exact===true||x.matched===true)return true;
  const status=String(x.status??x.matchStatus??x.identityStatus??'').toUpperCase();
  return ['VERIFIED','EXACT','EXACT_MATCH','MATCHED'].includes(status);
}
export function verifyExactTeamPair(exact:any){
  if(!exact||typeof exact!=='object')return false;
  const rootStatus=String(exact.status??exact.identityStatus??'').toUpperCase();
  const rootVerified=exact.verified===true||['VERIFIED','EXACT','EXACT_MATCH','MATCHED'].includes(rootStatus);
  if(rootVerified)return sidePresent(exact.home)&&sidePresent(exact.away);
  return sideVerified(exact.home)&&sideVerified(exact.away);
}

function temporalVerified(temporal:any,targetDate:string){
  if(!temporal?.verified)return false;
  if(Number(temporal?.futureEvidenceCount??0)!==0||Number(temporal?.sameDateEvidenceCount??0)!==0)return false;
  const max=String(temporal?.maxEvidenceDate??'').slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(max)&&max>=targetDate)return false;
  const auditedTarget=String(temporal?.targetDate??'').slice(0,10);
  if(auditedTarget&&auditedTarget!==targetDate)return false;
  return true;
}

function validateReadonlyPrior(prior:any){
  const violations:string[]=[];
  for(const market of MARKET_CODES){
    const row=prior?.markets?.[market];
    if(!row){violations.push(`${market}:missing`);continue;}
    for(const field of ['methodA','methodB','final'])if(!Number.isFinite(Number(row?.[field])))violations.push(`${market}:${field}`);
    if(!Number.isFinite(Number(row?.scorelineMass))||Number(row.final)!==Number(row.scorelineMass))violations.push(`${market}:scorelineMass`);
    if(row?.consistency&&(row.consistency.status!=='PASS'||Number(row.consistency.finalDelta)!==0))violations.push(`${market}:consistency`);
  }
  if(!Array.isArray(prior?.scoreline?.ht?.final)||!Array.isArray(prior?.scoreline?.ft?.final))violations.push('scoreline:missing');
  if(violations.length)throw new Error(`LIVE_PREMATCH_CONSISTENCY_FAILED:${violations.join(',')}`);
}

function strictError(error:string,targetDate:string|null,extra:any={},status=500){
  return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error,strictPrior:{required:true,verified:false,targetDate,failClosed:true},runtime:{version:LIVE_RUNTIME_VERSION,engine:CFI_LIVE_VERSION,predictionPath:'LIVE_PRIOR_STRICT_FAIL_CLOSED',productionEntrypoint:PRODUCTION_ENTRYPOINT},...extra},{status});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict-live'||request.method!=='POST')return prematch.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400})}
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim(),targetDate=String(input?.target_date??input?.matchDate??'').slice(0,10);
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return strictError('TARGET_DATE_REQUIRED',null,{},400);
  if(!input?.live)return Response.json({status:'LIVE_INPUT_ERROR',error:'LIVE_STATE_REQUIRED'},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate}),temporal=big?.temporalAudit??{};
    if(!temporalVerified(temporal,targetDate))return strictError('LIVE_PRIOR_TEMPORAL_AUDIT_FAILED',targetDate,{temporalAudit:temporal});
    if(!verifyExactTeamPair(big?.exactTeam))return strictError('LIVE_PRIOR_IDENTITY_AUDIT_FAILED',targetDate,{exactTeam:big?.exactTeam??null});

    const prior:any=buildPrediction({home,away,targetDate,language:String(input?.language??'vi'),homePayload:{fixtures:big?.fixtures?.home??[]},awayPayload:{fixtures:big?.fixtures?.away??[]},h2hPayload:{fixtures:big?.fixtures?.h2h??[]}});
    validateReadonlyPrior(prior);
    prior.upstreamEngine=prior.engine;prior.engine=PREMATCH_ENGINE;
    const live:any=buildLivePrediction(prior,input.live);
    return Response.json({...live,target:{home,away,date:targetDate},runtime:{version:LIVE_RUNTIME_VERSION,engine:CFI_LIVE_VERSION,predictionPath:'PREMATCH_V5_2_5_READ_ONLY_PRIOR_PLUS_LIVE_STATE_V1_1',prematchEngine:PREMATCH_ENGINE,productionEntrypoint:PRODUCTION_ENTRYPOINT},strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,bigDbRetrieval:{version:BIGDB_VERSION,targetDate,exactTeam:big?.exactTeam,predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length},provenance:big?.provenance??big?.sourceProvenance??null,globalPrior:{role:'CONTEXT_ONLY',directOutputShrinkage:false,maxEvidenceDate:temporal?.globalPriorMaxEvidenceDate??null}},identityAudit:{verified:true,exactTeam:big?.exactTeam},prematchPriorAudit:{engine:PREMATCH_ENGINE,construction:'READ_ONLY_BUILD_PREDICTION_PLUS_V55_CONSISTENCY_GATE',consistencyGuard:'PASS',snapshotWrite:false},isolation:{prematchFrozen:true,prematchSnapshotWrite:false,liveSnapshotWrite:false,liveEvidenceSeparated:true}});
  }catch(e:any){
    const message=String(e?.message||e);
    if(/^(INVALID_LIVE_STATE|INVALID_LIVE_PERIOD_MINUTE|HALFTIME_SCORE_REQUIRED|HALFTIME_SCORE_MISMATCH|HALFTIME_SCORE_INVALID)$/.test(message))return Response.json({status:'LIVE_INPUT_ERROR',error:message,runtime:{version:LIVE_RUNTIME_VERSION,engine:CFI_LIVE_VERSION,predictionPath:'LIVE_INPUT_FAIL_CLOSED',productionEntrypoint:PRODUCTION_ENTRYPOINT}},{status:400});
    return Response.json({status:'ERROR',error:'CFI_LIVE_PREDICTION_FAILURE',message,runtime:{version:LIVE_RUNTIME_VERSION,engine:CFI_LIVE_VERSION,predictionPath:'LIVE_FAIL_CLOSED',productionEntrypoint:PRODUCTION_ENTRYPOINT}},{status:500});
  }
}} satisfies ExportedHandler<Env>;
