import base from './index-v46';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function callControl(env:Env, action:string, payload:Record<string,unknown>={}){
  if(!env.CFI_DB_BASE_URL)return Response.json({status:'CONFIG_REQUIRED',message:'CFI_DB_BASE_URL missing'},{status:503});
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-gpt-control');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  const text=await res.text();
  let body:any=text;try{body=JSON.parse(text)}catch{}
  return Response.json(body,{status:res.status});
}

function queryPayload(url:URL){
  const target_date=url.searchParams.get('target_date')||undefined;
  const home=url.searchParams.get('home')||undefined;
  const away=url.searchParams.get('away')||undefined;
  const settlement_status=url.searchParams.get('settlement_status')||undefined;
  const selected_only=url.searchParams.get('selected_only')!=='false';
  return{target_date,home,away,settlement_status,selected_only};
}

export default{
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const u=new URL(request.url);
  if(u.pathname==='/api/prediction-history'&&request.method==='GET')return callControl(env,'HISTORY',queryPayload(u));
  if(u.pathname==='/api/results'&&request.method==='GET')return callControl(env,'RESULTS',queryPayload(u));
  if(u.pathname==='/api/collect-results'&&request.method==='POST'){
    let body:any={};try{body=await request.json()}catch{}
    return callControl(env,'COLLECT',body&&typeof body==='object'?body:{});
  }
  if(u.pathname==='/health')return Response.json({status:'OK',service:'CFI Football Intelligence',version:'CFI_FINAL_V5.0.1',webApp:true,gptAction:true,resultActions:true});
  return base.fetch(request,env,ctx);
 }
} satisfies ExportedHandler<Env>;
