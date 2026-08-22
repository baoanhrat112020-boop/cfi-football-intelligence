import { classifyMatchState, normalizeMatchState, resolveTargetDate } from './match-state-routing.ts';

type FetchLike=(request:Request,env:any,ctx:any)=>Promise<Response>;

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}

export async function routePreKickoffRequest(request:Request,input:any,prematchFetch:FetchLike,env:any,ctx:any){
  const state=classifyMatchState(input);
  if(state!=='PREMATCH')return null;
  const resolved=resolveTargetDate(input);
  if(!resolved.date){
    return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_REQUIRED',strictPrior:{required:true,verified:false,targetDate:null,failClosed:true},matchStateRouting:{classifiedAs:'PREMATCH',requestedEndpoint:'/api/predict-live',executedEndpoint:null,reason:'PRE_KICKOFF_TARGET_DATE_UNRESOLVED'}},{status:400});
  }
  const url=new URL(request.url);url.pathname='/api/predict';
  const headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');headers.set('accept','application/json');
  const payload={home:String(input?.home??'').trim(),away:String(input?.away??'').trim(),target_date:resolved.date,language:String(input?.language??'vi')};
  const response=await prematchFetch(new Request(url.toString(),{method:'POST',headers,body:JSON.stringify(payload)}),env,ctx);
  const body:any=await readJson(response);if(!body||typeof body!=='object')return response;
  body.matchStateRouting={inputState:normalizeMatchState(input?.matchStatus??input?.fixtureStatus??input?.match_state??input?.fixture_state??input?.status),classifiedAs:'PREMATCH',requestedEndpoint:'/api/predict-live',executedEndpoint:'/api/predict',reason:'PRE_KICKOFF_COUNTDOWN_IS_PREMATCH',targetDate:resolved.date,targetDateSource:resolved.source};
  body.runtime={...(body.runtime??{}),matchStateRouting:'PRE_KICKOFF_TO_PREMATCH'};
  return Response.json(body,{status:response.status});
}
