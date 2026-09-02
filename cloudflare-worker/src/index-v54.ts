import v53 from './index-v53.ts';

const ENGINE_VERSION='CFI_FINAL_V5.2.4';
const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.3.2';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const response=await v53.fetch(request,env,ctx);
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return response;
  const ct=String(response.headers.get('content-type')??'');
  if(!ct.includes('application/json'))return response;
  let body:any;try{body=await response.clone().json()}catch{return response}
  if(response.ok)return response;
  if(body?.status==='STRICT_PRIOR_GATE_ERROR'){
    body.engine=ENGINE_VERSION;
    body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,predictionPath:'STRICT_PRIOR_FAIL_CLOSED'};
    body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIG_DB_RETRIEVAL_VERSION,executed:false};
    body.release={engine:ENGINE_VERSION,runtime:RUNTIME_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,productionEntrypoint:'index-v54.ts'};
    return Response.json(body,{status:response.status});
  }
  return response;
}} satisfies ExportedHandler<Env>;
