import base from './index-live-router.ts';
import { scorePrediction, CFI_DISCOVERY_VERSION, discoverFixtures, localDateNow, type DiscoveredFixture } from '../../src/discovery/cfi-discovery.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string};

type DiscoveryRows={provider:string;sourceUrl:string|null;rows:FeedRow[];source:string};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function feed(input:any,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return null;
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-discovery-feed');
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({target_date:input.target_date,timezone:input.timezone,start_time:input.start_time,end_time:input.end_time,limit:input.scan_limit??40})});
  const b:any=await readJson(r);if(!r.ok||b?.status!=='OK'||!Array.isArray(b?.rows))return null;return b;
}

async function resolveRows(input:any,env:Env):Promise<DiscoveryRows>{
  const f=await feed(input,env);
  if(f?.rows?.length)return{provider:'CFI_FORWARD_CAPTURE',sourceUrl:null,rows:f.rows,source:'EXISTING_FORWARD_MARKET_CAPTURES'};
  const d=await discoverFixtures({targetDate:input.target_date,timeZone:input.timezone,startTime:input.start_time??null,endTime:input.end_time??null});
  const rows:FeedRow[]=d.rows.map((r:DiscoveredFixture)=>({provider:r.provider,providerId:r.providerId,home:r.home,away:r.away,competition:r.competition,country:r.country,kickoffIso:r.kickoffIso,kickoffLocal:r.kickoffLocal,targetDate:r.targetDate,status:r.status}));
  return{provider:d.provider,sourceUrl:d.sourceUrl,rows,source:'REAL_PROVIDER_DISCOVERY'};
}

async function predict(row:FeedRow,env:Env,ctx:ExecutionContext){
  const req=new Request('https://cfi.local/api/predict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:row.home,away:row.away,target_date:row.targetDate,language:'vi'})});
  const res=await base.fetch(req,env,ctx),body:any=await readJson(res);return{res,body};
}

function diagnose(row:FeedRow,p:{res:Response;body:any},score:any){
  const predictionStatus=String(p.body?.status??'UNKNOWN');
  const strictPrior=p.body?.strictPrior?.verified===true||p.body?.strictPriorAudit?.evidence?.verified===true;
  let failureLayer:string|null=null,reasonCode:string|null=null;
  if(!p.res.ok){failureLayer='PREDICT_HTTP';reasonCode='PREDICT_HTTP_FAIL';}
  else if(predictionStatus!=='SUCCESS'&&predictionStatus!=='DATA_READY'){
    failureLayer='PREDICTION';reasonCode=predictionStatus==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':'PREDICTION_NOT_SUCCESS';
  }else if(!strictPrior){failureLayer='STRICT_PRIOR';reasonCode='STRICT_PRIOR_NOT_VERIFIED';}
  else if(p.body?.consistencyGuard?.status&&p.body.consistencyGuard.status!=='PASS'){failureLayer='CONSISTENCY';reasonCode='CONSISTENCY_FAIL';}
  else if(!score?.eligible){failureLayer='RANKING';reasonCode=score?.reason??'NO_RANKING';}
  return{match:`${row.home} vs ${row.away}`,provider:row.provider,providerId:row.providerId,predictionHttpStatus:p.res.status,predictionStatus,strictPrior,canonicalIdentity:strictPrior,failureLayer,reasonCode,rawError:p.body?.error??null};
}

async function discovery(request:Request,env:Env,ctx:ExecutionContext){
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});}
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh'),targetDate=String(input?.target_date??localDateNow(timeZone)).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});
  const maxMatches=Math.max(1,Math.min(10,Number(input?.max_matches??5)||5)),scanLimit=Math.max(maxMatches,Math.min(40,Number(input?.scan_limit??24)||24));
  const resolved=await resolveRows({...input,target_date:targetDate,timezone:timeZone,scan_limit:scanLimit},env),rows=resolved.rows.slice(0,scanLimit);
  const evaluated:any[]=[],diagnostics:any[]=[];
  let predictionAttempts=0,predictionSuccess=0;
  for(let i=0;i<rows.length;i+=6){
    const chunk=rows.slice(i,i+6);predictionAttempts+=chunk.length;
    const results=await Promise.all(chunk.map(async row=>{const p=await predict(row,env,ctx),score=scorePrediction(p.body);return{row,p,score};}));
    for(const {row,p,score} of results){
      const diag=diagnose(row,p,score),status=String(p.body?.status??'');
      if(p.res.ok&&(status==='SUCCESS'||status==='DATA_READY'))predictionSuccess++;
      diagnostics.push(diag);
      if(p.res.ok&&(status==='SUCCESS'||status==='DATA_READY')&&score.eligible)evaluated.push({row,body:p.body,score});
    }
  }
  evaluated.sort((a,b)=>Number(b.score.score)-Number(a.score.score));
  const selected=evaluated.slice(0,maxMatches),board=selected.map(({row,body,score})=>({
    match:`${row.home} vs ${row.away}`,home:row.home,away:row.away,competition:row.competition,country:row.country,kickoff:row.kickoffIso,kickoffLocal:row.kickoffLocal,provider:row.provider,providerId:row.providerId,
    bestMarket:score.best?.market??null,modelProbability:score.best?.probability??null,fairOdds:score.best?.fairOdds??null,selectionScore:score.score,confidence:score.best?.confidence??null,
    status:score.best&&score.best.probability>=.6&&!['LOW','VERY_LOW'].includes(String(score.best.confidence??'').toUpperCase())?'ACTIONABLE_MODEL_SIGNAL':'WATCH',valueStatus:'NOT_ASSESSED_NO_BOOKMAKER_ODDS',
    strictPrior:body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true,consistency:body?.consistencyGuard?.status??null,multiMarketStatus:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,multiMarketDecisionUse:false,prediction:body
  }));
  const actionable=board.filter(r=>r.status==='ACTIONABLE_MODEL_SIGNAL'),insufficient=diagnostics.filter(d=>d.reasonCode==='INSUFFICIENT_DATA').length,blocked=diagnostics.filter(d=>d.reasonCode&&d.reasonCode!=='INSUFFICIENT_DATA').length;
  const canonicalized=diagnostics.filter(d=>d.canonicalIdentity===true).length;
  return Response.json({status:'OK',action:'CFI_DISCOVERY',version:CFI_DISCOVERY_VERSION,targetDate,timeZone,provider:resolved.provider,sourceUrl:resolved.sourceUrl,counts:{fixturesDiscovered:resolved.rows.length,canonicalized,scanned:rows.length,predictionAttempts,predictionSuccess,fullPredictionsExecuted:predictionAttempts,eligible:evaluated.length,insufficient,blocked,recommended:actionable.length,actionable:actionable.length,shadowMarkets:board.filter(r=>r.multiMarketDecisionUse===false).length},diagnostics,rejections:diagnostics.filter(d=>d.reasonCode),rules:{strictPriorRequired:true,noForcedBet:true,bookmakerOddsRequiredForValueClaim:true,shadowDecisionUse:false},board,topPicks:actionable.slice(0,3),final:actionable.length?'MODEL_SHORTLIST_READY':board.length?'WATCHLIST_READY':'NO_BET',provenance:{fixtureSource:resolved.source,noDuplicatePredictionEngine:true,predictionService:'EXISTING_/api/predict'}});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const u=new URL(request.url);
  if(u.pathname==='/api/discover'&&request.method==='POST')return discovery(request,env,ctx);
  return base.fetch(request,env,ctx);
}};
