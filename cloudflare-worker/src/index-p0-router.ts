import base from './index-live-router.ts';
import { CFI_GPT_OPENAPI } from './openapi-gpt.ts';
import { discoverFixtures, fixtureCohort, mergeDiscoveryRows, normalizeAiFixtureCandidates, scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';
import { discoveryFinal } from './discovery-final.ts';
import { compactDiscoveryRow } from './discovery-compact.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoff?:number;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string;canonicalExact?:boolean;canonicalHomeTeamId?:string|null;canonicalAwayTeamId?:string|null;odds?:Record<string,number>;oddsMetadata?:Record<string,unknown>;sourceUrls?:string[];discoveredAt?:string;discoveryMode?:string};

const TRUSTED_SCHEDULE_PROVIDERS=new Set(['SOFASCORE','THESPORTSDB','ESPN','GPT_WEB_SEARCH']);

async function readJson(r:Response){
  try{return await r.clone().json()}catch{return null}
}

async function betLedger(request:Request,env:Env){
  if(!env.CFI_DB_BASE_URL)return Response.json({status:'CONFIG_REQUIRED',message:'CFI_DB_BASE_URL missing'},{status:503});
  if(request.method!=='GET'&&request.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
  const target=new URL(env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bet-ledger'));
  target.search=new URL(request.url).search;
  const headers:Record<string,string>={accept:'application/json'};
  if(request.method==='POST')headers['content-type']=request.headers.get('content-type')??'application/json';
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const response=await fetch(target,{method:request.method,headers,body:request.method==='POST'?await request.clone().arrayBuffer():undefined});
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

async function databaseFeed(input:any,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return null;
  const requested=Math.max(1,Math.min(10,Number(input.max_matches??5)||5));
  const limit=Math.max(requested,Math.min(20,Number(input.scan_limit??requested*2)||requested*2));
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-discovery-feed');
  const body=JSON.stringify({target_date:input.target_date,timezone:input.timezone,start_time:input.start_time,end_time:input.end_time,limit});
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body});
      const b:any=await readJson(r);
      if(r.ok&&b?.status==='OK'&&Array.isArray(b?.rows))return b;
    }catch{}
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
  }
  return null;
}

async function feed(input:any,env:Env){
  const requestedRows=Math.max(1,Math.min(100,Number(input.max_matches??5)||5));
  const scanLimit=Math.max(requestedRows,Math.min(20,Number(input.scan_limit??requestedRows*2)||requestedRows*2));
  const providerScanRows=Math.min(scanLimit,requestedRows);
  const window={targetDate:String(input.target_date),timeZone:String(input.timezone??'Asia/Ho_Chi_Minh'),startTime:input.start_time??null,endTime:input.end_time??null,minimumRows:providerScanRows};
  const ai=normalizeAiFixtureCandidates(input?.fixture_candidates??[],window);
  const database=await databaseFeed(input,env).catch(()=>null);
  const verifiedBeforeProviders=mergeDiscoveryRows<FeedRow>([ai.rows as FeedRow[],(database?.rows??[]) as FeedRow[]],scanLimit);
  const explicitProviderDiagnostics=input?.internal_provider_diagnostics===true;
  const providerFallbackTriggered=verifiedBeforeProviders.length<requestedRows;
  const workerProviderFallbackAllowed=explicitProviderDiagnostics||providerFallbackTriggered;
  const usePublicProviders=workerProviderFallbackAllowed;
  const publicProviders=usePublicProviders
    ?await discoverFixtures(window).catch(error=>({provider:'ERROR',providers:[],rows:[],sourceUrl:null,attempts:[{provider:'MULTI_SOURCE',ok:false,error:String(error)}],search:null}))
    :{provider:'DISABLED',providers:[],rows:[],sourceUrl:null,attempts:[],search:null};
  const rows=mergeDiscoveryRows<FeedRow>([verifiedBeforeProviders,(publicProviders?.rows??[]) as FeedRow[]],scanLimit);
  const providers=[...new Set(rows.map(row=>row.provider))];
  return{
    status:'OK',
    source:providers.length>1?'AI_PLUS_BIGDB':providers[0]??String(publicProviders?.provider??'NONE'),
    providers,
    rows,
    sourceUrl:publicProviders?.sourceUrl??null,
    attempts:publicProviders?.attempts??[],
    search:{
      mode:'GPT_SEARCH_FIRST',
      requestedRows,
      providerScanRows,
      scanLimit,
      aiCandidatesReceived:Array.isArray(input?.fixture_candidates)?input.fixture_candidates.length:0,
      aiCandidatesAccepted:ai.rows.length,
      aiCandidatesRejected:ai.rejected,
      internalProviderDiagnostics:explicitProviderDiagnostics,
      providerFallbackTriggered,
      workerProviderFallbackAllowed,
      providerFallbackReason:providerFallbackTriggered?'VERIFIED_POOL_SHORTFALL':null,
      verifiedRowsBeforeProviderFallback:verifiedBeforeProviders.length,
      internalProviderSearch:publicProviders?.search??null
    },
    databaseRows:Array.isArray(database?.rows)?database.rows.length:0,
    aiRows:ai.rows.length,
    publicRows:Array.isArray(publicProviders?.rows)?publicProviders.rows.length:0
  };
}

