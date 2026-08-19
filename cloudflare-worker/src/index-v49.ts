import base from './index-v48.ts';
import { buildFutureSixPrediction, FUTURE_SIX_VERSION } from '../../src/prediction/future-six.ts';

const DUAL_VERSION='CFI_DUAL_SHADOW_V0.1';
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
function comparison(production:any,futureSix:any){
  return Object.fromEntries(Object.entries(futureSix.marketSignals).map(([market,value])=>{
    const current=Number(production?.markets?.[market]?.final);
    const challenger=Number(value);
    return [market,{historicalProduction:Number.isFinite(current)?current:null,futureSix:challenger,delta:Number.isFinite(current)?challenger-current:null}];
  }));
}

const UI=`<section id="futureSixPanel" style="display:none;margin:14px 0;background:#101c2e;border:1px solid #624c8d;border-radius:12px;padding:14px;color:#eef5ff"><div style="font-weight:900;color:#c5a6ff;margin-bottom:4px">🔮 MODEL B — DỰ ĐOÁN 6 YẾU TỐ TƯƠNG LAI</div><div style="font-size:12px;color:#9aabc0;margin-bottom:12px">FUTURE SIX CHALLENGER · shadow mode · không ghi đè Model A</div><div id="futureSixFactors" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"></div><div style="font-weight:800;margin:14px 0 8px">MODEL COMPARISON — 4 MARKET BÀN THẮNG</div><div id="futureSixMarkets" style="display:grid;gap:6px"></div><div style="margin-top:12px;font-size:12px;color:#ffc76b">Top-3 HT/FT challenger: NOT YET MODELED — không sao chép Top-3 của Model A.</div></section>`;
const SCRIPT=`<script>(()=>{const nativeFetch=window.fetch.bind(window);const pct=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'%':'—';const names={GOAL_TEMPO:'Goal Tempo',DOMINANCE:'Dominance',COLLAPSE_RISK:'Collapse Risk',COMEBACK_SURGE:'Comeback / Surge',VOLATILITY:'Volatility',EXTREME_SCORE_PRESSURE:'Extreme Score Pressure'};function render(d){const fs=d?.predictionModels?.futureSix;if(!fs)return;futureSixPanel.style.display='block';futureSixFactors.innerHTML=Object.entries(fs.factors||{}).map(([k,v])=>'<div style="background:#0b1627;border:1px solid #283a55;border-radius:9px;padding:10px"><div style="font-size:11px;color:#9aabc0">'+(names[k]||k)+'</div><b style="font-size:20px;color:#b99cff">'+pct(v.probability)+'</b><div style="font-size:11px;color:#8193aa">'+(v.confidence||'—')+' · n='+(v.sampleSize??'—')+'</div></div>').join('');futureSixMarkets.innerHTML=Object.entries(d.modelComparison||{}).map(([k,v])=>'<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;background:#0b1627;padding:8px;border-radius:8px"><b>'+k+'</b><span>Model A '+pct(v.historicalProduction)+'</span><span style="color:#c5a6ff">Model B '+pct(v.futureSix)+'</span></div>').join('')}window.fetch=async(...args)=>{const res=await nativeFetch(...args);try{const u=typeof args[0]==='string'?args[0]:args[0]?.url||'';if(String(u).includes('/api/predict'))res.clone().json().then(render).catch(()=>{})}catch{}return res}})();</script>`;

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/api/predict'&&request.method==='POST'){
    const raw=await request.text();
    const forwarded=new Request(request.url,{method:'POST',headers:request.headers,body:raw});
    const productionResponse=await base.fetch(forwarded,env,ctx);
    const payload=await readJson(productionResponse);
    if(!productionResponse.ok||!payload||typeof payload!=='object')return productionResponse;
    let input:any={};try{input=JSON.parse(raw)}catch{}
    const production=unwrap(payload);
    const home=String(input?.home||production?.target?.home||'').trim();
    const away=String(input?.away||production?.target?.away||'').trim();
    const targetDate=String(input?.target_date||input?.matchDate||production?.target?.date||production?.target?.targetDate||'').slice(0,10)||undefined;
    if(!home||!away)return productionResponse;
    try{
      const [homePayload,awayPayload,h2hPayload]=await evidence(request,env,ctx,home,away);
      const futureSix=buildFutureSixPrediction({home,away,targetDate,homePayload,awayPayload,h2hPayload});
      return Response.json({
        ...production,
        audit:payload?.audit??production?.audit,
        dualModel:{version:DUAL_VERSION,executionMode:'PARALLEL_SHADOW',productionAuthoritative:true,challengerPersisted:false},
        predictionModels:{
          historicalProduction:{predictionType:'HISTORICAL_PRODUCTION',label:'DỰ ĐOÁN KIỂU CŨ — HISTORICAL PRODUCTION',authoritative:true,version:production?.engine??production?.version??'CURRENT_PRODUCTION'},
          futureSix:{predictionType:'FUTURE_SIX_FACTORS',label:'DỰ ĐOÁN 6 YẾU TỐ TƯƠNG LAI — CHALLENGER',authoritative:false,...futureSix,top3HT:'NOT_YET_MODELED',top3FT:'NOT_YET_MODELED'},
        },
        modelComparison:comparison(production,futureSix),
      },{status:productionResponse.status});
    }catch(e:any){
      return Response.json({...production,audit:payload?.audit??production?.audit,dualModel:{version:DUAL_VERSION,executionMode:'PRODUCTION_ONLY_FALLBACK',productionAuthoritative:true},predictionModels:{historicalProduction:{predictionType:'HISTORICAL_PRODUCTION',label:'DỰ ĐOÁN KIỂU CŨ — HISTORICAL PRODUCTION',authoritative:true},futureSix:{predictionType:'FUTURE_SIX_FACTORS',label:'DỰ ĐOÁN 6 YẾU TỐ TƯƠNG LAI — CHALLENGER',authoritative:false,status:'ERROR',version:FUTURE_SIX_VERSION,error:String(e?.message||e)}}},{status:productionResponse.status});
    }
  }
  if(url.pathname==='/health'){
    const res=await base.fetch(request,env,ctx);const body=await readJson(res);return Response.json({...body,dualModel:true,dualModelVersion:DUAL_VERSION,futureSixVersion:FUTURE_SIX_VERSION,challengerMode:'SHADOW'});
  }
  const res=await base.fetch(request,env,ctx);
  if(url.pathname!=='/'||!String(res.headers.get('content-type')).includes('text/html'))return res;
  let html=await res.text();html=html.replace('</body>',UI+SCRIPT+'</body>');return new Response(html,{status:res.status,headers:res.headers});
}} satisfies ExportedHandler<Env>;
