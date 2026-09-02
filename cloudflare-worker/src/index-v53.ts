import v52 from './index-v52.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.4';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.3.2';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return v52.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{}
  const targetDate=String(input?.target_date??input?.matchDate??'').slice(0,10);
  const response=await v52.fetch(request,env,ctx);if(!response.ok)return response;
  const ct=String(response.headers.get('content-type')??'');if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  const src=body?.temporalEvidenceAudit??body?.bigDbRetrieval?.temporalAudit??body?.strictPriorAudit?.evidence??null;
  if(!src||typeof src!=='object')return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TEMPORAL_AUDIT_TELEMETRY_FAILED',message:'TEMPORAL_AUDIT_REQUIRED_FROM_PRIMARY_BIGDB_RETRIEVAL',strictPrior:{required:true,verified:false,failClosed:true},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
  const observedTarget=String(src?.targetDate??body?.bigDbRetrieval?.targetDate??'').slice(0,10);
  const futureEvidenceCount=Number(src?.futureEvidenceCount);
  const sameDateEvidenceCount=Number(src?.sameDateEvidenceCount);
  const maxEvidenceDate=src?.maxEvidenceDate?String(src.maxEvidenceDate).slice(0,10):null;
  const verified=observedTarget===targetDate&&Number.isFinite(futureEvidenceCount)&&Number.isFinite(sameDateEvidenceCount)&&futureEvidenceCount===0&&sameDateEvidenceCount===0&&src?.verified===true&&Boolean(maxEvidenceDate)&&String(maxEvidenceDate)<targetDate;
  if(!verified)return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TEMPORAL_AUDIT_TELEMETRY_FAILED',message:'PRIMARY_BIGDB_TEMPORAL_AUDIT_NOT_VERIFIED',strictPrior:{required:true,verified:false,failClosed:true},temporalEvidenceAudit:{targetDate,observedTarget:observedTarget||null,maxEvidenceDate,futureEvidenceCount:Number.isFinite(futureEvidenceCount)?futureEvidenceCount:null,sameDateEvidenceCount:Number.isFinite(sameDateEvidenceCount)?sameDateEvidenceCount:null},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
  const temporal={targetDate,maxEvidenceDate,exactTeamMaxEvidenceDate:src?.exactTeamMaxEvidenceDate??null,globalPriorMaxEvidenceDate:src?.globalPriorMaxEvidenceDate??null,futureEvidenceCount,sameDateEvidenceCount,observable:Boolean(src?.observable),verified:true,rule:'fixtureDate < targetDate'};
  body.engine=ENGINE_VERSION;
  body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_3_1_SHARED_IDENTITY'};
  body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIG_DB_RETRIEVAL_VERSION,targetDate,temporalAudit:temporal,maxEvidenceDate:temporal.maxEvidenceDate,futureEvidenceCount:temporal.futureEvidenceCount,sameDateEvidenceCount:temporal.sameDateEvidenceCount,temporalAuditRetrieval:'REUSED_PRIMARY_BIGDB_RESPONSE'};
  body.temporalEvidenceAudit=temporal;
  body.strictPriorAudit={...(body.strictPriorAudit??{}),required:true,targetDate,telemetryVersion:'CFI_TEMPORAL_AUDIT_V1.1',verified:true,evidence:temporal};
  return Response.json(body,{status:response.status});
}} satisfies ExportedHandler<Env>;
