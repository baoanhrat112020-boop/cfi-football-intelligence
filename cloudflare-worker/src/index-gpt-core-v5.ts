import v4 from './index-gpt-core-v4.ts';
import { handleMatchContext } from '../../src/runtime/match-context.ts';
import { fixtureCohort, normalizeAiFixtureCandidates, scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';
import { FINAL_VERSION } from '../../src/prediction/final-engine.ts';
import { THREE_PLUS_HT_SAFETY_VERSION } from '../../src/prediction/three-plus-ht-safety.ts';
import { SEVEN_PLUS_FT_SAFETY_VERSION } from '../../src/prediction/seven-plus-ft-safety.ts';
import { MARKET_COHERENCE_VERSION } from '../../src/prediction/market-coherence.ts';
import { handleFixturesDayRequest } from '../../src/runtime/fixtures-day-fast.ts';
import { poissonExtraMarkets } from '../../src/prediction/poisson-markets.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;SUPABASE_SERVICE_KEY?:string;AI?:Ai};
const TIER_C_LOG_SUPABASE_URL='https://kovmddkkzttquupdgmel.supabase.co';
type FeedRow={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string;sourceUrls?:string[];discoveredAt?:string};

const GPT_PRODUCTION_HOST='cfi-football-intelligence.baoanhrat112020.workers.dev';
const COMPACT_CONTRACT='CFI_GPT_PREDICT_COMPACT_V2_EXTREME_THRESHOLD_SAFETY';
const TIER_C_MIN_EVIDENCE=3;
const THRESHOLD_TARGETS=['3+ HT','7+ FT','Other HT','Other FT'] as const;

async function readJson(response:Response){try{return await response.clone().json()}catch{return null}}
const finite=(value:any)=>Number.isFinite(Number(value))?Number(value):null;

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

function tierAExtraMarkets(body:any){
  const mm=body?.multiMarket&&typeof body.multiMarket==='object'?body.multiMarket:null;
  const pickMax=(market:string,options:[string,number|null][])=>{
    if(options.some(o=>o[1]===null))return null;
    const best=[...options].sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
    const probability=Number((best[1] as number).toFixed(4));
    return{market,group:'popular',pick:best[0],probability,fairOdds:probability>0?Number((1/probability).toFixed(2)):null,decision:'WATCH',confidence:null};
  };
  const one=mm?.oneXTwo?.ft,ou=mm?.overUnder?.ft?.['2.5'];
  const eg=body?.scoreline?.expectedGoals;
  let lh=finite(eg?.ftHome??body?.outputV3?.expectedGoals?.ft?.home??body?.expectedGoals?.home),la=finite(eg?.ftAway??body?.outputV3?.expectedGoals?.ft?.away??body?.expectedGoals?.away);
  if(lh===null||la===null){const total=finite(body?.outputV3?.expectedGoals?.ft?.total);if(total!==null&&total>=0){lh=total*0.55;la=total*0.45}}
  // Poisson approx, khong phai engine chuan — thay bang multi-market-v1 khi co
  const bttsYes=lh!==null&&la!==null&&lh>=0&&la>=0?(1-Math.exp(-lh))*(1-Math.exp(-la)):null;
  return[
    one?pickMax('1X2 FT',[['HOME',finite(one.home)],['DRAW',finite(one.draw)],['AWAY',finite(one.away)]]):null,
    ou?pickMax('O/U 2.5 FT',[['OVER',finite(ou.over?.fullWin)],['UNDER',finite(ou.under?.fullWin)]]):null,
    bttsYes!==null?pickMax('BTTS FT',[['YES',bttsYes],['NO',1-bttsYes]]):null,
    ...(lh!==null&&la!==null?poissonExtraMarkets(lh,la):[])
  ].filter(Boolean);
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
    extraMarkets:tierAExtraMarkets(body),
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

const TIER_EVIDENCE_TTL_MS=10*60*1000;
const tierEvidenceCache=new Map<string,{n:number|null;exp:number}>();
async function enrichFixturesWithTier(rows:any[],env:Env):Promise<any[]>{
  const noTier=()=>rows.map(r=>({...r,tier:null}));
  if(!env.SUPABASE_SERVICE_KEY)return noTier();
  try{
    const now=Date.now();
    const names=[...new Set(rows.flatMap(r=>[r?.home,r?.away]).filter((x:any)=>typeof x==='string'&&x))] as string[];
    const missing=names.filter(n=>{const c=tierEvidenceCache.get(n);return !c||c.exp<=now});
    if(missing.length){
      const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/teams_evidence_batch`,{method:'POST',headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_team_names:missing}),signal:AbortSignal.timeout(3000)});
      if(!res.ok)return noTier();
      const got:any=await res.json();
      if(!Array.isArray(got))return noTier();
      const found=new Map<string,number>(got.map((g:any)=>[String(g.canonical_name),Number(g.evidence_count)||0]));
      missing.forEach(n=>tierEvidenceCache.set(n,{n:found.has(n)?found.get(n) as number:null,exp:now+TIER_EVIDENCE_TTL_MS}));
    }
    return rows.map(r=>{
      const h=tierEvidenceCache.get(r?.home)?.n,a=tierEvidenceCache.get(r?.away)?.n;
      if(h===undefined||a===undefined)return{...r,tier:null};
      if(h===null||a===null)return{...r,tier:'C0'};
      return{...r,tier:h===0&&a===0?'C0':(h<3||a<3?'C':'A')};
    });
  }catch{return noTier()}
}

export default{
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(request.url);
    if(url.pathname==='/api/match-context')return handleMatchContext(request,env);
    if(url.pathname==='/api/fixtures-day'&&request.method==='POST'){
      const dayResp=await handleFixturesDayRequest(request,env);
      if(!dayResp.ok||!dayResp.headers.get('content-type')?.includes('application/json'))return dayResp;
      try{
        const dayBody:any=await dayResp.clone().json();
        if(!Array.isArray(dayBody?.rows))return dayResp;
        dayBody.rows=await enrichFixturesWithTier(dayBody.rows,env);
        const dayHeaders=new Headers(dayResp.headers);dayHeaders.delete('content-length');dayHeaders.delete('content-encoding');
        return Response.json(dayBody,{status:dayResp.status,headers:dayHeaders});
      }catch{return dayResp}
    }

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
      const TIER_C_ERRORS=['ZERO_EXACT_TEAM_EVIDENCE','INSUFFICIENT_TEAM_EVIDENCE','INSUFFICIENT_DATA','EVIDENCE_INSUFFICIENT'];
      const evidenceCounts=body?.evidence?.counts??body?.evidence;
      const homeEvidence=finite(evidenceCounts?.homeFixtures??evidenceCounts?.home),awayEvidence=finite(evidenceCounts?.awayFixtures??evidenceCounts?.away);
      const thinEvidence=response.ok&&homeEvidence!==null&&awayEvidence!==null&&(homeEvidence<TIER_C_MIN_EVIDENCE||awayEvidence<TIER_C_MIN_EVIDENCE);
      if((!response.ok&&body?.error&&TIER_C_ERRORS.includes(String(body.error)))||thinEvidence){
        try{
          const tcReq=new Request('https://cfi.internal/api/match-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:input?.home,away:input?.away,target_date:input?.target_date})});
          const tcResp=await handleMatchContext(tcReq,env);
          const tcBody:any=await readJson(tcResp);
          if(tcBody?.status==='OK_TIER_C'&&tcBody?.prediction){
            const pr=tcBody.prediction;
            const mp=Math.max(pr.p_home,pr.p_draw,pr.p_away);
            const pick=pr.p_home===mp?'HOME':pr.p_away===mp?'AWAY':'DRAW';
            const pem=poissonExtraMarkets(Number(pr.xg_home),Number(pr.xg_away),'LOW');const pm:any={};pem.forEach((m:any)=>{pm[m.market]=m.probability});
            const tc:any={status:'SUCCESS',engine:FINAL_VERSION,tierC:true,tierCModel:pr.model,extraMarkets:pem,target:tcBody.target,tierCReason:tcBody.reason,tierCEvidenceCount:tcBody.evidenceCount,strictPrior:{required:false,verified:false,tierCFallback:true},evidence:{counts:{home:tcBody.evidenceCount?.home??0,away:tcBody.evidenceCount?.away??0,h2h:0}},outputV3:{version:'CFI_TIER_C_V1',final:'WATCH',primary:{market:'1X2_FT',pick:pick,probability:mp,confidence:'LOW',fairOdds:Number((1/mp).toFixed(2)),decisionUse:false,researchState:'TIER_C_ELO_FALLBACK'},gates:{strictPrior:false,evidenceSufficient:false,consistency:true,tierCFallback:true},quality:{dataQuality:'LOW',modelAgreement:'LOW',predictionGrade:'C'},probabilities:{home:pr.p_home,draw:pr.p_draw,away:pr.p_away},markets6:pr.markets6||[],topScorelines:pr.topScorelines||[],expectedGoals:{home:pr.xg_home,away:pr.xg_away,total:Number((Number(pr.xg_home)+Number(pr.xg_away)).toFixed(2))},elo:{home:pr.elo_home,away:pr.elo_away},lowSample:pr.low_sample===true,marketSummary:{oneXTwo:{ft:{modelPick:pick,modelProbability:mp}}},primaryTargets:{contract:'CFI_TIER_C',count:6,codes:['HOME','DRAW','AWAY','OVER 2.5','UNDER 2.5','BTTS YES']},visibility:{tierC:true,reason:'ELO_ONLY_FALLBACK'}}};
            if(env.SUPABASE_SERVICE_KEY)ctx.waitUntil(fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/tier_c_log`,{method:'POST',headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({match_id:`${tcBody.identity?.homeTeamId}_${tcBody.identity?.awayTeamId}_${tcBody.target?.date}`,home_team:tcBody.target?.home,away_team:tcBody.target?.away,p_home:pr.p_home,p_draw:pr.p_draw,p_away:pr.p_away,p_over25:pr.p_over25,p_btts:pr.p_btts,p_o05_ht:pm['O0.5 HT'],p_o15_ht:pm['O1.5 HT'],p_btts_h1:pm['BTTS H1'],p_o35_ft:pm['O3.5 FT'],p_o45_ft:pm['O4.5 FT'],p_o55_ft:pm['O5.5 FT'],p_2_3_ft:pm['2-3 FT'],p_4_6_ft:pm['4-6 FT'],xg_home:pr.xg_home,xg_away:pr.xg_away,elo_home:pr.elo_home,elo_away:pr.elo_away,model:'elo_prior_v3.1'})}).catch(()=>{}));
            patchRuntimeTelemetry(tc);
            return Response.json(tc,{status:200});
          }
        }catch(_e){}
      }
      if(response.ok&&body&&typeof body==='object')body.extraMarkets=tierAExtraMarkets(body);
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

