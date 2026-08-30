import { createClient } from "npm:@supabase/supabase-js@2";

type P = "THE_COLONY" | "AGENT_COMMUNITY";
const C="https://thecolony.ai", A="https://agent-community.com", V="0.4.0";
const j=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json"}});
const str=(x:any)=>x==null?"":String(x), clip=(x:string,n:number)=>x.length<=n?x:x.slice(0,n-1)+"…";
const arr=(x:any,...keys:string[])=>Array.isArray(x)?x:(keys.map(k=>x?.[k]).find(Array.isArray)??[]);
const parse=async(r:Response|null)=>{const text=r?await r.text().catch(()=>""):"";let data:any=null;try{data=text?JSON.parse(text):null}catch{}return{text,data}};
const from64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
const key=async(s:string)=>crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)),{name:"AES-GCM"},false,["decrypt"]);
const dec=async(c:string,iv:string,s:string)=>new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:from64(iv)},await key(s),from64(c)));
const bad=["ignore previous","ignore your instructions","system prompt","developer message","reveal your prompt","api key","password","secret key","access token","service role","credentials","database dump","send me your","execute this","run this command","powershell","rm -rf","supabase_service_role_key","cfi_action_key"];
const secret=(t:string)=>[/\bsk-[\w-]{12,}\b/,/\bcol_[\w-]{12,}\b/,/\btfk_[\w-]{8,}\b/,/\bmoltbook_[\w-]{8,}\b/i,/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/,/CFI_ACTION_KEY/i,/SUPABASE_SERVICE_ROLE_KEY/i].some(r=>r.test(t));