function fixtureOdds(row:FeedRow,input:any){
  const override=input?.odds_by_fixture?.[row.providerId]??input?.odds_by_fixture?.[`${row.home} vs ${row.away}`];
  if(override?.values)return override;
  if(row.odds&&Object.keys(row.odds).length)return{values:row.odds,metadata:row.oddsMetadata??{}};
  return{values:{},metadata:{verified:false,source:'NONE'}};
}

async function predict(row:FeedRow,input:any,env:Env,ctx:ExecutionContext){
  try{
    const req=new Request('https://cfi.local/api/predict',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        home:row.home,
        away:row.away,
        target_date:row.targetDate,
        language:'vi',
        input_mode:'DISCOVER_TOP_MATCHES',
        fixture_identity:{verified:true,homeTeamId:row.canonicalHomeTeamId,awayTeamId:row.canonicalAwayTeamId},
        odds:fixtureOdds(row,input)
      })
    });
    const res=await base.fetch(req,env,ctx);
    const body:any=await readJson(res);
    return{res,body};
  }catch(error:any){
    const message=String(error?.message||error);
    const body={status:'ERROR',error:'PREDICT_INTERNAL_EXCEPTION',message};
    return{res:Response.json(body,{status:500}),body};
  }
}

function canonicalIdentity(row:FeedRow){
  const databaseExact=row.canonicalExact===true&&Boolean(row.canonicalHomeTeamId)&&Boolean(row.canonicalAwayTeamId);
  const providerScheduled=TRUSTED_SCHEDULE_PROVIDERS.has(String(row.provider).toUpperCase())&&Boolean(row.providerId)&&Boolean(row.home?.trim())&&Boolean(row.away?.trim());
  const verified=databaseExact||providerScheduled;
  return{
    verified,
    homeTeamId:row.canonicalHomeTeamId??null,
    awayTeamId:row.canonicalAwayTeamId??null,
    verificationBasis:databaseExact?'BIGDB_CANONICAL_IDS':row.provider==='GPT_WEB_SEARCH'&&providerScheduled?'GPT_SEARCH_PROVENANCE_PLUS_EXACT_TEAM_RETRIEVAL':providerScheduled?'TRUSTED_PROVIDER_ID_PLUS_EXACT_TEAM_RETRIEVAL':'UNVERIFIED'
  };
}

