import v4 from './index-gpt-core-v4.ts';
import { fixtureCohort, normalizeAiFixtureCandidates, scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';
import { FINAL_VERSION } from '../../src/prediction/final-engine.ts';
import { THREE_PLUS_HT_SAFETY_VERSION } from '../../src/prediction/three-plus-ht-safety.ts';
import { SEVEN_PLUS_FT_SAFETY_VERSION } from '../../src/prediction/seven-plus-ft-safety.ts';
import { MARKET_COHERENCE_VERSION } from '../../src/prediction/market-coherence.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string;sourceUrls?:string[];discoveredAt?:string};

const GPT_PRODUCTION_HOST='cfi-football-intelligence.baoanhrat112020.workers.dev';
const COMPACT_CONTRACT='CFI_GPT_PREDICT_COMPACT_V2_EXTREME_THRESHOLD_SAFETY';
const THRESHOLD_TARGETS=['3+ HT','7+ FT','Other HT','Other FT'] as const;

async function readJson(response:Response){try{return await response.clone().json()}catch{return null}}
const finite=(value:any)=>Number.isFinite(Number(value))?Number(value):null;

function contextFixture(row:any){
  const matchDate=String(row?.match_date??row?.matchDate??'').slice(0,10);
  const homeTeam=String(row?.home_name??row?.homeTeam??row?.home_team??'').trim();
  const awayTeam=String(row?.away_name??row?.awayTeam??row?.away_team??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeTeam||!awayTeam)return null;
  const score=(h:any,a:any)=>{
    const hh=finite(h),aa=finite(a);
    return hh===null||aa===null?null:{home:hh,away:aa};
  };
  return{
    id:String(row?.fixture_id??row?.id??[matchDate,homeTeam,awayTeam].join('|')),
    matchDate,homeTeam,awayTeam,
    competition:String(row?.competition_name??row?.competition_key??'').trim()||null,
    country:String(row?.country??'').trim()||null,
    season:String(row?.season??'').trim()||null,
    ht:score(row?.ht_home,row?.ht_away),
    ft:score(row?.ft_home,row?.ft_away)
  };
}

function contextTeamSummary(team:string,rows:any[]){
  const key=team.toLowerCase();
  const normalized=rows.map(contextFixture).filter(Boolean).sort((a:any,b:any)=>b.matchDate.localeCompare(a.matchDate));
  let wins=0,draws=0,losses=0,gf=0,ga=0,htGf=0,htGa=0,ftN=0,htN=0,btts=0,over25=0,cleanSheets=0,scored=0;
  const form:string[]=[];
  for(const row of normalized){
    const isHome=String(row.homeTeam).toLowerCase()===key;
    if(row.ft){
      const f=isHome?row.ft.home:row.ft.away,a=isHome?row.ft.away:row.ft.home;
      gf+=f;ga+=a;ftN++;
      if(f>a){wins++;form.push('W')}else if(f===a){draws++;form.push('D')}else{losses++;form.push('L')}
      if(f>0)scored++;if(a===0)cleanSheets++;if(f>0&&a>0)btts++;if(f+a>=3)over25++;
    }
    if(row.ht){
      htGf+=isHome?row.ht.home:row.ht.away;
      htGa+=isHome?row.ht.away:row.ht.home;
      htN++;
    }
  }
  const pct=(n:number,d:number)=>d?Math.round((n/d)*1000)/10:null;
  const avg=(n:number,d:number)=>d?Math.round((n/d)*100)/100:null;
  return{
    fixtures:normalized.length,completed:ftN,wins,draws,losses,
    avgGoalsFor:avg(gf,ftN),avgGoalsAgainst:avg(ga,ftN),
    avgHtGoalsFor:avg(htGf,htN),avgHtGoalsAgainst:avg(htGa,htN),
    scoringRate:pct(scored,ftN),cleanSheetRate:pct(cleanSheets,ftN),
    bttsRate:pct(btts,ftN),over25Rate:pct(over25,ftN),
    form:form.slice(0,5),recent:normalized.slice(0,10)
  };
}

async function matchContext(request:Request,env:Env){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return Response.json({status:'CONFIG_REQUIRED',error:'BIGDB_CONTEXT_UNAVAILABLE'},{status:503});
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});}
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim(),targetDate=String(input?.target_date??'').slice(0,10);
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  let response:Response;
  try{
    response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({home,away,target_date:targetDate}),signal:AbortSignal.timeout(9000)});
  }catch(error:any){
    return Response.json({status:'UPSTREAM_UNAVAILABLE',error:'BIGDB_CONTEXT_FETCH_FAILED',message:String(error?.message||error)},{status:503});
  }
  const big:any=await readJson(response);
  if(!response.ok||big?.status!=='OK'){
    return Response.json({status:'UPSTREAM_ERROR',error:'BIGDB_CONTEXT_REJECTED',upstreamStatus:response.status,upstreamError:big?.error??null,message:big?.message??null},{status:response.status===402?503:502});
  }
  const homeRows=Array.isArray(big?.fixtures?.home)?big.fixtures.home:[];
  const awayRows=Array.isArray(big?.fixtures?.away)?big.fixtures.away:[];
  const h2hRows=Array.isArray(big?.fixtures?.h2h)?big.fixtures.h2h:[];
  const homeCanonical=String(big?.identity?.homeCanonical??home);
  const awayCanonical=String(big?.identity?.awayCanonical??away);
  const h2h=h2hRows.map(contextFixture).filter(Boolean).sort((a:any,b:any)=>b.matchDate.localeCompare(a.matchDate)).slice(0,10);
  return Response.json({
    status:'OK',action:'CFI_MATCH_CONTEXT',readOnly:true,strictPrior:true,
    target:{home:homeCanonical,away:awayCanonical,date:targetDate},
    identity:big?.identity??null,temporalAudit:big?.temporalAudit??null,exactTeam:big?.exactTeam??null,
    home:contextTeamSummary(homeCanonical,homeRows),
    away:contextTeamSummary(awayCanonical,awayRows),
    h2h:{fixtures:h2hRows.length,recent:h2h},
    provenance:{source:'CFI_BIG_DB_RETRIEVAL',futureEvidenceExcluded:true,sameDateExcluded:true}
  });
}

