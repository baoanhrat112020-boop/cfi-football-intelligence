import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-cfi-key","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"content-type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 const expectedKey=Deno.env.get("CFI_ACTION_KEY");if(!expectedKey)return json({error:"SERVER_KEY_NOT_CONFIGURED"},500);if(req.headers.get("x-cfi-key")!==expectedKey)return json({error:"UNAUTHORIZED"},401);
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!supabaseUrl||!serviceRole)return json({error:"SERVER_SECRET_MISSING"},500);
 const db=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}}),url=new URL(req.url),body=req.method==="POST"?await req.json().catch(()=>({})):{};
 const action=String(body?.action||url.searchParams.get("action")||"HISTORY").toUpperCase(),targetDate=String(body?.target_date||url.searchParams.get("target_date")||"").slice(0,10)||null,home=String(body?.home||url.searchParams.get("home")||"").trim()||null,away=String(body?.away||url.searchParams.get("away")||"").trim()||null,settlementStatus=String(body?.settlement_status||url.searchParams.get("settlement_status")||"").toUpperCase()||null,selectedOnly=body?.selected_only!==false&&url.searchParams.get("selected_only")!=="false",limit=Math.max(1,Math.min(100,Number(body?.limit||url.searchParams.get("limit")||5)||5));
 const isSynthetic=(r:any)=>/^CFI E2E\b/i.test(String(r?.home_team||''))||/^CFI E2E\b/i.test(String(r?.away_team||''))||/NONEXISTENT/i.test(String(r?.home_team||''))||/NONEXISTENT/i.test(String(r?.away_team||''));
 async function history(){const {data,error}=await db.rpc("cfi_get_prediction_history",{p_target_date:targetDate,p_home_team:home,p_away_team:away,p_selected_only:selectedOnly});if(error)throw error;let rows=data??[];if(settlementStatus)rows=rows.filter((r:any)=>String(r.settlement_status).toUpperCase()===settlementStatus);rows=[...rows].sort((a:any,b:any)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,limit);return rows;}
 async function evaluation(){const {data,error}=await db.rpc("cfi_get_prediction_evaluation",{p_target_date:targetDate,p_home_team:home,p_away_team:away,p_settlement_status:settlementStatus,p_selected_only:selectedOnly});if(error)throw error;return (data??[]).slice(0,limit);}
 async function collectOne(snapshotId:string){const res=await fetch(`${supabaseUrl}/functions/v1/cfi-result-collector`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${serviceRole}`,"apikey":serviceRole},body:JSON.stringify({snapshotId})});const text=await res.text();let parsed:any=text;try{parsed=JSON.parse(text)}catch{}return{snapshotId,httpStatus:res.status,ok:res.ok,result:parsed};}
 async function audit3d(){
   const {data:h,error:he}=await db.rpc("cfi_get_prediction_history",{p_target_date:null,p_home_team:null,p_away_team:null,p_selected_only:true});if(he)throw he;
   const real=(h??[]).filter((r:any)=>!isSynthetic(r));
   const dates=[...new Set(real.map((r:any)=>String(r.target_date)).filter(Boolean))].sort().reverse().slice(0,3);
   if(!dates.length)return {status:"AUDIT_EMPTY",action:"AUDIT_3D",dates:[],count:0,rows:[],antiLeakage:true,scopeSemantics:"LATEST_3_DISTINCT_PREDICTION_DATES"};
   const scoped=real.filter((r:any)=>dates.includes(String(r.target_date)));
   const pending=scoped.filter((r:any)=>String(r.settlement_status||'PENDING').toUpperCase()!=="SETTLED");
   const collector:any[]=[];for(const r of pending){if(r.snapshot_id)collector.push(await collectOne(String(r.snapshot_id)));}
   const {data:e,error:ee}=await db.rpc("cfi_get_prediction_evaluation",{p_target_date:null,p_home_team:null,p_away_team:null,p_settlement_status:null,p_selected_only:true});if(ee)throw ee;
   const rows=(e??[]).filter((r:any)=>dates.includes(String(r.target_date))&&!isSynthetic(r));
   const daily=dates.map(d=>{const x=rows.filter((r:any)=>String(r.target_date)===d),settled=x.filter((r:any)=>String(r.settlement_status).toUpperCase()==="SETTLED");const avg=(k:string)=>settled.length?settled.reduce((s:any,r:any)=>s+(Number(r[k])||0),0)/settled.length:null;return{target_date:d,total:x.length,settled:settled.length,pending:x.length-settled.length,mean_brier:avg('mean_brier'),top3_ht_accuracy:settled.length?settled.filter((r:any)=>r.top3_ht_hit===true).length/settled.length:null,top3_ft_accuracy:settled.length?settled.filter((r:any)=>r.top3_ft_hit===true).length/settled.length:null};});
   const settled=rows.filter((r:any)=>String(r.settlement_status).toUpperCase()==="SETTLED"),pendingAfter=rows.length-settled.length;
   return {status:pendingAfter?"AUDIT_PARTIAL":"AUDIT_COMPLETE",action:"AUDIT_3D",scopeSemantics:"LATEST_3_DISTINCT_PREDICTION_DATES",dates,count:rows.length,settled:settled.length,pending:pendingAfter,syntheticExcluded:true,collector:{attempted:collector.length,success:collector.filter(x=>x.ok).length,runs:collector},daily,rows,antiLeakage:true};
 }
 try{
  if(action==="HISTORY"){const rows=await history();return json({status:"OK",action,count:rows.length,limit,rows});}
  if(action==="RESULTS"){const rows=await evaluation();return json({status:"OK",action,count:rows.length,limit,rows,evaluationSource:"cfi_prediction_evaluation",antiLeakage:true});}
  if(action==="AUDIT_3D")return json(await audit3d());
  if(action==="COLLECT"||action==="SETTLE"){
   const before=await history();if(!before.length)return json({status:"NO_PREDICTION_SNAPSHOT",action:"COLLECT",count:0,rows:[],antiLeakage:true},404);
   const explicit=String(body?.snapshot_id||"").trim();const targets=explicit?[explicit]:before.filter((r:any)=>String(r.settlement_status||'PENDING').toUpperCase()!=="SETTLED").map((r:any)=>String(r.snapshot_id)).filter(Boolean);
   const collector:any[]=[];for(const id of [...new Set(targets)])collector.push(await collectOne(id));const rows=await evaluation();const attempted=collector.length,success=collector.filter(x=>x.ok).length;
   return json({status:"OK",action:"COLLECT",mode:"ON_DEMAND_TARGETED",requested:{targetDate,home,away,selectedOnly,limit},snapshotsFound:before.length,collector:{attempted,success,skippedAlreadySettled:before.length-targets.length,runs:collector},count:rows.length,rows,evaluationSource:"cfi_prediction_evaluation",antiLeakage:true,userResultImageRequired:false,imageFallbackOnlyAfterAutomatedSourcesFail:true});
  }
  return json({error:"INVALID_ACTION",allowed:["HISTORY","RESULTS","COLLECT","SETTLE","AUDIT_3D"]},400);
 }catch(error){return json({error:"INTERNAL_ERROR",message:error instanceof Error?error.message:String(error)},500);}
});