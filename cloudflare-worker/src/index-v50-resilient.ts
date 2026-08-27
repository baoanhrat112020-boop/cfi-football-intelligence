import v50 from './index-v50.ts';

export const BIGDB_RETRY_VERSION='CFI_BIGDB_TRANSIENT_RETRY_V1';
const MAX_ATTEMPTS=3;
const DELAYS_MS=[250,750];

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(response:Response){try{return await response.clone().json()}catch{return null}}
function transientMessage(message:any){
  const s=String(message??'').toUpperCase();
  return s.includes('BIG_DB_V2_FAILED')||s.includes('FETCH FAILED')||s.includes('NETWORK')||s.includes('TIMEOUT')||s.includes('TIMED OUT')||s.includes('CONNECTION')||s.includes('SOCKET')||s.includes('RESET')||s.includes('HTTP_408')||s.includes('HTTP_425')||s.includes('HTTP_429')||s.includes('HTTP_500')||s.includes('HTTP_502')||s.includes('HTTP_503')||s.includes('HTTP_504');
}
export function isTransientBigDbPredictionFailure(response:Response,body:any){
  return response.status>=500&&body?.error==='BIG_DB_V2_PREDICTION_FAILURE'&&transientMessage(body?.message);
}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return v50.fetch(request,env,ctx);
  let last:Response|null=null,lastBody:any=null;
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    const response=await v50.fetch(request.clone(),env,ctx);
    const body=await readJson(response);
    last=response;lastBody=body;
    if(!isTransientBigDbPredictionFailure(response,body)){
      if(attempt===1||!response.headers.get('content-type')?.includes('application/json')||!body||typeof body!=='object')return response;
      body.runtime={...(body.runtime??{}),bigDbResilience:{version:BIGDB_RETRY_VERSION,attempts:attempt,recovered:true}};
      return Response.json(body,{status:response.status});
    }
    if(attempt<MAX_ATTEMPTS)await sleep(DELAYS_MS[attempt-1]??750);
  }
  if(lastBody&&typeof lastBody==='object'){
    lastBody.runtime={...(lastBody.runtime??{}),bigDbResilience:{version:BIGDB_RETRY_VERSION,attempts:MAX_ATTEMPTS,recovered:false,exhausted:true}};
    return Response.json(lastBody,{status:last?.status??500});
  }
  return last??Response.json({status:'ERROR',error:'BIG_DB_V2_PREDICTION_FAILURE',message:'TRANSIENT_RETRY_EXHAUSTED',runtime:{bigDbResilience:{version:BIGDB_RETRY_VERSION,attempts:MAX_ATTEMPTS,recovered:false,exhausted:true}}},{status:500});
}} satisfies ExportedHandler<Env>;