function patchRuntimeTelemetry(body:any){
  if(!body||typeof body!=='object')return body;
  body.engine=FINAL_VERSION;
  body.runtime={
    ...(body.runtime??{}),
    engine:FINAL_VERSION,
    extremeThresholdSafety:{
      threePlusHt:THREE_PLUS_HT_SAFETY_VERSION,
      sevenPlusFt:SEVEN_PLUS_FT_SAFETY_VERSION,
      marketCoherence:MARKET_COHERENCE_VERSION,
      policy:'FAIL_CLOSED_UNTIL_APPROVED_CALIBRATION_AND_ALIAS_COHERENCE_PASS'
    }
  };
  body.release={...(body.release??{}),engine:FINAL_VERSION,extremeThresholdSafety:body.runtime.extremeThresholdSafety};
  return body;
}

function compactSettlement(value:any){
  if(!value||typeof value!=='object')return null;
  return{fullWin:finite(value.fullWin),halfWin:finite(value.halfWin),push:finite(value.push),halfLoss:finite(value.halfLoss),fullLoss:finite(value.fullLoss),fairDecimal:finite(value.fairDecimal)};
}

function compactOverUnder(value:any){
  if(!value||typeof value!=='object')return null;
  const result:any={};
  for(const period of ['ht','ft']){
    const ladder=value?.[period];if(!ladder||typeof ladder!=='object')continue;
    result[period]={};
    for(const line of Object.keys(ladder))result[period][line]={over:compactSettlement(ladder[line]?.over),under:compactSettlement(ladder[line]?.under)};
  }
  return result;
}

function compactAsianHandicap(value:any){
  if(!value||typeof value!=='object')return null;
  const result:any={};
  for(const period of ['ht','ft']){
    const ladder=value?.[period];if(!ladder||typeof ladder!=='object')continue;
    result[period]={};
    for(const line of Object.keys(ladder))result[period][line]={home:compactSettlement(ladder[line]?.home),away:compactSettlement(ladder[line]?.away)};
  }
  return result;
}

function compactMultiMarket(value:any){
  if(!value||typeof value!=='object')return null;
  return{
    version:value.version??null,status:value.status??value.mode??null,mode:value.mode??null,decisionUse:value.decisionUse===true,
    oneXTwo:value.oneXTwo??null,overUnder:compactOverUnder(value.overUnder),asianHandicap:compactAsianHandicap(value.asianHandicap),
    consistencyGuard:value.consistencyGuard??null,crossCoreConsistency:value.crossCoreConsistency??null
  };
}

function compactThresholdMarkets(markets:any){
  if(!markets||typeof markets!=='object')return null;
  return Object.fromEntries(THRESHOLD_TARGETS.map(target=>{
    const row=markets?.[target]??{};
    return[target,{methodA:finite(row.methodA),methodB:finite(row.methodB),final:finite(row.final),confidence:row.predictiveConfidence??row.confidence??null,fairOdds:finite(row.fairOdds),consistency:row.consistency??null}];
  }));
}

