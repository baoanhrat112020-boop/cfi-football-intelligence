import base from './index-live-router.ts';
import { scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function feed(input:any,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return null;
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-discovery-feed');
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({target_date:input.target_date,timezone:input.timezone,start_time:input.start_time,end_time:input.end_time,limit:input.scan_limit??40})});
  const b:any=await readJson(r);if(!r.ok||b?.status!=='OK'||!Array.isArray(b?.rows))return null;return b;
}

async function predict(row:FeedRow,env:Env,ctx:ExecutionContext){
  const req=new Request('https://cfi.local/api/predict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:row.home,away:row.away,target_date:row.targetDate,language:'vi'})});
  const res=await base.fetch(req,env,ctx),body:any=await readJson(res);return{res,body};
}

async function discoveryFromFeed(request:Request,env:Env,ctx:ExecutionContext){
  let input:any={};try{input=await request.clone().json()}catch{return null;}
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh'),targetDate=String(input?.target_date??'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return null;
  const f=await feed({...input,target_date:targetDate,timezone:timeZone},env);if(!f||!f.rows.length)return null;
  const maxMatches=Math.max(1,Math.min(10,Number(input?.max_matches??5)||5));
  const evaluated:any[]=[];
  for(const row of f.rows as FeedRow[]){
    const p=await predict(row,env,ctx),score=scorePrediction(p.body);
    if(p.res.ok&&p.body?.status==='SUCCESS'&&score.eligible){evaluated.push({row,body:p.body,score});}
  }
  evaluated.sort((a,b)=>Number(b.score.score)-Number(a.score.score));
  const selected=evaluated.slice(0,maxMatches),board=selected.map(({row,body,score})=>({
    match:`${row.home} vs ${row.away}`,home:row.home,away:row.away,competition:row.competition,country:row.country,kickoff:row.kickoffIso,kickoffLocal:row.kickoffLocal,provider:row.provider,
    bestMarket:score.best?.market??null,modelProbability:score.best?.probability??null,fairOdds:score.best?.fairOdds??null,selectionScore:score.score,confidence:score.best?.confidence??null,
    status:score.best&&score.best.probability>=.6&&!['LOW','VERY_LOW'].includes(String(score.best.confidence??'').toUpperCase())?'ACTIONABLE_MODEL_SIGNAL':'WATCH',valueStatus:'NOT_ASSESSED_NO_BOOKMAKER_ODDS',
    strictPrior:body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true,consistency:body?.consistencyGuard?.status??null,multiMarketStatus:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,multiMarketDecisionUse:false,prediction:body
  }));
  const actionable=board.filter(r=>r.status==='ACTIONABLE_MODEL_SIGNAL');
  return Response.json({status:'OK',action:'CFI_DISCOVERY',version:CFI_DISCOVERY_VERSION,targetDate,timeZone,provider:'CFI_FORWARD_CAPTURE',sourceUrl:null,counts:{fixturesDiscovered:f.rows.length,scanned:f.rows.length,eligible:evaluated.length,insufficient:f.rows.length-evaluated.length,blocked:0,fullPredictionsExecuted:board.length,actionable:actionable.length,shadowMarkets:board.filter(r=>r.multiMarketDecisionUse===false).length},rules:{strictPriorRequired:true,noForcedBet:true,bookmakerOddsRequiredForValueClaim:true,shadowDecisionUse:false},board,topPicks:actionable.slice(0,3),final:actionable.length?'MODEL_SHORTLIST_READY':board.length?'WATCHLIST_READY':'NO_BET',provenance:{fixtureSource:'EXISTING_FORWARD_MARKET_CAPTURES',fallbackOnly:true,noDuplicatePredictionEngine:true}});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const u=new URL(request.url);
  if(u.pathname==='/api/discover'&&request.method==='POST'){
    const fromFeed=await discoveryFromFeed(request,env,ctx);if(fromFeed)return fromFeed;
  }
  return base.fetch(request,env,ctx);
}};