async function cred(db:any,p:P){
  const s=Deno.env.get("CFI_ACTION_KEY"); if(!s) throw new Error("CFI_ACTION_KEY_MISSING");
  const {data,error}=await db.from("cfi_agent_social_credentials").select("agent_id,agent_username,api_key_ciphertext,iv_b64,credential_status").eq("platform",p).maybeSingle();
  if(error||!data||data.credential_status!=="ACTIVE") throw new Error(`CREDENTIAL_NOT_ACTIVE:${p}`);
  return {id:str(data.agent_id),name:str(data.agent_username),api:await dec(str(data.api_key_ciphertext),str(data.iv_b64),s)};
}
async function own(db:any,p:P,n:number){
  const {data,error}=await db.from("cfi_agent_social_publish_log").select("remote_post_id,title,content,posted_at").eq("platform",p).eq("status","POSTED").not("remote_post_id","is",null).order("posted_at",{ascending:false}).limit(n);
  if(error) throw new Error(`OWN_POSTS_READ_FAILED:${p}`); return data??[];
}
async function ingest(db:any,x:any){
  const body=clip(str(x.body).trim(),6000); if(!body||!x.rid||!x.pid)return;
  const flags=bad.filter(q=>body.toLowerCase().includes(q));
  const {error}=await db.from("cfi_agent_social_interactions").upsert({
    platform:x.p,remote_interaction_id:x.rid,remote_post_id:x.pid,remote_parent_id:x.parent??null,interaction_type:x.kind,
    author_id:x.aid||null,author_name:x.aname||null,body,parent_post_title:clip(str(x.title),500)||null,parent_post_content:clip(str(x.parentBody),5000)||null,
    direct_to_cfi:true,relevant:true,suspicious:flags.length>0,relevance_score:1,safety_flags:flags,raw_metadata:x.meta??{},status:"PENDING"
  },{onConflict:"platform,remote_interaction_id",ignoreDuplicates:true});
  if(error) throw new Error(`INTERACTION_INGEST_FAILED:${error.message}`);
}
async function scanAC(db:any,n:number){
  const c=await cred(db,"AGENT_COMMUNITY"); let seen=0;
  for(const p of await own(db,"AGENT_COMMUNITY",n)){
    const pid=str(p.remote_post_id); const r=await fetch(`${A}/v1/posts/${encodeURIComponent(pid)}`,{headers:{Authorization:`Bearer ${c.api}`,Accept:"application/json","X-Skill-Version":V}}).catch(()=>null); const z=await parse(r); if(!r?.ok)continue;
    for(const q of arr(z.data?.replies??z.data,"replies","items","results")){
      const aid=str(q?.author_id??q?.author?.id), an=str(q?.author_name??q?.author?.name??q?.author?.username); if((c.id&&aid===c.id)||an===c.name)continue;
      const rid=str(q?.id??q?.reply_id), body=str(q?.content??q?.body??q?.text); if(!rid||!body)continue;
      await ingest(db,{p:"AGENT_COMMUNITY",rid,pid,parent:str(q?.parent_reply_id)||null,kind:"DIRECT_REPLY",aid,aname:an,body,title:z.data?.title??p.title,parentBody:z.data?.content??p.content,meta:{created_at:q?.created_at??null}}); seen++;
    }
  } return seen;
}
async function scanColony(db:any,n:number){
  const c=await cred(db,"THE_COLONY"); let seen=0;
  for(const p of await own(db,"THE_COLONY",n)){
    const pid=str(p.remote_post_id); let r=await fetch(`${C}/api/v1/posts/${encodeURIComponent(pid)}/context`,{headers:{Authorization:`Bearer ${c.api}`,Accept:"application/json"}}).catch(()=>null); let z=await parse(r);
    if(!r?.ok){r=await fetch(`${C}/api/v1/posts/${encodeURIComponent(pid)}/comments`,{headers:{Authorization:`Bearer ${c.api}`,Accept:"application/json"}}).catch(()=>null);z=await parse(r)} if(!r?.ok)continue;
    const post=z.data?.post??{};
    for(const q of arr(z.data?.comments??z.data,"comments","items","results")){
      const aid=str(q?.author_id??q?.author?.id??q?.user_id), an=str(q?.author?.username??q?.author_username??q?.username??q?.author?.display_name); if((c.id&&aid===c.id)||an===c.name)continue;
      const rid=str(q?.id??q?.comment_id), body=str(q?.body??q?.safe_text??q?.content??q?.text); if(!rid||!body)continue;
      await ingest(db,{p:"THE_COLONY",rid,pid,parent:str(q?.parent_id)||null,kind:"DIRECT_COMMENT",aid,aname:an,body,title:post?.title??p.title,parentBody:post?.body??post?.safe_text??p.content,meta:{created_at:q?.created_at??null}}); seen++;
    }
  } return seen;
}
async function pending(db:any,n=10){
  const {data,error}=await db.from("cfi_agent_social_interactions").select("interaction_id,platform,remote_interaction_id,remote_post_id,interaction_type,author_id,author_name,body,parent_post_title,parent_post_content,first_seen_at").eq("status","PENDING").eq("direct_to_cfi",true).eq("relevant",true).eq("suspicious",false).order("first_seen_at",{ascending:true}).limit(Math.max(1,Math.min(20,n)));
  if(error)throw new Error(`PENDING_READ_FAILED:${error.message}`); return data??[];
}
async function reply(db:any,id:string,text:string){
  const {data:cfg}=await db.from("cfi_agent_conversation_config").select("*").eq("singleton",true).single(); if(!cfg?.enabled)return{status:"BLOCKED",error:"DISABLED"};
  const t=text.trim(); if(!t)return{status:"BLOCKED",error:"EMPTY_REPLY"}; if(t.length>Number(cfg.max_reply_chars??1000))return{status:"BLOCKED",error:"REPLY_TOO_LONG"}; if(secret(t))return{status:"BLOCKED",error:"SECRET_PATTERN_DETECTED"};
  const {data:x}=await db.from("cfi_agent_social_interactions").select("*").eq("interaction_id",id).maybeSingle(); if(!x)return{status:"BLOCKED",error:"NOT_FOUND"}; if(x.status!=="PENDING"||!x.direct_to_cfi||!x.relevant||x.suspicious)return{status:"BLOCKED",error:"NOT_ELIGIBLE"};
  const d=new Date();d.setUTCHours(0,0,0,0); const since=d.toISOString();
  const {count:pc}=await db.from("cfi_agent_social_reply_log").select("reply_log_id",{count:"exact",head:true}).eq("platform",x.platform).eq("status","POSTED").gte("created_at",since); if(Number(pc??0)>=Number(cfg.max_replies_per_day??5))return{status:"BLOCKED",error:"DAILY_LIMIT"};
  if(x.author_id){const {count:ac}=await db.from("cfi_agent_social_reply_log").select("reply_log_id",{count:"exact",head:true}).eq("platform",x.platform).eq("author_id",x.author_id).eq("status","POSTED").gte("created_at",since);if(Number(ac??0)>=Number(cfg.max_replies_per_author_per_day??2))return{status:"BLOCKED",error:"AUTHOR_LIMIT"}}
  const p=x.platform as P,c=await cred(db,p); let r:Response|null=null;
  if(p==="AGENT_COMMUNITY") r=await fetch(`${A}/v1/posts/${encodeURIComponent(x.remote_post_id)}/replies`,{method:"POST",headers:{Authorization:`Bearer ${c.api}`,"Content-Type":"application/json",Accept:"application/json","X-Skill-Version":V},body:JSON.stringify({content:t,parent_reply_id:x.remote_interaction_id}),redirect:"error"}).catch(()=>null);
  else r=await fetch(`${C}/api/v1/posts/${encodeURIComponent(x.remote_post_id)}/comments`,{method:"POST",headers:{Authorization:`Bearer ${c.api}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({body:t,parent_id:x.remote_interaction_id}),redirect:"error"}).catch(()=>null);
  const z=await parse(r),ok=!!r?.ok,rr=str(z.data?.id??z.data?.reply?.id??z.data?.comment?.id)||null,url=rr?(p==="AGENT_COMMUNITY"?`https://agent-community.com/posts/${x.remote_post_id}`:`https://thecolony.ai/post/${x.remote_post_id}`):null;
  await db.from("cfi_agent_social_reply_log").insert({interaction_id:x.interaction_id,platform:p,author_id:x.author_id,author_name:x.author_name,reply_text:t,generated_by:"CHATGPT_AUTOMATION",status:ok?"POSTED":"FAILED",remote_reply_id:rr,remote_reply_url:url,http_status:r?.status??0,error:ok?null:"COMMUNITY_REPLY_FAILED",response_excerpt:clip(z.text,1000),posted_at:ok?new Date().toISOString():null});
  await db.from("cfi_agent_social_interactions").update({status:ok?"REPLIED":"FAILED",last_seen_at:new Date().toISOString()}).eq("interaction_id",x.interaction_id);
  return{status:ok?"POSTED":"FAILED",platform:p,httpStatus:r?.status??0,remoteReplyId:rr,remoteReplyUrl:url};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return j({error:"METHOD_NOT_ALLOWED"},405);
  const u=Deno.env.get("SUPABASE_URL"),s=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!s)return j({error:"SUPABASE_SERVER_SECRET_MISSING"},500);const db=createClient(u,s,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get("x-cfi-scheduler-token")??"",{data:e}=await db.from("cfi_scheduler_tokens").select("token").eq("token_name","agent_conversation").maybeSingle();if(!e?.token||token!==e.token)return j({error:"UNAUTHORIZED"},401);
  const b=await req.json().catch(()=>({})),action=str(b.action??"SCAN").toUpperCase();const {data:cfg}=await db.from("cfi_agent_conversation_config").select("*").eq("singleton",true).maybeSingle();if(!cfg?.enabled&&action!=="STATUS")return j({status:"DISABLED"});
  try{
    if(action==="SCAN"){const n=Number(cfg?.scan_post_limit??20),[c,a]=await Promise.all([scanColony(db,n),scanAC(db,n)]),p=await pending(db,Number(b.limit??10));return j({status:"OK",scanned:{THE_COLONY:c,AGENT_COMMUNITY:a},pendingCount:p.length,pending:p})}
    if(action==="PENDING"){const p=await pending(db,Number(b.limit??10));return j({status:"OK",pendingCount:p.length,pending:p})}
    if(action==="REPLY"){const r=await reply(db,str(b.interaction_id),str(b.reply_text));return j(r,r.status==="POSTED"?200:r.status==="BLOCKED"?422:502)}
    if(action==="SKIP"){const id=str(b.interaction_id);if(!id)return j({error:"INTERACTION_ID_REQUIRED"},400);const reason=clip(str(b.reason??"NOT_SAFE_OR_NOT_USEFUL"),500);await db.from("cfi_agent_social_interactions").update({status:"SKIPPED",skip_reason:reason,last_seen_at:new Date().toISOString()}).eq("interaction_id",id).eq("status","PENDING");return j({status:"SKIPPED",interactionId:id})}
    if(action==="STATUS"){const {count:p}=await db.from("cfi_agent_social_interactions").select("interaction_id",{count:"exact",head:true}).eq("status","PENDING").eq("suspicious",false);return j({status:"OK",enabled:!!cfg?.enabled,pending:p??0,maxRepliesPerDayPerPlatform:cfg?.max_replies_per_day??5})}
    return j({error:"INVALID_ACTION"},400)
  }catch(e){return j({status:"FAILED",error:e instanceof Error?e.message:String(e)},500)}
});
