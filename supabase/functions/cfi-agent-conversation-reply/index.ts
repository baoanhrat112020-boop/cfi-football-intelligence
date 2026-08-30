import { createClient } from "npm:@supabase/supabase-js@2";

type P="THE_COLONY"|"AGENT_COMMUNITY";
const C="https://thecolony.ai",A="https://agent-community.com",V="0.4.0";
const J=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json"}});
const S=(x:any)=>x==null?"":String(x),clip=(x:string,n:number)=>x.length<=n?x:x.slice(0,n-1)+"…";
const F=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
const K=async(s:string)=>crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)),{name:"AES-GCM"},false,["decrypt"]);
const D=async(c:string,iv:string,s:string)=>new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:F(iv)},await K(s),F(c)));
const PJSON=async(r:Response|null)=>{const text=r?await r.text().catch(()=>""):"";let data:any=null;try{data=text?JSON.parse(text):null}catch{}return{text,data}};
const secret=(t:string)=>[/\bsk-[\w-]{12,}\b/,/\bcol_[\w-]{12,}\b/,/\btfk_[\w-]{8,}\b/,/\bmoltbook_[\w-]{8,}\b/i,/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/,/CFI_ACTION_KEY/i,/SUPABASE_SERVICE_ROLE_KEY/i].some(r=>r.test(t));

async function cred(db:any,p:P){
  const master=Deno.env.get("CFI_ACTION_KEY");if(!master)throw new Error("CFI_ACTION_KEY_MISSING");
  const {data,error}=await db.from("cfi_agent_social_credentials").select("agent_id,agent_username,api_key_ciphertext,iv_b64,credential_status").eq("platform",p).maybeSingle();
  if(error||!data||data.credential_status!=="ACTIVE")throw new Error(`CREDENTIAL_NOT_ACTIVE:${p}`);
  return{id:S(data.agent_id),name:S(data.agent_username),api:await D(S(data.api_key_ciphertext),S(data.iv_b64),master)};
}
async function colonyJwt(api:string){
  const r=await fetch(`${C}/api/v1/auth/token`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({api_key:api}),redirect:"error"}).catch(()=>null),z=await PJSON(r);
  if(!r?.ok)throw new Error(`COLONY_TOKEN_FAILED:${r?.status??0}`);const jwt=S(z.data?.access_token).trim();if(!jwt)throw new Error("COLONY_ACCESS_TOKEN_MISSING");return jwt;
}

Deno.serve(async req=>{
  if(req.method!=="POST")return J({error:"METHOD_NOT_ALLOWED"},405);
  const u=Deno.env.get("SUPABASE_URL"),role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!role)return J({error:"SUPABASE_SERVER_SECRET_MISSING"},500);const db=createClient(u,role,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get("x-cfi-scheduler-token")??"",{data:e}=await db.from("cfi_scheduler_tokens").select("token").eq("token_name","agent_conversation").maybeSingle();if(!e?.token||token!==e.token)return J({error:"UNAUTHORIZED"},401);
  const b=await req.json().catch(()=>({})),id=S(b.interaction_id),text=S(b.reply_text).trim();if(!id)return J({error:"INTERACTION_ID_REQUIRED"},400);
  const {data:cfg}=await db.from("cfi_agent_conversation_config").select("*").eq("singleton",true).single();if(!cfg?.enabled)return J({status:"BLOCKED",error:"DISABLED"},422);if(!text)return J({status:"BLOCKED",error:"EMPTY_REPLY"},422);if(text.length>Number(cfg.max_reply_chars??1000))return J({status:"BLOCKED",error:"REPLY_TOO_LONG"},422);if(secret(text))return J({status:"BLOCKED",error:"SECRET_PATTERN_DETECTED"},422);
  const {data:x}=await db.from("cfi_agent_social_interactions").select("*").eq("interaction_id",id).maybeSingle();if(!x)return J({status:"BLOCKED",error:"NOT_FOUND"},404);if(x.status!=="PENDING"||!x.direct_to_cfi||!x.relevant||x.suspicious)return J({status:"BLOCKED",error:"NOT_ELIGIBLE"},422);
  const d=new Date();d.setUTCHours(0,0,0,0);const since=d.toISOString();
  const {count:pc}=await db.from("cfi_agent_social_reply_log").select("reply_log_id",{count:"exact",head:true}).eq("platform",x.platform).eq("status","POSTED").gte("created_at",since);if(Number(pc??0)>=Number(cfg.max_replies_per_day??5))return J({status:"BLOCKED",error:"DAILY_LIMIT"},429);
  if(x.author_id){const {count:ac}=await db.from("cfi_agent_social_reply_log").select("reply_log_id",{count:"exact",head:true}).eq("platform",x.platform).eq("author_id",x.author_id).eq("status","POSTED").gte("created_at",since);if(Number(ac??0)>=Number(cfg.max_replies_per_author_per_day??2))return J({status:"BLOCKED",error:"AUTHOR_LIMIT"},429)}
  const p=x.platform as P,c=await cred(db,p);let r:Response|null=null;
  if(p==="THE_COLONY"){
    const jwt=await colonyJwt(c.api);
    r=await fetch(`${C}/api/v1/posts/${encodeURIComponent(x.remote_post_id)}/comments`,{method:"POST",headers:{Authorization:`Bearer ${jwt}`,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({body:text,parent_id:x.remote_interaction_id}),redirect:"error"}).catch(()=>null);
  }else{
    r=await fetch(`${A}/v1/posts/${encodeURIComponent(x.remote_post_id)}/replies`,{method:"POST",headers:{Authorization:`Bearer ${c.api}`,"content-type":"application/json",accept:"application/json","X-Skill-Version":V},body:JSON.stringify({content:text,parent_reply_id:x.remote_interaction_id}),redirect:"error"}).catch(()=>null);
  }
  const z=await PJSON(r),ok=!!r?.ok,rr=S(z.data?.id??z.data?.reply?.id??z.data?.comment?.id)||null,url=rr?(p==="THE_COLONY"?`https://thecolony.ai/post/${x.remote_post_id}`:`https://agent-community.com/posts/${x.remote_post_id}`):null;
  const {error:le}=await db.from("cfi_agent_social_reply_log").insert({interaction_id:x.interaction_id,platform:p,author_id:x.author_id,author_name:x.author_name,reply_text:text,generated_by:"CHATGPT_AUTOMATION",status:ok?"POSTED":"FAILED",remote_reply_id:rr,remote_reply_url:url,http_status:r?.status??0,error:ok?null:"COMMUNITY_REPLY_FAILED",response_excerpt:clip(z.text,1000),posted_at:ok?new Date().toISOString():null});if(le)return J({status:"FAILED",error:`REPLY_LOG_FAILED:${le.message}`},500);
  await db.from("cfi_agent_social_interactions").update({status:ok?"REPLIED":"FAILED",last_seen_at:new Date().toISOString()}).eq("interaction_id",id);
  return J({status:ok?"POSTED":"FAILED",platform:p,httpStatus:r?.status??0,remoteReplyId:rr,remoteReplyUrl:url},ok?200:502);
});
