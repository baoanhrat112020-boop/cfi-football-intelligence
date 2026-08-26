import base from './index-live-router.ts';
import { dedupeCanonicalFixtureRows, scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string;canonicalExact?:boolean;canonicalHomeTeamId?:string|null;canonicalAwayTeamId?:string|null;odds?:Record<string,number>;oddsMetadata?:Record<string,unknown>};

async function readJson(r:Response){try{return await r.clone().json()}catch{return null}}
async function feed(input:any,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return null;
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-discovery-feed');
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({target_date:input.target_date,timezone:input.timezone,start_time:input.start_time,end_time:input.end_time,limit:input.scan_limit??40})});
  const b:any=await readJson(r);if(!r.ok||b?.status!=='OK'||!Array.isArray(b?.rows))return null;return b;
}

function fixtureOdds(row:FeedRow,input:any){
  const override=input?.odds_by_fixture?.[row.providerId]??input?.odds_by_fixture?.[`${row.home} vs ${row.away}`];
  if(override?.values)return override;
  if(row.odds&&Object.keys(row.odds).length)return{values:row.odds,metadata:row.oddsMetadata??{}};
  return{values:{},metadata:{verified:false,source:'NONE'}};
}

async function predict(row:FeedRow,input:any,env:Env,ctx:ExecutionContext){
  const req=new Request('https://cfi.local/api/predict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:row.home,away:row.away,target_date:row.targetDate,language:'vi',input_mode:'DISCOVER_TOP_MATCHES',fixture_identity:{verified:true,homeTeamId:row.canonicalHomeTeamId,awayTeamId:row.canonicalAwayTeamId},odds:fixtureOdds(row,input)})});
  const res=await base.fetch(req,env,ctx),body:any=await readJson(res);return{res,body};
}

function canonicalIdentity(row:FeedRow){
  const verified=row.canonicalExact===true&&Boolean(row.canonicalHomeTeamId)&&Boolean(row.canonicalAwayTeamId);
  return{verified,homeTeamId:row.canonicalHomeTeamId??null,awayTeamId:row.canonicalAwayTeamId??null};
}

function diagnose(row:FeedRow,p:{res:Response;body:any}|null,score:any){
  const identity=canonicalIdentity(row);
  if(!identity.verified)return{match:`${row.home} vs ${row.away}`,predictionHttpStatus:null,predictionStatus:'NOT_ATTEMPTED',predictionError:null,strictPrior:false,failureLayer:'CANONICAL_IDENTITY',reasonCode:'CANONICAL_IDENTITY_FAIL',canonicalIdentity:identity,exactTeam:null,evidence:null,temporalEvidenceAudit:null};
  const predictionStatus=String(p?.body?.status??'UNKNOWN');
  const strictPrior=p?.body?.strictPrior?.verified===true||p?.body?.strictPriorAudit?.evidence?.verified===true;
  let failureLayer:string|null=null,reasonCode:string|null=null;
  if(predictionStatus==='INSUFFICIENT_DATA'){
    failureLayer='PREDICTION';reasonCode='INSUFFICIENT_DATA';
  }else if(!p?.res?.ok){
    failureLayer='PREDICT_HTTP';reasonCode='PREDICT_HTTP_FAIL';
  }else if(predictionStatus!=='SUCCESS'&&predictionStatus!=='DATA_READY'){
    failureLayer='PREDICTION';reasonCode='PREDICTION_NOT_SUCCESS';
  }else if(!strictPrior){failureLayer='STRICT_PRIOR';reasonCode='STRICT_PRIOR_NOT_VERIFIED';}
  else if(p?.body?.consistencyGuard?.status&&p.body.consistencyGuard.status!=='PASS'){failureLayer='CONSISTENCY';reasonCode='CONSISTENCY_FAIL';}
  else if(!score?.eligible){failureLayer='RANKING';reasonCode=score?.reason??'NO_RANKING';}
  return{
    match:`${row.home} vs ${row.away}`,
    predictionHttpStatus:p?.res?.status??null,
    predictionStatus,
    predictionError:p?.body?.error??null,
    strictPrior,
    failureLayer,
    reasonCode,
    canonicalIdentity:identity,
    exactTeam:p?.body?.exactTeam??p?.body?.bigDbRetrieval?.exactTeam??null,
    evidence:p?.body?.evidence??null,
    temporalEvidenceAudit:p?.body?.temporalEvidenceAudit??p?.body?.strictPriorAudit?.evidence??null
  };
}

async function discoveryFromFeed(request:Request,env:Env,ctx:ExecutionContext){
  let input:any={};try{input=await request.clone().json()}catch{return null;}
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh'),targetDate=String(input?.target_date??'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return null;
  const f=await feed({...input,target_date:targetDate,timezone:timeZone},env);if(!f||!f.rows.length)return null;
  const rows=dedupeCanonicalFixtureRows(f.rows as FeedRow[]);
  const maxMatches=Math.max(1,Math.min(10,Number(input?.max_matches??5)||5));
  const evaluated:any[]=[],diagnostics:any[]=[];
  let predictionAttempts=0,predictionSuccess=0;
  for(const row of rows){
    if(!canonicalIdentity(row).verified){diagnostics.push(diagnose(row,null,null));continue;}
    predictionAttempts++;
    const p=await predict(row,input,env,ctx),score=scorePrediction(p.body),diag=diagnose(row,p,score);
    if(p.res.ok&&(p.body?.status==='SUCCESS'||p.body?.status==='DATA_READY'))predictionSuccess++;
    diagnostics.push(diag);
    if(p.res.ok&&(p.body?.status==='SUCCESS'||p.body?.status==='DATA_READY')&&score.eligible)evaluated.push({row,body:p.body,score});
  }
  evaluated.sort((a,b)=>Number(b.score.score)-Number(a.score.score));
  const priority:Record<string,number>={BET:3,LEAN:2,WATCH:1};
  const board=evaluated.map(({row,body,score})=>{
    const practical=body?.outputV3,primary=practical?.primary;
    const status=practical?.final==='BET'?'BET':practical?.final==='LEAN'?'LEAN':'WATCH';
    return {
      match:`${row.home} vs ${row.away}`,home:row.home,away:row.away,competition:row.competition,country:row.country,kickoff:row.kickoffIso,kickoffLocal:row.kickoffLocal,provider:row.provider,
      canonicalIdentity:canonicalIdentity(row),inputMode:'DISCOVER_TOP_MATCHES',
      bestMarket:primary?.market??score.best?.market??null,modelProbability:primary?.probability??score.best?.probability??null,fairOdds:primary?.fairOdds??score.best?.fairOdds??null,marketOdds:primary?.marketOdds??null,edge:primary?.edge??null,expectedValue:primary?.expectedValue??null,selectionScore:score.score,confidence:primary?.confidence??score.best?.confidence??null,
      status,valueStatus:status==='BET'||status==='LEAN'?'VERIFIED_MARKET_VALUE':practical?.gates?.verifiedOdds?'NO_QUALIFIED_VALUE':'NOT_ASSESSED_NO_VERIFIED_BOOKMAKER_ODDS',
      strictPrior:body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true,consistency:body?.consistencyGuard?.status??null,multiMarketStatus:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,multiMarketDecisionUse:practical?.multiMarket?.policy?.decisionUse===true,practicalOutput:practical,prediction:body
    };
  }).sort((a,b)=>(priority[b.status]??0)-(priority[a.status]??0)||Number(b.expectedValue??-9)-Number(a.expectedValue??-9)||Number(b.selectionScore)-Number(a.selectionScore)).slice(0,maxMatches);
  const actionable=board.filter(r=>r.status==='BET');
  const insufficient=diagnostics.filter(d=>d.reasonCode==='INSUFFICIENT_DATA').length;
  const blocked=diagnostics.filter(d=>d.reasonCode&&d.reasonCode!=='INSUFFICIENT_DATA').length;
  const canonicalized=rows.filter(row=>canonicalIdentity(row).verified).length;
  return Response.json({status:'OK',action:'CFI_DISCOVERY',version:CFI_DISCOVERY_VERSION,targetDate,timeZone,provider:String(f.source??'CFI_VERIFIED_FIXTURE_FEED'),sourceUrl:null,counts:{fixturesDiscovered:f.rows.length,canonicalized,distinctFixtures:rows.length,duplicatesRemoved:f.rows.length-rows.length,scanned:rows.length,predictionAttempts,predictionSuccess,fullPredictionsExecuted:predictionAttempts,eligible:evaluated.length,insufficient,blocked,recommended:actionable.length,actionable:actionable.length,leans:board.filter(r=>r.status==='LEAN').length,watch:board.filter(r=>r.status==='WATCH').length,shadowMarkets:board.filter(r=>r.multiMarketDecisionUse===false).length},diagnostics,rules:{strictPriorRequired:true,noForcedBet:true,noForcedFive:true,verifiedFreshBookmakerOddsRequiredForBet:true,bookmakerOddsRequiredForValueClaim:true,shadowDecisionUse:false},board,topPicks:actionable.slice(0,3),final:actionable.length?'PRACTICAL_BETS_READY':board.length?'WATCHLIST_READY':'NO_BET',provenance:{fixtureSource:String(f.source??'VERIFIED_FIXTURES_THEN_FORWARD_CAPTURES'),noDuplicatePredictionEngine:true}});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const u=new URL(request.url);
  if(u.pathname==='/api/discover'&&request.method==='POST'){
    const fromFeed=await discoveryFromFeed(request,env,ctx);if(fromFeed)return fromFeed;
  }
  return base.fetch(request,env,ctx);
}};
