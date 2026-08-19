import base from './index-v48.ts';
import { buildPrediction, FINAL_VERSION, MARKET_CODES, PRIMARY_TARGETS } from '../../src/prediction/final-engine.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.0';
type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

function unwrap(x:any){return x?.body??x}
async function readJson(res:Response){try{return await res.clone().json()}catch{return null}}
async function internal(request:Request,env:Env,ctx:ExecutionContext,path:string){
  return base.fetch(new Request(new URL(path,request.url),{method:'GET',headers:{accept:'application/json'}}),env,ctx);
}
async function evidence(request:Request,env:Env,ctx:ExecutionContext,home:string,away:string){
  const [hr,ar,xr]=await Promise.all([
    internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(home)}`),
    internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(away)}`),
    internal(request,env,ctx,`/api/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`),
  ]);
  return Promise.all([readJson(hr),readJson(ar),readJson(xr)]);
}

async function recordAudit(env:Env,input:any,prediction:any){
  const date=String(input?.target_date||input?.matchDate||prediction?.target?.date||'').slice(0,10);
  const home=String(input?.home||prediction?.target?.home||'').trim();
  const away=String(input?.away||prediction?.target?.away||'').trim();
  if(!date)return{status:'SKIPPED',reason:'TARGET_DATE_REQUIRED'};
  if(!env.CFI_DB_BASE_URL)return{status:'SKIPPED',reason:'DATABASE_NOT_CONFIGURED'};
  const auditUrl=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-prediction-audit');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  try{
    const res=await fetch(auditUrl,{method:'POST',headers,body:JSON.stringify({action:'SNAPSHOT',target_date:date,home,away,language:String(input?.language||prediction?.language||'vi'),source:'GPT_ACTION',prediction})});
    const text=await res.text();let body:any=text;try{body=JSON.parse(text)}catch{}
    return{status:res.ok?'RECORDED':'ERROR',httpStatus:res.status,body};
  }catch(e:any){return{status:'ERROR',message:String(e?.message||e)}}
}

function sixTargetMatrix(prediction:any){
  const threshold=Object.fromEntries(MARKET_CODES.map((market)=>{
    const row=prediction?.markets?.[market]??{};
    return[market,{methodA:row.methodA??null,methodB:row.methodB??null,final:row.final??null,confidence:row.confidence??null,hits:row.hits??null,eligible:row.eligible??null}];
  }));
  const ht=prediction?.scoreline?.ht??{};
  const ft=prediction?.scoreline?.ft??{};
  const scoreline={
    'Top-3 HT':{methodA:ht.methodA??null,methodB:ht.methodB??null,final:ht.final??null},
    'Top-3 FT':{methodA:ft.methodA??null,methodB:ft.methodB??null,final:ft.final??null},
  };
  const allThreshold=MARKET_CODES.every(m=>['methodA','methodB','final'].every(k=>Number.isFinite(Number((threshold as any)[m]?.[k]))));
  const validTop=(x:any)=>Array.isArray(x)&&x.length===3&&x.every((r:any)=>typeof r?.score==='string'&&Number.isFinite(Number(r?.probability)));
  const allScoreline=['Top-3 HT','Top-3 FT'].every(t=>['methodA','methodB','final'].every(k=>validTop((scoreline as any)[t]?.[k])));
  return{
    contract:'CFI_2_METHODS_X_6_TARGETS_V1',
    primaryTargets:[...PRIMARY_TARGETS],
    methods:['Method A','Method B','FINAL'],
    threshold,
    scoreline,
    verification:{thresholdComplete:allThreshold,scorelineComplete:allScoreline,complete:allThreshold&&allScoreline},
  };
}

