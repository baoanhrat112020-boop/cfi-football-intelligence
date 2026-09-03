import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION='CFI_PC_BRIDGE_MAINTENANCE_V1';
const BUCKET='cfi-pc-bridge-v1';
const HEARTBEAT='runtime/pc-heartbeat.json';
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json'}});
const stamp=()=>new Date().toISOString().slice(0,10);

async function readJson(db:any,path:string){
  const d=await db.storage.from(BUCKET).download(path);
  if(d.error||!d.data)return null;
  try{return JSON.parse(await d.data.text());}catch{return {__corrupt:true};}
}

async function listUrgent(db:any){
  const out:any[]=[];
  for(let offset=0;offset<2000;offset+=100){
    const l=await db.storage.from(BUCKET).list('urgent',{limit:100,offset,sortBy:{column:'created_at',order:'asc'}});
    if(l.error)throw l.error;
    const rows=(l.data??[]).filter((x:any)=>String(x?.name??'').endsWith('.json'));
    out.push(...rows);
    if(rows.length<100)break;
  }
  return out;
}

async function moveSafe(db:any,from:string,to:string){
  const r=await db.storage.from(BUCKET).move(from,to);
  if(!r.error)return {ok:true};
  if(/already|exists|duplicate/i.test(String(r.error?.message??''))){
    const rm=await db.storage.from(BUCKET).remove([from]);
    if(rm.error)throw rm.error;
    return {ok:true,deduped:true};
  }
  throw r.error;
}

Deno.serve(async req=>{
  if(req.method!=='POST')return json({status:'ERROR',error:'POST_REQUIRED'},405);
  const su=Deno.env.get('SUPABASE_URL'),sr=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!su||!sr)return json({status:'ERROR',error:'SERVER_SECRET_MISSING'},500);
  const db=createClient(su,sr,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=req.headers.get('x-cfi-forward-token')??'';
  const auth=await db.from('cfi_forward_automation_auth').select('token').eq('singleton',true).maybeSingle();
  if(auth.error||!auth.data?.token)return json({status:'ERROR',error:'AUTOMATION_AUTH_UNAVAILABLE'},500);
  if(token!==String(auth.data.token))return json({status:'UNAUTHORIZED'},401);
  const body=await req.json().catch(()=>({}));
  const maxPending=Math.max(1,Math.min(60,Number(body?.maxPending??30)||30));
  const rows=await listUrgent(db);
  const now=Date.now();
  const candidates:any[]=[];
  const quarantine:any[]=[];
  for(const x of rows){
    const name=String(x?.name??'');
    const path=`urgent/${name}`;
    const p=await readJson(db,path);
    if(!p||p.__corrupt){quarantine.push({path,name,kind:'corrupt'});continue;}
    const fixture=p?.fixture??{};
    const kickoff=Date.parse(String(fixture?.kickoffIso??''));
    const qstatus=String(p?.status??'').toUpperCase();
    const fstatus=String(fixture?.status??'').toLowerCase();
    if(!Number.isFinite(kickoff)){quarantine.push({path,name,kind:'invalid'});continue;}
    if(qstatus!=='PENDING'||!['scheduled','notstarted','pre'].includes(fstatus)){quarantine.push({path,name,kind:'terminal'});continue;}
    if(kickoff<=now+60_000){quarantine.push({path,name,kind:'expired'});continue;}
    candidates.push({path,name,kickoff,queuedAt:String(p?.queuedAt??''),queueId:String(p?.queueId??'')});
  }
  candidates.sort((a,b)=>a.kickoff-b.kickoff);
  for(const x of candidates.slice(maxPending))quarantine.push({...x,kind:'overflow'});
  const moved:{kind:string;from:string;to:string}[]=[];
  for(const q of quarantine){
    const to=`quarantine/${q.kind}/${stamp()}/${q.name}`;
    await moveSafe(db,q.path,to);
    moved.push({kind:q.kind,from:q.path,to});
  }
  const hb=await readJson(db,HEARTBEAT);
  const hbAge=hb&&!hb.__corrupt?now-Date.parse(String(hb?.readyAt??'')):NaN;
  const heartbeatAvailable=Number.isFinite(hbAge)&&hbAge>=0&&hbAge<10*60_000;
  const remaining=Math.max(0,candidates.length-Math.max(0,candidates.length-maxPending));
  const byKind=moved.reduce((a:any,x:any)=>{a[x.kind]=(a[x.kind]??0)+1;return a;},{});
  return json({status:'OK',version:VERSION,scanned:rows.length,moved:moved.length,byKind,pendingBefore:candidates.length,pendingAfter:remaining,maxPending,heartbeat:{available:heartbeatAvailable,nodeId:hb?.nodeId??null,readyAt:hb?.readyAt??null,ageMs:Number.isFinite(hbAge)?hbAge:null}});
});