async function evidencePreflight(row:FeedRow,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY){
    return{ready:false,row,reason:'BIGDB_PREFLIGHT_UNAVAILABLE',retrieval:null,homeHistory:0,awayHistory:0,preflightAttempts:0};
  }
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  const body=JSON.stringify({home:row.home,away:row.away,target_date:row.targetDate});
  let lastError:any=null;

  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,{
        method:'POST',
        headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},
        body
      });
      const b:any=await readJson(r);
      const homeId=b?.identity?.homeTeamId??null;
      const awayId=b?.identity?.awayTeamId??null;
      const homeN=Number(b?.exactTeam?.home?.retrieved??0);
      const awayN=Number(b?.exactTeam?.away?.retrieved??0);
      const temporal=b?.temporalAudit?.verified===true;
      const ready=r.ok&&b?.status==='OK'&&Boolean(homeId)&&Boolean(awayId)&&homeN>0&&awayN>0&&temporal;
      const enriched:FeedRow=ready
        ?{...row,home:String(b?.identity?.homeCanonical??row.home),away:String(b?.identity?.awayCanonical??row.away),canonicalExact:true,canonicalHomeTeamId:String(homeId),canonicalAwayTeamId:String(awayId)}
        :row;
      return{
        ready,
        row:enriched,
        reason:ready?'EVIDENCE_READY':!homeId||!awayId?'NO_EXACT_IDENTITY':homeN<=0||awayN<=0?'ZERO_EXACT_TEAM_EVIDENCE':!temporal?'STRICT_PRIOR_PREFLIGHT_FAIL':'BIGDB_PREFLIGHT_FAIL',
        retrieval:b,
        homeHistory:homeN,
        awayHistory:awayN,
        preflightAttempts:attempt+1
      };
    }catch(error:any){
      lastError=error;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
    }
  }

  return{
    ready:false,
    row,
    reason:'BIGDB_PREFLIGHT_EXCEPTION',
    retrieval:{message:String(lastError?.message||lastError||'UNKNOWN_PREFLIGHT_EXCEPTION')},
    homeHistory:0,
    awayHistory:0,
    preflightAttempts:2
  };
}

function preflightDiagnostic(x:any){
  return{
    match:`${x.row.home} vs ${x.row.away}`,
    predictionHttpStatus:null,
    predictionStatus:'NOT_ATTEMPTED',
    predictionError:null,
    predictionMessage:null,
    strictPrior:x.reason==='EVIDENCE_READY',
    failureLayer:x.reason==='NO_EXACT_IDENTITY'?'CANONICAL_IDENTITY':x.reason==='ZERO_EXACT_TEAM_EVIDENCE'?'BIGDB_EVIDENCE':x.reason==='STRICT_PRIOR_PREFLIGHT_FAIL'?'STRICT_PRIOR':'BIGDB_PREFLIGHT',
    reasonCode:x.reason,
    preflightMessage:x.retrieval?.message??null,
    preflightAttempts:Number(x.preflightAttempts??0),
    canonicalIdentity:canonicalIdentity(x.row),
    exactTeam:x.retrieval?.exactTeam??{home:{retrieved:x.homeHistory},away:{retrieved:x.awayHistory}},
    evidence:null,
    temporalEvidenceAudit:x.retrieval?.temporalAudit??null
  };
}