function compactEvidence(value:any){
  if(!value||typeof value!=='object')return null;
  return{counts:value.counts??null,htCoverage:finite(value.htCoverage??value?.counts?.htCoverage),ftCoverage:finite(value.ftCoverage??value?.counts?.ftCoverage),quality:value.quality??null,sufficiency:value.sufficiency??null};
}

function compactPrediction(body:any){
  patchRuntimeTelemetry(body);
  const output=body?.outputV3??body?.outputV2??null;
  const coherence=body?.marketCoherence??output?.marketCoherence??null;
  const threePlus=body?.threePlusHtSafety??output?.threePlusHtSafety??coherence?.extremeThresholdSafety?.threePlusHt??null;
  const sevenPlus=body?.sevenPlusFtSafety??output?.sevenPlusFtSafety??coherence?.extremeThresholdSafety?.sevenPlusFt??null;
  const compact:any={
    status:body?.status??null,upstreamStatus:body?.upstreamStatus??null,engine:FINAL_VERSION,runtime:body?.runtime??null,release:body?.release??null,
    target:body?.target??null,strictPrior:body?.strictPrior??null,strictPriorAudit:body?.strictPriorAudit??null,temporalEvidenceAudit:body?.temporalEvidenceAudit??null,
    evidence:compactEvidence(body?.evidence),
    bigDbRetrieval:{version:body?.bigDbRetrieval?.version??null,exactTeam:body?.bigDbRetrieval?.exactTeam??null,predictionInput:body?.bigDbRetrieval?.predictionInput??null},
    presentationContract:body?.presentationContract??null,sixTargetMatrix:body?.sixTargetMatrix??null,markets:compactThresholdMarkets(body?.markets),ranking:body?.ranking??null,verdict:body?.verdict??null,
    consistencyGuard:body?.consistencyGuard??null,
    threePlusHtSafety:threePlus,
    sevenPlusFtSafety:sevenPlus,
    marketCoherence:coherence,
    extremeThresholdResearchSafety:body?.extremeThresholdResearchSafety??null,
    multiMarketIntegration:{version:body?.multiMarketIntegration?.version??null,status:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,decisionUse:body?.multiMarketIntegration?.decisionUse===true||body?.multiMarket?.decisionUse===true,consistencyGuard:body?.multiMarketIntegration?.consistencyGuard??body?.multiMarket?.consistencyGuard??null,crossCoreConsistency:body?.multiMarketIntegration?.crossCoreConsistency??null,reason:body?.multiMarketIntegration?.reason??null},
    multiMarket:compactMultiMarket(body?.multiMarket),
    practicalOutput:output?{version:output.version??null,final:output.final??null,primary:output.primary??null,quality:output.quality??null,gates:output.gates??null,rules:output.rules??null,marketSummary:output.marketSummary??null,visibility:output.visibility??null,scoreline:output.scoreline??null,expectedGoals:output.expectedGoals??null}:null,
    responseMeta:{mode:'compact',contract:COMPACT_CONTRACT}
  };
  compact.responseMeta.bytes=JSON.stringify(compact).length;
  return compact;
}

function shouldCompactPredict(request:Request,input:any){
  const requested=String(input?.response_mode??'').toLowerCase();
  if(requested==='full')return false;
  if(requested==='compact')return true;
  const host=new URL(request.url).hostname;
  return host===GPT_PRODUCTION_HOST&&!request.headers.get('origin');
}

function fullPredictRequest(request:Request,input:any){
  const next={...(input??{}),response_mode:'full'};
  return new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(next)});
}

function fixtureOdds(row:FeedRow,input:any){
  const override=input?.odds_by_fixture?.[row.providerId]??input?.odds_by_fixture?.[`${row.home} vs ${row.away}`];
  if(override?.values)return override;
  return{values:{},metadata:{verified:false,source:'NONE'}};
}

function suppliedProvider(row:FeedRow,input:any){
  const candidate=(Array.isArray(input?.fixture_candidates)?input.fixture_candidates:[]).find((item:any)=>String(item?.providerId??'').trim()===row.providerId);
  return String(candidate?.provider??'').trim()||'EXTERNAL_SUPPLIED';
}

async function predictSupplied(row:FeedRow,input:any,env:Env,ctx:ExecutionContext){
  const request=new Request('https://cfi.internal/api/predict',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({home:row.home,away:row.away,target_date:row.targetDate,language:'vi',input_mode:'DISCOVER_TOP_MATCHES',odds:fixtureOdds(row,input),response_mode:'full'})
  });
  const response=await v4.fetch(request,env,ctx);
  const body:any=await readJson(response);patchRuntimeTelemetry(body);
  return{response,body};
}

