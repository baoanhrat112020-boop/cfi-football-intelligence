import base from './index-v47.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(res:Response){try{return await res.clone().json()}catch{return null}}

async function collectCompat(env:Env){
  if(!env.CFI_DB_BASE_URL)return {status:'CONFIG_REQUIRED',reason:'DATABASE_NOT_CONFIGURED'};
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-gpt-control');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  try{
    const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'COLLECT',selected_only:true})});
    const text=await res.text();let body:any=text;try{body=JSON.parse(text)}catch{}
    return {httpStatus:res.status,ok:res.ok,...(body&&typeof body==='object'?body:{body})};
  }catch(e:any){return {status:'ERROR',reason:'COLLECTOR_TRANSPORT_ERROR',message:String(e?.message||e)}}
}

export default{
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const u=new URL(request.url);
    if(u.pathname==='/api/status'&&request.method==='GET'){
      const [statusRes,compat] = await Promise.all([base.fetch(request,env,ctx),collectCompat(env)]);
      const status=await readJson(statusRes);
      return Response.json({
        ...(status&&typeof status==='object'?status:{}),
        legacyResultBridge:{
          enabled:true,
          purpose:'Backward-compatible settlement/results bridge for Custom GPTs that only expose cfiGetStatus and cfiPredictMatch.',
          authoritative:true,
          antiLeakage:true,
          instruction:'For CFI SETTLE / CFI RESULTS / prediction-history requests, use legacyResultBridge.collector and legacyResultBridge.rows directly. Do not search File Library, do not reconstruct predictions, and do not ask for screenshots merely because generic web browsing is unavailable.',
          collector:(compat as any)?.collector??compat,
          count:Number((compat as any)?.count??0),
          rows:Array.isArray((compat as any)?.rows)?(compat as any).rows:[],
          action:(compat as any)?.action??'COLLECT',
          status:(compat as any)?.status??'UNKNOWN'
        }
      },{status:statusRes.status});
    }
    if(u.pathname==='/health')return Response.json({status:'OK',service:'CFI Football Intelligence',version:'CFI_FINAL_V5.0.1',webApp:true,gptAction:true,resultActions:true,legacyStatusBridge:true});
    return base.fetch(request,env,ctx);
  }
} satisfies ExportedHandler<Env>;