function diagnose(row:FeedRow,p:{res:Response;body:any}|null,score:any){
  const identity=canonicalIdentity(row);
  if(!identity.verified){
    return{match:`${row.home} vs ${row.away}`,predictionHttpStatus:null,predictionStatus:'NOT_ATTEMPTED',predictionError:null,predictionMessage:null,strictPrior:false,failureLayer:'CANONICAL_IDENTITY',reasonCode:'CANONICAL_IDENTITY_FAIL',canonicalIdentity:identity,exactTeam:null,evidence:null,temporalEvidenceAudit:null};
  }
  const predictionStatus=String(p?.body?.status??'UNKNOWN');
  const strictPrior=p?.body?.strictPrior?.verified===true||p?.body?.strictPriorAudit?.evidence?.verified===true;
  let failureLayer:string|null=null,reasonCode:string|null=null;
  if(predictionStatus==='INSUFFICIENT_DATA'){
    failureLayer='PREDICTION';reasonCode='INSUFFICIENT_DATA';
  }else if(!p?.res?.ok){
    failureLayer='PREDICT_HTTP';reasonCode='PREDICT_HTTP_FAIL';
  }else if(predictionStatus!=='SUCCESS'&&predictionStatus!=='DATA_READY'){
    failureLayer='PREDICTION';reasonCode='PREDICTION_NOT_SUCCESS';
  }else if(!strictPrior){
    failureLayer='STRICT_PRIOR';reasonCode='STRICT_PRIOR_NOT_VERIFIED';
  }else if(p?.body?.consistencyGuard?.status&&p.body.consistencyGuard.status!=='PASS'){
    failureLayer='CONSISTENCY';reasonCode='CONSISTENCY_FAIL';
  }else if(!score?.eligible){
    failureLayer='RANKING';reasonCode=score?.reason??'NO_RANKING';
  }
  return{
    match:`${row.home} vs ${row.away}`,
    predictionHttpStatus:p?.res?.status??null,
    predictionStatus,
    predictionError:p?.body?.error??null,
    predictionMessage:p?.body?.message??null,
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
  let input:any={};
  try{input=await request.clone().json()}catch{return null;}
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh');
  const targetDate=String(input?.target_date??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return null;

  const f=await feed({...input,target_date:targetDate,timezone:timeZone},env);
  if(!f)return null;
  const rows=f.rows as FeedRow[];
  const maxMatches=Math.max(1,Math.min(10,Number(input?.max_matches??5)||5));
  const evaluated:any[]=[];
  const diagnostics:any[]=[];
  let predictionAttempts=0,predictionSuccess=0;

  const identityRows=rows.filter(row=>{
    if(canonicalIdentity(row).verified)return true;
    diagnostics.push(diagnose(row,null,null));
    return false;
  });

  const preflight:any[]=[];
  for(let offset=0;offset<identityRows.length;offset+=5){
    const batch=identityRows.slice(offset,offset+5);
    preflight.push(...await Promise.all(batch.map(row=>evidencePreflight(row,env))));
  }

  const evidenceReady=preflight
    .filter(x=>x.ready)
    .sort((a,b)=>Math.min(Number(b.homeHistory||0),Number(b.awayHistory||0))-Math.min(Number(a.homeHistory||0),Number(a.awayHistory||0)));
  const evidenceRejected=preflight.filter(x=>!x.ready);
  for(const rejected of evidenceRejected)diagnostics.push(preflightDiagnostic(rejected));

  for(let offset=0;offset<evidenceReady.length&&evaluated.length<maxMatches;){
    const remaining=maxMatches-evaluated.length;
    const batch=evidenceReady.slice(offset,offset+remaining);
    offset+=batch.length;
    predictionAttempts+=batch.length;
    const results=await Promise.all(batch.map(async x=>({row:x.row as FeedRow,p:await predict(x.row as FeedRow,input,env,ctx)})));
    for(const {row,p} of results){
      const score=scorePrediction(p.body);
      const diag=diagnose(row,p,score);
      const engineSucceeded=p.res.ok&&(p.body?.status==='SUCCESS'||p.body?.status==='DATA_READY');
      const strictPrior=diag.strictPrior===true;
      if(engineSucceeded)predictionSuccess++;
      diagnostics.push(diag);
      if(engineSucceeded&&strictPrior&&score.eligible&&evaluated.length<maxMatches)evaluated.push({row,body:p.body,score});
    }
  }

  evaluated.sort((a,b)=>Number(b.score.score)-Number(a.score.score));
  const priority:Record<string,number>={BET:3,LEAN:2,WATCH:1};
  const board=evaluated.map(({row,body,score})=>{
    const practical=body?.outputV3;
    const primary=practical?.primary;
    const status=practical?.final==='BET'?'BET':practical?.final==='LEAN'?'LEAN':'WATCH';
    return{
      match:`${row.home} vs ${row.away}`,
      home:row.home,
      away:row.away,
      competition:row.competition,
      country:row.country,
      kickoff:row.kickoffIso,
      kickoffLocal:row.kickoffLocal,
      provider:row.provider,
      fixtureProvenance:row.sourceUrls??null,
      discoveredAt:row.discoveredAt??null,
      canonicalIdentity:canonicalIdentity(row),
      inputMode:'DISCOVER_TOP_MATCHES',
      cohort:fixtureCohort(row),
      bestMarket:primary?.market??score.best?.market??null,
      modelProbability:primary?.probability??score.best?.probability??null,
      fairOdds:primary?.fairOdds??score.best?.fairOdds??null,
      marketOdds:primary?.marketOdds??null,
      edge:primary?.edge??null,
      expectedValue:primary?.expectedValue??null,
      selectionScore:score.score,
      confidence:primary?.confidence??score.best?.confidence??null,
      status,
      valueStatus:status==='BET'||status==='LEAN'?'VERIFIED_MARKET_VALUE':practical?.gates?.verifiedOdds?'NO_QUALIFIED_VALUE':'NOT_ASSESSED_NO_VERIFIED_BOOKMAKER_ODDS',
      strictPrior:body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true,
      consistency:body?.consistencyGuard?.status??null,
      multiMarketStatus:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,
      multiMarketDecisionUse:practical?.multiMarket?.policy?.decisionUse===true,
      marketSummary:practical?.marketSummary??null,
      practicalOutput:practical,
      prediction:body
    };
  }).sort((a,b)=>(priority[b.status]??0)-(priority[a.status]??0)||Number(b.expectedValue??-9)-Number(a.expectedValue??-9)||Number(b.selectionScore)-Number(a.selectionScore)).slice(0,maxMatches);

  const actionable=board.filter(r=>r.status==='BET');
  const insufficient=diagnostics.filter(d=>d.reasonCode==='INSUFFICIENT_DATA'||d.reasonCode==='ZERO_EXACT_TEAM_EVIDENCE').length;
  const blocked=diagnostics.filter(d=>d.reasonCode&&d.reasonCode!=='INSUFFICIENT_DATA'&&d.reasonCode!=='ZERO_EXACT_TEAM_EVIDENCE').length;
  const canonicalized=preflight.filter(x=>Boolean(x.retrieval?.identity?.homeTeamId)&&Boolean(x.retrieval?.identity?.awayTeamId)).length;
  const search={
    ...f.search,
    combinedDistinctFixtures:rows.length,
    combinedTargetSatisfied:rows.length>=maxMatches,
    predictionExecutionMode:'EVIDENCE_READY_SUCCESS_FILL_BATCHES',
    predictionBatchSize:'REMAINING_SUCCESS_SLOTS',
    evidencePreflightAttempted:preflight.length,
    evidenceReadyCandidates:evidenceReady.length,
    evidenceInsufficientCandidates:evidenceRejected.length,
    evidencePreflightReasons:Object.fromEntries([...new Set(preflight.map(x=>x.reason))].map(reason=>[reason,preflight.filter(x=>x.reason===reason).length])),
    successfulCandidates:evaluated.length,
    candidatePoolExhausted:evaluated.length<maxMatches&&predictionAttempts>=evidenceReady.length
  };

  const responseMode=input?.response_mode==='compact'?'compact':'full';
  const responseBoard=responseMode==='compact'?board.map(compactDiscoveryRow):board;
  const responseDiagnostics=responseMode==='compact'?diagnostics.slice(0,20):diagnostics;
  const responseProviderAttempts=responseMode==='compact'?[]:f.attempts??[];

  return Response.json({
    status:'OK',
    action:'CFI_DISCOVERY',
    version:CFI_DISCOVERY_VERSION,
    responseMode,
    targetDate,
    timeZone,
    provider:String(f.source??'CFI_VERIFIED_FIXTURE_FEED'),
    sourceUrl:f.sourceUrl??null,
    counts:{
      fixturesDiscovered:f.rows.length,
      aiDiscoveredFixtures:Number(f.aiRows??0),
      databaseFixtures:Number(f.databaseRows??0),
      publicProviderFixtures:Number(f.publicRows??0),
      canonicalized,
      distinctFixtures:rows.length,
      duplicatesRemoved:Math.max(0,Number(f.aiRows??0)+Number(f.databaseRows??0)+Number(f.publicRows??0)-rows.length),
      scanned:rows.length,
      evidencePreflightAttempted:preflight.length,
      evidenceReady:evidenceReady.length,
      predictionAttempts,
      predictionSuccess,
      fullPredictionsExecuted:predictionSuccess,
      successfulMatches:evaluated.length,
      eligible:evaluated.length,
      insufficient,
      blocked,
      recommended:actionable.length,
      actionable:actionable.length,
      leans:board.filter(r=>r.status==='LEAN').length,
      watch:board.filter(r=>r.status==='WATCH').length,
      shadowMarkets:board.filter(r=>r.multiMarketDecisionUse===false).length
    },
    search,
    diagnostics:responseDiagnostics,
    providerAttempts:responseProviderAttempts,
    rules:{
      strictPriorRequired:true,
      gptSearchFirstRequired:true,
      evidenceFirstSelection:true,
      exactTeamHistoryRequired:true,
      temporalPreflightRequired:true,
      predictEvidenceReadyOnly:true,
      internalProviderCrawlerDefault:false,
      providerFallbackOnShortfall:true,
      sameDayDiscoveryOnly:true,
      continueAfterCandidateFailure:true,
      stopAtSuccessfulMaxMatches:true,
      continueUntilRequestedPoolOrSourcesExhausted:true,
      noLeagueCohortExclusion:true,
      includeWomenYouthReserveAmateur:true,
      noForcedBet:true,
      noForcedFive:true,
      verifiedFreshBookmakerOddsRequiredForBet:true,
      bookmakerOddsRequiredForValueClaim:true,
      shadowDecisionUse:false
    },
    board:responseBoard,
    topPicks:responseBoard.filter(r=>r.status==='BET').slice(0,3),
    final:actionable.length?'PRACTICAL_BETS_READY':board.length?'WATCHLIST_READY':'NO_BET',
    provenance:{
      fixtureSource:String(f.source??'GPT_SEARCH_THEN_BIGDB'),
      discoveryStrategy:'WEB_DB_PROVIDER_POOL_THEN_BIGDB_PREFLIGHT_THEN_EXACT_IDS_THEN_EXACT_HISTORY_THEN_STRICT_PRIOR_THEN_EVIDENCE_READY_FIRST_THEN_SUCCESS_FILL',
      noDuplicatePredictionEngine:true,
      noDuplicateWorkerProviderCrawler:f.search?.workerProviderFallbackAllowed===false
    }
  });
}

async function failClosedDiscovery(response:Response){
  if(!response.ok)return response;
  const body:any=await readJson(response);
  if(body?.action!=='CFI_DISCOVERY')return response;
  body.final=discoveryFinal(body);
  return Response.json(body,{status:response.status});
}

export default{
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const u=new URL(request.url);
    if(u.pathname==='/openapi-gpt.yaml'&&request.method==='GET'){
      return new Response(CFI_GPT_OPENAPI,{status:200,headers:{'content-type':'application/yaml; charset=utf-8','cache-control':'public, max-age=300','access-control-allow-origin':'*'}});
    }
    if(u.pathname==='/api/bets')return betLedger(request,env);
    if(u.pathname==='/api/discover'&&request.method==='POST'){
      try{
        const fromFeed=await discoveryFromFeed(request,env,ctx);
        if(fromFeed)return failClosedDiscovery(fromFeed);
      }catch(error:any){
        return Response.json({
          status:'ERROR',
          action:'CFI_DISCOVERY',
          error:'DISCOVERY_INTERNAL_EXCEPTION',
          message:String(error?.message||error),
          counts:{fixturesDiscovered:0,canonicalized:0,predictionAttempts:0,predictionSuccess:0,fullPredictionsExecuted:0},
          board:[],
          diagnostics:[]
        },{status:500});
      }
    }
    return base.fetch(request,env,ctx);
  }
};
