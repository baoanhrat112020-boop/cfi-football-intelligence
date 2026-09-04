import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION="CFI_PC_RESULT_RECOVERY_QUEUE_V2_HINTS";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-cfi-node-key","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify({version:VERSION,...(body as any)}),{status,headers:{...cors,"content-type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({status:"ERROR",error:"POST_REQUIRED"},405);
  const expected=Deno.env.get("CFI_PC_NODE_KEY");
  if(!expected) return json({status:"ERROR",error:"NODE_KEY_NOT_CONFIGURED"},500);
  if(req.headers.get("x-cfi-node-key")!==expected) return json({status:"ERROR",error:"UNAUTHORIZED"},401);
  const su=Deno.env.get("SUPABASE_URL"),sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!su||!sr) return json({status:"ERROR",error:"SERVER_SECRET_MISSING"},500);
  const db=createClient(su,sr,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action??"PULL").toUpperCase();

  if(action==="PULL"){
    const limit=Math.max(1,Math.min(20,Number(body?.limit)||8));
    const {data:enq,error:ee}=await db.rpc("cfi_enqueue_pc_result_recovery",{p_days:4,p_limit:200});
    if(ee) return json({status:"ERROR",error:"ENQUEUE_FAILED",message:ee.message},500);
    const {data:jobs,error:ce}=await db.rpc("cfi_claim_pc_result_recovery",{p_limit:limit,p_lease_minutes:20});
    if(ce) return json({status:"ERROR",error:"CLAIM_FAILED",message:ce.message},500);
    const rows=jobs??[];
    let hints:any[]=[];
    if(rows.length){
      const dates=[...new Set(rows.map((j:any)=>String(j.target_date)))];
      const {data:h,error:he}=await db.from("cfi_result_recovery_url_hints").select("target_date,home_team,away_team,source,source_url,discovered_by").in("target_date",dates);
      if(!he) hints=h??[];
    }
    return json({status:"OK",mode:"RESULT_RECOVERY_PULL",enqueue:enq,count:rows.length,jobs:rows.map((j:any)=>({
      jobId:String(j.snapshot_id),snapshotId:String(j.snapshot_id),targetDate:String(j.target_date),home:String(j.home_team),away:String(j.away_team),snapshotCreatedAt:String(j.snapshot_created_at),attempt:Number(j.attempts),
      task:"FETCH_FINISHED_RESULT_CONSENSUS",required:{independentSources:2,completeHtFt:true,kickoffAgreementMinutes:30,exactCanonicalIdentity:true},
      hints:hints.filter((h:any)=>String(h.target_date)===String(j.target_date)&&String(h.home_team)===String(j.home_team)&&String(h.away_team)===String(j.away_team)).map((h:any)=>({source:h.source,url:h.source_url,discoveredBy:h.discovered_by})),
      submit:{endpoint:"cfi-pc-node-ingest",action:"RESULT_CONSENSUS"}
    }))});
  }

  if(action==="ACK"){
    const snapshotId=String(body?.snapshotId??body?.snapshot_id??"").trim();
    if(!snapshotId) return json({status:"ERROR",error:"SNAPSHOT_ID_REQUIRED"},400);
    const outcome=String(body?.outcome??"RETRY").toUpperCase();
    if(outcome==="RESULT_ACCEPTED"||outcome==="VERIFY_SETTLEMENT"){
      const {error:se}=await db.rpc("cfi_settle_prediction_snapshots");
      if(se) return json({status:"ERROR",error:"SETTLEMENT_RPC_FAILED",message:se.message},500);
    }
    const {data:h,error:he}=await db.from("cfi_prediction_history").select("settlement_status,actual_ht_score,actual_ft_score").eq("snapshot_id",snapshotId).maybeSingle();
    if(he) return json({status:"ERROR",error:"SNAPSHOT_STATUS_READ_FAILED",message:he.message},500);
    if(h?.settlement_status==="SETTLED"){
      const {error:ue}=await db.from("cfi_pc_result_recovery_queue").update({status:"SETTLED",settled_at:new Date().toISOString(),lease_expires_at:null,last_error:null,updated_at:new Date().toISOString()}).eq("snapshot_id",snapshotId);
      if(ue) return json({status:"ERROR",error:"QUEUE_SETTLED_UPDATE_FAILED",message:ue.message},500);
      return json({status:"SETTLED",snapshotId,actualHt:h.actual_ht_score,actualFt:h.actual_ft_score});
    }
    const reason=String(body?.reason??body?.error??outcome??"RESULT_NOT_SETTLED").slice(0,500);
    const {data:q}=await db.from("cfi_pc_result_recovery_queue").select("attempts").eq("snapshot_id",snapshotId).maybeSingle();
    const attempts=Math.max(1,Number(q?.attempts)||1),delay=Math.min(120,Math.max(10,attempts*10));
    const next=new Date(Date.now()+delay*60_000).toISOString();
    const {error:ue}=await db.from("cfi_pc_result_recovery_queue").update({status:"RETRY",lease_expires_at:null,next_attempt_at:next,last_error:reason,updated_at:new Date().toISOString()}).eq("snapshot_id",snapshotId);
    if(ue) return json({status:"ERROR",error:"QUEUE_RETRY_UPDATE_FAILED",message:ue.message},500);
    return json({status:"RETRY",snapshotId,nextAttemptAt:next,reason});
  }

  if(action==="STATUS"){
    const {data,error}=await db.from("cfi_pc_result_recovery_queue").select("status,target_date").gte("target_date",new Date(Date.now()-5*86400000).toISOString().slice(0,10));
    if(error) return json({status:"ERROR",error:"STATUS_READ_FAILED",message:error.message},500);
    const counts:Record<string,number>={}; for(const r of data??[]) counts[String(r.status)]=(counts[String(r.status)]||0)+1;
    return json({status:"OK",mode:"RESULT_RECOVERY_STATUS",counts,total:(data??[]).length});
  }

  return json({status:"ERROR",error:"INVALID_ACTION",allowed:["PULL","ACK","STATUS"]},400);
});