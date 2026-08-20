import v50 from './index-v50.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.3';
const ENGINE_VERSION='CFI_FINAL_V5.2.4';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2.1';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

function validTargetDate(value:any){
  const s=String(value??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/api/predict'&&request.method==='POST'){
    let input:any={};
    try{input=await request.clone().json()}catch{
      return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});
    }
    const home=String(input?.home??'').trim();
    const away=String(input?.away??'').trim();
    if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
    const targetDate=validTargetDate(input?.target_date??input?.matchDate);
    if(!targetDate){
      return Response.json({
        status:'STRICT_PRIOR_GATE_ERROR',
        error:'TARGET_DATE_REQUIRED',
        message:'Production pre-match prediction requires target_date in YYYY-MM-DD format. Prediction was not executed and no immutable snapshot was created.',
        strictPrior:{required:true,verified:false,targetDate:null,failClosed:true},
        runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,predictionPath:'STRICT_PRIOR_FAIL_CLOSED',bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}
      },{status:400});
    }
    const normalized={...input,home,away,target_date:targetDate};
    const forwarded=new Request(request,{body:JSON.stringify(normalized),headers:new Headers(request.headers)});
    forwarded.headers.set('content-type','application/json');
    const response=await v50.fetch(forwarded,env,ctx);
    const contentType=String(response.headers.get('content-type')??'');
    if(!contentType.includes('application/json'))return response;
    let body:any;try{body=await response.clone().json()}catch{return response}
    if(!response.ok)return response;
    const retrievalTarget=String(body?.bigDbRetrieval?.targetDate??'');
    const predictionTarget=String(body?.target?.date??targetDate).slice(0,10);
    if(retrievalTarget!==targetDate||predictionTarget!==targetDate){
      return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_PROPAGATION_FAILED',expectedTargetDate:targetDate,observed:{retrievalTarget:retrievalTarget||null,predictionTarget:predictionTarget||null},strictPrior:{required:true,verified:false,failClosed:true},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,predictionPath:'STRICT_PRIOR_FAIL_CLOSED',bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
    }
    body.engine=ENGINE_VERSION;
    body.bigDbRetrieval={...(body.bigDbRetrieval??{}),version:BIG_DB_RETRIEVAL_VERSION,targetDate,strictPriorGate:{required:true,verified:true,failClosed:true}};
    body.runtime={...(body.runtime??{}),version:RUNTIME_VERSION,engine:ENGINE_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1',bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,strictPriorGate:'TARGET_DATE_REQUIRED_AND_PROPAGATED'};
    body.strictPriorAudit={required:true,verified:true,targetDate,rule:'ALL_PREDICTION_AND_BIG_DB_EVIDENCE_MUST_BE_STRICTLY_PRIOR_TO_TARGET_DATE'};
    return Response.json(body,{status:response.status});
  }
  return v50.fetch(request,env,ctx);
}} satisfies ExportedHandler<Env>;
