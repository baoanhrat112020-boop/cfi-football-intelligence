import v51 from './index-v51.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.4';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.3.1';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.1';

function patchRenderedReport(value:any){
  if(typeof value!=='string')return value;
  return value.replace(/ENGINE\s+CFI_FINAL_V\d+\.\d+\.\d+/g,`ENGINE ${ENGINE_VERSION}`);
}

function normalizeTemporalAudit(body:any,targetDate:string){
  const src=body?.temporalEvidenceAudit??body?.bigDbRetrieval?.temporalAudit??body?.strictPriorAudit?.evidence??{};
  const pick=(...vals:any[])=>vals.find(v=>v!==undefined&&v!==null);
  const future=Number(pick(src?.futureEvidenceCount,src?.futureCount,body?.bigDbRetrieval?.futureEvidenceCount,0));
  const same=Number(pick(src?.sameDateEvidenceCount,src?.sameDateCount,body?.bigDbRetrieval?.sameDateEvidenceCount,0));
  const maxDate=pick(src?.maxEvidenceDate,body?.bigDbRetrieval?.maxEvidenceDate,null);
  const observable=maxDate!==null||src?.futureEvidenceCount!==undefined||src?.sameDateEvidenceCount!==undefined||body?.bigDbRetrieval?.futureEvidenceCount!==undefined||body?.bigDbRetrieval?.sameDateEvidenceCount!==undefined;
  const maxPrior=maxDate?String(maxDate).slice(0,10)<targetDate:null;
  return {targetDate,maxEvidenceDate:maxDate?String(maxDate).slice(0,10):null,futureEvidenceCount:future,sameDateEvidenceCount:same,observable,verified:observable&&future===0&&same===0&&maxPrior===true,rule:'fixtureDate < targetDate'};
}

export default{async fetch(request:Request,env:any,ctx:ExecutionContext){
  const response=await v51.fetch(request,env,ctx);
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST'||!response.ok)return response;
  const ct=String(response.headers.get('content-type')??'');
  if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  const targetDate=String(body?.bigDbRetrieval?.targetDate??body?.target?.date??'').slice(0,10);
  body.engine=ENGINE_VERSION;
  body.renderedReport=patchRenderedReport(body?.renderedReport);
  if(body?.presentationContract?.renderedReport)body.presentationContract.renderedReport=patchRenderedReport(body.presentationContract.renderedReport);
  body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_1'};
  body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIG_DB_RETRIEVAL_VERSION,targetDate};
  const temporal=normalizeTemporalAudit(body,targetDate);
  body.temporalEvidenceAudit=temporal;
  body.strictPriorAudit={...(body.strictPriorAudit??{}),required:true,targetDate,telemetryVersion:'CFI_TEMPORAL_AUDIT_V1',evidence:temporal};
  return Response.json(body,{status:response.status});
}} satisfies ExportedHandler<any>;