function diagnostic(row:FeedRow,response:Response,body:any,score:any){
  const strictPrior=body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true;
  const success=response.ok&&(body?.status==='SUCCESS'||body?.status==='DATA_READY');
  return{match:`${row.home} vs ${row.away}`,providerId:row.providerId,predictionHttpStatus:response.status,predictionStatus:body?.status??null,predictionError:body?.error??null,strictPrior,eligible:score?.eligible===true,reasonCode:success?strictPrior?(score?.eligible?'ELIGIBLE':'NO_RANKING_SIGNAL'):'STRICT_PRIOR_NOT_VERIFIED':body?.error??body?.status??'PREDICTION_FAILED',evidence:compactEvidence(body?.evidence),temporalEvidenceAudit:body?.temporalEvidenceAudit??body?.strictPriorAudit?.evidence??null};
}

async function suppliedDiscovery(input:any,env:Env,ctx:ExecutionContext){
  const targetDate=String(input?.target_date??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh');
  const maxMatches=Math.max(1,Math.min(10,Number(input?.max_matches??5)||5));
  const window={targetDate,timeZone,startTime:input?.start_time??null,endTime:input?.end_time??null,minimumRows:1};
  const normalized=normalizeAiFixtureCandidates(input.fixture_candidates,window);
  const rows=normalized.rows as FeedRow[];
  const evaluated:any[]=[];const diagnostics:any[]=[];let predictionSuccess=0;

  for(let offset=0;offset<rows.length;offset+=4){
    const batch=rows.slice(offset,offset+4);
    const results=await Promise.all(batch.map(async row=>({row,result:await predictSupplied(row,input,env,ctx)})));
    for(const {row,result} of results){
      const score=scorePrediction(result.body);
      const strictPrior=result.body?.strictPrior?.verified===true||result.body?.strictPriorAudit?.evidence?.verified===true;
      const engineSucceeded=result.response.ok&&(result.body?.status==='SUCCESS'||result.body?.status==='DATA_READY');
      if(engineSucceeded)predictionSuccess++;
      diagnostics.push(diagnostic(row,result.response,result.body,score));
      if(engineSucceeded&&strictPrior&&score?.eligible)evaluated.push({row,body:result.body,score});
    }
  }

  const priority:Record<string,number>={BET:3,LEAN:2,WATCH:1,SHADOW:0};
  const board=evaluated.map(({row,body,score})=>{
    const practical=body?.outputV3,primary=practical?.primary;
    const requestedStatus=practical?.final==='BET'?'BET':practical?.final==='LEAN'?'LEAN':'WATCH';
    const decisionUse=primary?.decisionUse===true&&primary?.researchState!=='SHADOW';
    const status=decisionUse?requestedStatus:'WATCH';
    return{
      match:`${row.home} vs ${row.away}`,home:row.home,away:row.away,competition:row.competition,country:row.country,kickoff:row.kickoffIso,kickoffLocal:row.kickoffLocal,
      provider:suppliedProvider(row,input),providerId:row.providerId,fixtureProvenance:row.sourceUrls??null,discoveredAt:row.discoveredAt??null,inputMode:'FIXTURE_SET_RANKING',cohort:fixtureCohort(row as any),
      bestMarket:primary?.market??score?.best?.market??null,modelProbability:primary?.probability??score?.best?.probability??null,fairOdds:primary?.fairOdds??score?.best?.fairOdds??null,selectionScore:score?.score??null,confidence:primary?.confidence??score?.best?.confidence??null,
      status,strictPrior:true,consistency:body?.consistencyGuard?.status??null,multiMarketStatus:body?.multiMarketIntegration?.status??body?.multiMarket?.mode??null,multiMarketDecisionUse:body?.multiMarketIntegration?.decisionUse===true||body?.multiMarket?.decisionUse===true,
      threePlusHtSafety:body?.threePlusHtSafety??body?.marketCoherence?.extremeThresholdSafety?.threePlusHt??null,
      sevenPlusFtSafety:body?.sevenPlusFtSafety??body?.marketCoherence?.extremeThresholdSafety?.sevenPlusFt??null,
      marketCoherence:body?.marketCoherence??null,
      prediction:compactPrediction(body)
    };
  }).sort((a,b)=>(priority[b.status]??0)-(priority[a.status]??0)||Number(b.selectionScore??-9)-Number(a.selectionScore??-9)).slice(0,maxMatches);

  const actionable=board.filter(row=>row.status==='BET');
  const accepted=rows.length,received=Array.isArray(input?.fixture_candidates)?input.fixture_candidates.length:0,canonicalized=diagnostics.filter(d=>d.strictPrior===true).length;
  return Response.json({
    status:'OK',action:'CFI_DISCOVERY',version:CFI_DISCOVERY_VERSION,responseMode:'compact',targetDate,timeZone,provider:'SUPPLIED_FIXTURE_SET',sourceUrl:null,
    counts:{fixturesDiscovered:accepted,aiDiscoveredFixtures:accepted,databaseFixtures:0,publicProviderFixtures:0,canonicalized,distinctFixtures:accepted,scanned:accepted,predictionAttempts:accepted,predictionSuccess,fullPredictionsExecuted:predictionSuccess,successfulMatches:evaluated.length,eligible:evaluated.length,blocked:diagnostics.filter(d=>d.reasonCode!=='ELIGIBLE'&&d.reasonCode!=='NO_RANKING_SIGNAL').length,recommended:actionable.length,actionable:actionable.length,watch:board.filter(row=>row.status==='WATCH').length,shadowMarkets:board.filter(row=>row.multiMarketDecisionUse===false).length},
    search:{mode:'SUPPLIED_FIXTURE_ONLY',suppliedFixtureOnly:true,externalAcquisitionAllowed:false,canonicalFeedMerged:false,aiCandidatesReceived:received,aiCandidatesAccepted:accepted,aiCandidatesRejected:normalized.rejected,suppliedProviders:[...new Set(rows.map(row=>suppliedProvider(row,input)))],internalProviderDiagnostics:false,providerFallbackTriggered:false,workerProviderFallbackAllowed:false,canonicalFeedOwnsProviderFallback:false,candidatePoolExhausted:evaluated.length<maxMatches},
    diagnostics:diagnostics.slice(0,20),providerAttempts:[],
    rules:{strictPriorRequired:true,suppliedFixtureOnly:true,providerFallbackOnShortfall:false,externalAcquisitionAllowed:false,noForcedBet:true,noForcedFive:true,shadowDecisionUse:false,threePlusHtCalibrationRequired:true,sevenPlusFtCalibrationRequired:true,extremeThresholdAliasBypassForbidden:true},
    runtime:{engine:FINAL_VERSION,extremeThresholdSafety:{threePlusHt:THREE_PLUS_HT_SAFETY_VERSION,sevenPlusFt:SEVEN_PLUS_FT_SAFETY_VERSION,marketCoherence:MARKET_COHERENCE_VERSION}},
    board,topPicks:actionable.slice(0,3),final:actionable.length?'PRACTICAL_BETS_READY':board.length?'WATCHLIST_READY':'NO_BET',
    provenance:{fixtureSource:'SUPPLIED_FIXTURE_SET',discoveryStrategy:'SUPPLIED_FIXTURES_THEN_PRODUCTION_PREDICT_THEN_RANK',noDuplicatePredictionEngine:true,noCanonicalFeedMerge:true,noProviderFallback:true}
  });
}

export default{
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(request.url);
    if(url.pathname==='/api/match-context'&&request.method==='POST')return matchContext(request,env);

    if(url.pathname==='/api/discover'&&request.method==='POST'){
      let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});}
      if(Array.isArray(input?.fixture_candidates))return suppliedDiscovery(input,env,ctx);
      return v4.fetch(request,env,ctx);
    }

    if(url.pathname==='/api/predict'&&request.method==='POST'){
      let input:any={};try{input=await request.clone().json()}catch{}
      const response=await v4.fetch(fullPredictRequest(request,input),env,ctx);
      if(!response.headers.get('content-type')?.includes('application/json'))return response;
      const body:any=await readJson(response);patchRuntimeTelemetry(body);
      if(!response.ok||!shouldCompactPredict(request,input))return Response.json(body,{status:response.status});
      return Response.json(compactPrediction(body),{status:response.status});
    }

    if((url.pathname==='/api/status'||url.pathname==='/health')&&request.method==='GET'){
      const response=await v4.fetch(request,env,ctx);
      if(!response.headers.get('content-type')?.includes('application/json'))return response;
      const body:any=await readJson(response);patchRuntimeTelemetry(body);
      body.extremeThresholdSafety=body.runtime.extremeThresholdSafety;
      return Response.json(body,{status:response.status});
    }

    return v4.fetch(request,env,ctx);
  }
} satisfies ExportedHandler<Env>;
