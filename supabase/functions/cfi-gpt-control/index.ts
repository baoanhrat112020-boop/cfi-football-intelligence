import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-cfi-key","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"content-type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 const expectedKey=Deno.env.get("CFI_ACTION_KEY");if(!expectedKey)return json({error:"SERVER_KEY_NOT_CONFIGURED"},500);if(req.headers.get("x-cfi-key")!==expectedKey)return json({error:"UNAUTHORIZED"},401);
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!supabaseUrl||!serviceRole)return json({error:"SERVER_SECRET_MISSING"},500);
 const db=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}}),url=new URL(req.url),body=req.method==="POST"?await req.json().catch(()=>({})):{};
 const action=String(body?.action||url.searchParams.get("action")||"HISTORY").toUpperCase(),targetDate=String(body?.target_date||url.searchParams.get("target_date")||"").slice(0,10)||null,home=String(body?.home||url.searchParams.get("home")||"").trim()||null,away=String(body?.away||url.searchParams.get("away")||"").trim()||null,settlementStatus=String(body?.settlement_status||url.searchParams.get("settlement_status")||"").toUpperCase()||null,selectedOnly=body?.selected_only!==false&&url.searchParams.get("selected_only")!=="false";
 async function history(){const {data,error}=await db.rpc("cfi_get_prediction_history",{p_target_date:targetDate,p_home_team:home,p_away_team:away,p_selected_only:selectedOnly});if(error)throw error;let rows=data??[];if(settlementStatus)rows=rows.filter((r:any)=>String(r.settlement_status).toUpperCase()===settlementStatus);return rows;}
 async function evaluation(){const {data,error}=await db.rpc("cfi_get_prediction_evaluation",{p_target_date:targetDate,p_home_team:home,p_away_team:away,p_settlement_status:settlementStatus,p_selected_only:selectedOnly});if(error)throw error;return data??[];}
 async function collectOne(snapshotId:string){const res=await fetch(`${supabaseUrl}/functions/v1/cfi-result-collector`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${serviceRole}`,"apikey":serviceRole},body:JSON.stringify({snapshotId})});const text=await res.text();let parsed:any=text;try{parsed=JSON.parse(text)}catch{}return{snapshotId,httpStatus:res.status,ok:res.ok,result:parsed};}
 try{
  if(action==="HISTORY"){const rows=await history();return json({status:"OK",action,count:rows.length,rows});}
  if(action==="RESULTS"){const rows=await evaluation();return json({status:"OK",action,count:rows.length,rows,evaluationSource:"cfi_prediction_evaluation",antiLeakage:true});}
  if(action==="COLLECT"||action==="SETTLE"){
   const before=await history();
   if(!before.length)return json({status:"NO_PREDICTION_SNAPSHOT",action:"COLLECT",count:0,rows:[],antiLeakage:true},404);
   const explicit=String(body?.snapshot_id||"").trim();
   const targets=explicit?[explicit]:before.filter((r:any)=>String(r.settlement_status||'PENDING').toUpperCase()!=="SETTLED").map((r:any)=>String(r.snapshot_id)).filter(Boolean);
   const collector:any[]=[];
   for(const id of [...new Set(targets)])collector.push(await collectOne(id));
   const rows=await evaluation();
   const attempted=collector.length,success=collector.filter(x=>x.ok).length;
   return json({status:"OK",action:"COLLECT",mode:"ON_DEMAND_TARGETED",requested:{targetDate,home,away,selectedOnly},snapshotsFound:before.length,collector:{attempted,success,skippedAlreadySettled:before.length-targets.length,runs:collector},count:rows.length,rows,evaluationSource:"cfi_prediction_evaluation",antiLeakage:true,userResultImageRequired:false,imageFallbackOnlyAfterAutomatedSourcesFail:true});
  }
  return json({error:"INVALID_ACTION",allowed:["HISTORY","RESULTS","COLLECT","SETTLE"]},400);
 }catch(error){return json({error:"INTERNAL_ERROR",message:error instanceof Error?error.message:String(error)},500);}
});