const UI=`<section id="sixTargetPanel" style="display:none;margin:14px 0;background:#101c2e;border:1px solid #624c8d;border-radius:12px;padding:14px;color:#eef5ff"><div style="font-weight:900;color:#c5a6ff;margin-bottom:4px">🧠 CFI — 2 METHODS × 6 TARGETS</div><div style="font-size:12px;color:#9aabc0;margin-bottom:12px">Method A · Method B Future Six · FINAL</div><div id="sixThreshold" style="display:grid;gap:6px"></div><div style="font-weight:800;margin:14px 0 8px">TOP-3 HT / FT — A · B · FINAL</div><div id="sixScoreline" style="display:grid;gap:8px"></div></section>`;
const SCRIPT=`<script>(()=>{const nativeFetch=window.fetch.bind(window);const pct=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'%':'—';const scores=x=>Array.isArray(x)?x.map(r=>r.score+' '+pct(r.probability)).join(' · '):'—';function render(d){const m=d?.sixTargetMatrix;if(!m)return;sixTargetPanel.style.display='block';sixThreshold.innerHTML=Object.entries(m.threshold||{}).map(([k,v])=>'<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;background:#0b1627;padding:8px;border-radius:8px"><b>'+k+'</b><span>A '+pct(v.methodA)+'</span><span style="color:#c5a6ff">B '+pct(v.methodB)+'</span><span>FINAL '+pct(v.final)+'</span></div>').join('');sixScoreline.innerHTML=Object.entries(m.scoreline||{}).map(([k,v])=>'<div style="background:#0b1627;padding:9px;border-radius:8px"><b>'+k+'</b><div>A: '+scores(v.methodA)+'</div><div style="color:#c5a6ff">B: '+scores(v.methodB)+'</div><div>FINAL: '+scores(v.final)+'</div></div>').join('')}window.fetch=async(...args)=>{const res=await nativeFetch(...args);try{const u=typeof args[0]==='string'?args[0]:args[0]?.url||'';if(String(u).includes('/api/predict'))res.clone().json().then(render).catch(()=>{})}catch{}return res}})();</script>`;

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/api/predict'&&request.method==='POST'){
    let input:any={};try{input=await request.clone().json()}catch{}
    const home=String(input?.home||'').trim();
    const away=String(input?.away||'').trim();
    const targetDate=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
    if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
    try{
      const [homePayload,awayPayload,h2hPayload]=await evidence(request,env,ctx,home,away);
      const prediction=buildPrediction({home,away,targetDate,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload});
      const matrix=sixTargetMatrix(prediction);
      if(!matrix.verification.complete){
        return Response.json({...prediction,sixTargetMatrix:matrix,runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION},status:'RUNTIME_CONTRACT_ERROR',error:'INCOMPLETE_2_METHODS_X_6_TARGETS'},{status:500});
      }
      const audit=await recordAudit(env,input,prediction);
      return Response.json({...prediction,sixTargetMatrix:matrix,runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR',primaryTargets:6},audit});
    }catch(e:any){
      return Response.json({status:'ERROR',error:'PREDICTION_RUNTIME_FAILURE',message:String(e?.message||e),runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION}},{status:500});
    }
  }
  if(url.pathname==='/api/status'&&request.method==='GET'){
    const res=await base.fetch(request,env,ctx);const body=await readJson(res);
    return Response.json({...unwrap(body),runtime:{...(unwrap(body)?.runtime??{}),version:RUNTIME_VERSION,engine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR',primaryTargets:6,sixTargetContract:'CFI_2_METHODS_X_6_TARGETS_V1'}},{status:res.status});
  }
  if(url.pathname==='/health'){
    const res=await base.fetch(request,env,ctx);const body=await readJson(res);
    return Response.json({...body,status:'OK',service:'CFI Football Intelligence',version:FINAL_VERSION,runtimeVersion:RUNTIME_VERSION,primaryTargets:6,sixTargetContract:'CFI_2_METHODS_X_6_TARGETS_V1'});
  }
  const res=await base.fetch(request,env,ctx);
  if(url.pathname!=='/'||!String(res.headers.get('content-type')).includes('text/html'))return res;
  let html=await res.text();html=html.replace('</body>',UI+SCRIPT+'</body>');return new Response(html,{status:res.status,headers:res.headers});
}} satisfies ExportedHandler<Env>;
