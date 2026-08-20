import v52 from './index-v52.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.4';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.3.2';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1.2';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function fetchTemporal(env:Env,home:string,away:string,targetDate:string){
  if(!env.CFI_DB_BASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({home,away,target_date:targetDate})});
  const b=await readJson(r);if(!r.ok||b?.status!=='OK')throw new Error(`TEMPORAL_RETRIEVAL_FAILED:${b?.error??r.status}`);return b;
}
export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return v52.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{}
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim(),targetDate=String(input?.target_date??input?.matchDate??'').slice(0,10);
  const response=await v52.fetch(request,env,ctx);if(!response.ok)return response;
  const ct=String(response.headers.get('content-type')??'');if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  try{
    const big=await fetchTemporal(env,home,away,targetDate);
    const src=big?.temporalAudit??{};
    const temporal={targetDate,maxEvidenceDate:src?.maxEvidenceDate??big?.maxEvidenceDate??null,exactTeamMaxEvidenceDate:src?.exactTeamMaxEvidenceDate??null,globalPriorMaxEvidenceDate:src?.globalPriorMaxEvidenceDate??null,futureEvidenceCount:Number(src?.futureEvidenceCount??big?.futureEvidenceCount??0),sameDateEvidenceCount:Number(src?.sameDateEvidenceCount??big?.sameDateEvidenceCount??0),observable:Boolean(src?.observable),verified:Boolean(src?.verified),rule:'fixtureDate < targetDate'};
    body.engine=ENGINE_VERSION;
    body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2'};
    body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIG_DB_RETRIEVAL_VERSION,targetDate,temporalAudit:temporal,maxEvidenceDate:temporal.maxEvidenceDate,futureEvidenceCount:temporal.futureEvidenceCount,sameDateEvidenceCount:temporal.sameDateEvidenceCount};
    body.temporalEvidenceAudit=temporal;
    body.strictPriorAudit={...(body.strictPriorAudit??{}),required:true,targetDate,telemetryVersion:'CFI_TEMPORAL_AUDIT_V1.1',verified:temporal.verified,evidence:temporal};
    return Response.json(body,{status:response.status});
  }catch(e:any){return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TEMPORAL_AUDIT_TELEMETRY_FAILED',message:String(e?.message||e),strictPrior:{required:true,verified:false,failClosed:true},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500})}
}} satisfies ExportedHandler<Env>;
