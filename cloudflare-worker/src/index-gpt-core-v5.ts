import v4 from './index-gpt-core-v4.ts';
import { isDryRun } from './dry-run.ts';
import { enrichLive } from './live-livescore.ts';
import { handleMatchContext } from '../../src/runtime/match-context.ts';
import { fixtureCohort, normalizeAiFixtureCandidates, scorePrediction, CFI_DISCOVERY_VERSION } from '../../src/discovery/cfi-discovery.ts';
import { FINAL_VERSION } from '../../src/prediction/final-engine.ts';
import { THREE_PLUS_HT_SAFETY_VERSION } from '../../src/prediction/three-plus-ht-safety.ts';
import { SEVEN_PLUS_FT_SAFETY_VERSION } from '../../src/prediction/seven-plus-ft-safety.ts';
import { MARKET_COHERENCE_VERSION } from '../../src/prediction/market-coherence.ts';
import { handleFixturesDayRequest } from '../../src/runtime/fixtures-day-fast.ts';
import { poissonExtraMarkets } from '../../src/prediction/poisson-markets.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;SUPABASE_SERVICE_KEY?:string;DEBUG?:string;AI?:Ai};
const TIER_C_LOG_SUPABASE_URL='https://zbwkowqluwuvsnajkuvc.supabase.co';
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

function tierALambda(body:any){
  const eg=body?.scoreline?.expectedGoals??body?.practicalOutput?.scoreline?.expectedGoals;
  let lh=finite(eg?.ftHome??body?.outputV3?.expectedGoals?.ft?.home??body?.practicalOutput?.expectedGoals?.ft?.home??body?.expectedGoals?.home),la=finite(eg?.ftAway??body?.outputV3?.expectedGoals?.ft?.away??body?.practicalOutput?.expectedGoals?.ft?.away??body?.expectedGoals?.away);
  if(lh===null||la===null){const total=finite(body?.outputV3?.expectedGoals?.ft?.total??body?.practicalOutput?.expectedGoals?.ft?.total);if(total!==null&&total>=0){lh=total*0.55;la=total*0.45}}
  return lh!==null&&la!==null&&lh>=0&&la>=0?{home:Number(lh.toFixed(3)),away:Number(la.toFixed(3))}:null;
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

const HT_ALT_LINES:[number,string][]=[[0.5,'s_over05_ht'],[0.75,'s_over075_ht'],[1,'s_over1_ht'],[1.25,'s_over125_ht'],[1.5,'s_over15_ht'],[1.75,'calc'],[2,'calc']];
const FT_ALT_LINES:[number,string][]=[[1.5,'s_over_15_ft'],[2,'s_over_2_ft'],[2.25,'s_over_225_ft'],[2.5,'s_over_25_ft'],[2.75,'s_over_275_ft'],[3,'s_over_3_ft'],[3.25,'s_over_325_ft'],[3.5,'s_over_35_ft']];
function htAltP(m:any,ln:number,key:string):number|undefined{
  if(key!=='calc')return typeof m[key]==='number'?m[key]:undefined;
  const p05=m.s_over05_ht;
  if(typeof p05!=='number'||!(p05>0&&p05<1))return undefined;
  const l=-Math.log(1-p05),e=Math.exp(-l),q2=l*l/2*e,q3=1-e*(1+l+l*l/2);
  return ln===1.75?q3+0.75*q2:q3+0.5*q2;
}
function ouMarketOdds(m:any,t:string,ln:any):number|null{
  if(typeof ln!=='number'||!Array.isArray(m?.market_odds))return null;
  const per=t==='ou_ht'?'HT':'FT';
  for(const o of m.market_odds){
    if(String(o?.family||'').toUpperCase()!=='OVER_UNDER'||String(o?.period||'').toUpperCase()!==per)continue;
    if(Math.abs(Number(o.line)-ln)>1e-6)continue;
    const v=Number(o.odds_over);
    if(Number.isFinite(v)&&v>1&&v<50)return v;
  }
  return null;
}
function parlayLegs(m:any,rate:((m:any,t:string,line:number|null)=>number|null)|null){
  const r:any[]=[];
  const add=(t:string,mk:any,raw:any,line:any)=>{
    if(typeof raw!=='number'||!mk)return;
    if(t==='ou_ft'&&!(typeof line==='number'&&line>=2.5))return;
    if(t==='ou_ht'&&!(typeof line==='number'&&line>=0.75&&line<=1.75))return;
    let p=raw;
    if(rate){
      const h=rate(m,t,typeof line==='number'?line:null);
      if(h==null)return;
      p=raw*Math.sqrt(h);
    }
    const alts:any[]=[];
    const lines=t==='ou_ht'?HT_ALT_LINES:t==='ou_ft'?FT_ALT_LINES:[];
    for(const [ln,key] of lines){
      const a=t==='ou_ht'?htAltP(m,ln as number,key as string):m[key as string];
      if(typeof a!=='number')continue;
      let ap=a;
      if(rate){const h2=rate(m,t,ln as number);if(h2==null)continue;ap=a*Math.sqrt(h2)}
      alts.push({line:ln,p:Math.round(ap*10000)/10000,odds:ouMarketOdds(m,t,ln)});
    }
    r.push({fixture_id:m.fixture_id,home:m.home,away:m.away,kickoff:m.kickoff,competition:m.competition||null,type:t,market:mk,line:typeof line==='number'?line:null,odds:ouMarketOdds(m,t,line),raw,p:Math.round(p*10000)/10000,alts});
  };
  add('ou_ft',m.selected_ft_market,m.selected_ft_p,m.selected_ft_line);
  add('ou_ht',m.selected_ht_market,m.selected_ht_p,m.selected_ht_line);
  add('btts','btts_yes',m.markets?.m_btts_yes,null);
  add('btts_ht','btts_ht_yes',bttsHtP(m),null);
  return r;
}
function bttsHtP(m:any):number|undefined{
  const p15=Number(m?.markets?.m_over_1_5_ft),pb=Number(m?.markets?.m_btts_yes);
  if(!(p15>0&&p15<1&&pb>0&&pb<1))return undefined;
  let lo=0.01,hi=12;
  for(let i=0;i<50;i++){const L=(lo+hi)/2;if(1-Math.exp(-L)*(1+L)<p15)lo=L;else hi=L;}
  const L=(lo+hi)/2;
  let a=0.001,b=L/2;
  for(let i=0;i<50;i++){const x=(a+b)/2;if((1-Math.exp(-x))*(1-Math.exp(-(L-x)))<pb)a=x;else b=x;}
  const lh=(a+b)/2,la=L-lh;
  return Math.round((1-Math.exp(-lh/2))*(1-Math.exp(-la/2))*10000)/10000;
}
function enumerateParlays(pool:any[],k:number,accept:(c:any[])=>boolean){
  const out:any[][]=[],cur:any[]=[],used=new Set<string>();
  const rec=(i:number)=>{
    if(cur.length===k){if(accept(cur))out.push(cur.slice());return}
    for(let j=i;j<pool.length;j++){
      if(used.has(pool[j].fixture_id))continue;
      used.add(pool[j].fixture_id);cur.push(pool[j]);rec(j+1);cur.pop();used.delete(pool[j].fixture_id);
    }
  };
  rec(0);
  return out;
}
function topParlays(legs:any[],kmin:number,kmax:number,scope:string,minSame:number=0.60,minMix:number=0.55){
  const res:any[]=[];
  const finish=(kind:string,pool:any[],minP:number,accept:(c:any[])=>boolean)=>{
    const p=pool.filter(l=>l.raw>=(l.type==='btts_ht'?0.3:minP)).sort((a,b)=>b.p-a.p).slice(0,kmax>=7?9:8);
    const all:any[]=[];
    for(let k=kmin;k<=kmax;k++)for(const c of enumerateParlays(p,k,accept))all.push({type:kind,scope,legs:c,min_p:Math.min(...c.map(l=>l.p)),combined_p:Math.round(c.reduce((a,l)=>a*l.p,1)*10000)/10000});
    all.sort((a,b)=>b.combined_p-a.combined_p);
    const keep:any[]=[];
    for(const x of all){
      const ids=new Set(x.legs.map((l:any)=>l.fixture_id));
      if(keep.every(y=>y.legs.filter((l:any)=>ids.has(l.fixture_id)).length<=Math.min(y.legs.length,x.legs.length)-2))keep.push(x);
      if(keep.length===3)break;
    }
    res.push(...keep);
  };
  for(const t of ['ou_ft','ou_ht','btts','btts_ht'])finish('same:'+t,legs.filter(l=>l.type===t),minSame,()=>true);
  finish('mix',legs,minMix,c=>new Set(c.map(l=>l.type)).size>=2);
  return res;
}
function parlayPkey(x:any):string{return x.scope+'|'+x.type+'|'+x.legs.map((l:any)=>l.fixture_id+':'+l.type).join(',')}
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parlayLogRows(mode:string,parlays:any[]){
  return parlays.filter(x=>x.legs.every((l:any)=>UUID_RE.test(String(l.fixture_id))&&l.kickoff)).map(x=>({mode,pkey:x.pkey,day:String(x.legs[0].kickoff).substring(0,10),scope:x.scope,ptype:x.type,n_legs:x.legs.length,system_p:x.combined_p,legs:x.legs.map((l:any)=>({fixture_id:l.fixture_id,home:l.home,away:l.away,kickoff:l.kickoff,type:l.type,market:l.market,line:l.line,p:l.p,odds:l.odds??null}))}));
}
const EXCLUDE_RE=/\bU1[0-8]\b|\b(Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\b/i;
function hasOuOdds(m:any):boolean{return Array.isArray(m?.market_odds)&&m.market_odds.some((o:any)=>String(o?.family||'').toUpperCase()==='OVER_UNDER'&&Number(o?.odds_over)>1)}
const FT_LINE_TABLE:[number,string,string][]=[[1.5,'over_15_ft','s_over_15_ft'],[2,'over_2_ft','s_over_2_ft'],[2.25,'over_225_ft','s_over_225_ft'],[2.5,'over_25_ft','s_over_25_ft'],[2.75,'over_275_ft','s_over_275_ft'],[3,'over_3_ft','s_over_3_ft'],[3.25,'over_325_ft','s_over_325_ft'],[3.5,'over_35_ft','s_over_35_ft']];
function alignFtPick(m:any):any{
  let market:string|null=null,line:number|null=null,p:number|null=null;
  const mk=Array.isArray(m?.market_odds)?m.market_odds.find((o:any)=>String(o?.family||'').toUpperCase()==='OVER_UNDER'&&String(o?.period||'').toUpperCase()==='FT'&&Number.isFinite(Number(o?.line))):null;
  if(mk){
    const L=Number(mk.line);
    const row=FT_LINE_TABLE.find(r=>Math.abs(r[0]-L)<1e-6&&r[0]>=2);
    if(row&&typeof m[row[2]]==='number'){market=row[1];line=row[0];p=m[row[2]]}
  }else{
    for(const r of [...FT_LINE_TABLE].reverse()){
      if(r[0]<2)continue;
      const v=m[r[2]];
      if(typeof v==='number'&&v>=0.55&&v<=0.70){market=r[1];line=r[0];p=v;break}
    }
  }
  if(p!==null&&p<0.5){market=null;line=null;p=null}
  if(market===(m.selected_ft_market??null))return m;
  const cands:[string,any][]=[['btts_yes',m?.markets?.m_btts_yes],['1x2_ht_home',m?.markets?.m_1x2_ht_home],['1x2_ft_home',m?.markets?.m_1x2_ft_home],[m.selected_ht_market,m.selected_ht_p],[market as any,p]];
  const best=cands.filter(c=>c[0]&&typeof c[1]==='number'&&c[1]>=0.5).sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1))[0];
  return Object.assign({},m,{selected_ft_market:market,selected_ft_line:line,selected_ft_p:p,top_market:best?best[0]:null,top_market_prob:best?best[1]:null});
}
function upcomingMatches(matches:any[],now:number,oddsOnly:boolean,hours:number):any[]{
  return matches.filter(m=>m?.kickoff&&Date.parse(m.kickoff)>now&&Date.parse(m.kickoff)<=now+hours*3600*1000&&!m.no_stats&&!EXCLUDE_RE.test(String(m.home||''))&&!EXCLUDE_RE.test(String(m.away||''))&&!EXCLUDE_RE.test(String(m.competition||''))&&(!oddsOnly||hasOuOdds(m)));
}
function scopeBucket(sc:string):string{
  const v=sc.slice(sc.indexOf(':')+1);
  if(v.length<=10)return 'D'+v;
  return v.substring(0,10)+'T'+Math.floor(Number(v.substring(11,13))/3);
}
function capScopesPerBucket(out:any[],perBucket:number):any[]{
  const best=new Map<string,number>();
  out.forEach(x=>best.set(x.scope,Math.max(best.get(x.scope)||0,x.combined_p)));
  const cnt=new Map<string,number>();
  const keep=new Set<string>();
  [...best.entries()].sort((a,b)=>b[1]-a[1]).forEach(([sc])=>{
    const b=scopeBucket(sc);
    const c=cnt.get(b)||0;
    if(c<perBucket){cnt.set(b,c+1);keep.add(sc)}
  });
  return out.filter(x=>keep.has(x.scope)).map(x=>({...x,pkey:parlayPkey(x)}));
}
function mkParlay(type:string,scope:string,legs:any[]){
  return {type,scope,legs,min_p:Math.min(...legs.map(l=>l.p)),combined_p:Math.round(legs.reduce((a,l)=>a*l.p,1)*10000)/10000};
}
const XM:[string,string,number][]=[['3+ HT','x3ht',0.25],['Other HT','xoht',0.08],['Other FT','xoft',0.20],['7+ FT','x7ft',0.15]];
function extremeLegs(m:any,hitOnly:boolean):any[]{
  const r:any[]=[];
  for(const [name,t,th] of XM){
    const p=m?.probs?.[name];
    if(typeof p!=='number'||!(p>0))continue;
    const hit=Array.isArray(m.hit_markets)&&m.hit_markets.includes(name);
    if(hitOnly&&!hit)continue;
    let mult=1;
    if(Array.isArray(m.flags)){
      const f=m.flags.find((x:any)=>x?.market===name);
      if(f?.flag==='HIGH')mult=1.2;else if(f?.flag==='MEDIUM')mult=1.1;
    }
    r.push({fixture_id:m.fixture_id,home:m.home,away:m.away,kickoff:m.kickoff,competition:m.competition||null,type:t,market:t,line:null,odds:null,raw:p,p:Math.round(p*10000)/10000,alts:[],ratio:p/th,w:p*mult,rw:(p/th)*mult});
  }
  return r;
}
function pickDistinct(sorted:any[],n:number):any[]{
  const used=new Set<string>(),out:any[]=[];
  for(const l of sorted){if(used.has(l.fixture_id))continue;used.add(l.fixture_id);out.push(l);if(out.length===n)break}
  return out;
}
function extremeFromPool(pool:any[],scope:string,sameKey:string,mixKey:string):any[]{
  const res:any[]=[];
  for(const [,t] of XM){
    const top=pickDistinct(pool.filter(l=>l.type===t).sort((a,b)=>b[sameKey]-a[sameKey]),3);
    for(let k=2;k<=top.length;k++)res.push(mkParlay('same:'+t,scope,top.slice(0,k)));
  }
  const mixTop=pickDistinct([...pool].sort((a,b)=>b[mixKey]-a[mixKey]),3);
  for(let k=2;k<=mixTop.length;k++){const c=mixTop.slice(0,k);if(new Set(c.map(l=>l.type)).size>=2)res.push(mkParlay('mix',scope,c))}
  return res;
}
function dedupeByLegs(list:any[]):any[]{
  const seen=new Set<string>(),out:any[]=[];
  for(const x of list){const k=x.type+'|'+x.legs.map((l:any)=>l.fixture_id+l.type).join(',');if(seen.has(k))continue;seen.add(k);out.push(x)}
  return out;
}
function buildExtremeSpecial(matches:any[],now:number):any[]{
  const up=upcomingMatches(matches,now,false,24);
  const out:any[]=[];
  [...new Set(up.map(m=>m.kickoff))].forEach((s:any)=>{
    const t0=Date.parse(s);
    const ms=up.filter(m=>{const t=Date.parse(m.kickoff);return t>=t0&&t<=t0+8*3600*1000});
    if(ms.length<2)return;
    out.push(...extremeFromPool(ms.flatMap(m=>extremeLegs(m,false)),'window_8h:'+s,'p','ratio'));
  });
  return capScopesPerBucket(dedupeByLegs(out),1);
}
function buildExtremeDaily(matches:any[],now:number):any[]{
  const up=upcomingMatches(matches,now,false,48);
  const byDay=new Map<string,any[]>();
  up.forEach(m=>{const d=String(m.kickoff).substring(0,10);const a=byDay.get(d)||[];a.push(m);byDay.set(d,a)});
  const out:any[]=[];
  byDay.forEach((ms,d)=>{out.push(...extremeFromPool(ms.flatMap(m=>extremeLegs(m,true)),'daily:'+d,'w','rw'))});
  return dedupeByLegs(out).map(x=>({...x,pkey:parlayPkey(x)}));
}
function buildSingles(matches:any[],now:number,oddsOnly:boolean):any[]{
  const up=upcomingMatches(matches,now,oddsOnly,24);
  const all:any[]=[];
  for(const m of up){
    for(const l of parlayLegs(m,null)){
      if(l.type==='btts_ht'||l.raw<0.55)continue;
      all.push(mkParlay('same:'+l.type,'single:'+m.kickoff,[l]));
    }
  }
  all.sort((a,b)=>b.combined_p-a.combined_p);
  const cnt=new Map<string,number>();
  const out:any[]=[];
  for(const x of all){
    const b=scopeBucket(x.scope);
    const c=cnt.get(b)||0;
    if(c<8){cnt.set(b,c+1);out.push(x)}
  }
  return out.map(x=>({...x,pkey:parlayPkey(x)}));
}
function buildSpecialTop(matches:any[],now:number,oddsOnly:boolean):any[]{
  const up=upcomingMatches(matches,now,oddsOnly,24);
  const out:any[]=[];
  [...new Set(up.map(m=>m.kickoff))].forEach((s:any)=>{
    const t0=Date.parse(s);
    const ms=up.filter(m=>{const t=Date.parse(m.kickoff);return t>=t0&&t<=t0+4*3600*1000});
    const pool=ms.flatMap(m=>parlayLegs(m,null)).filter(l=>l.type!=='btts_ht'&&l.raw>=0.5);
    const top=pickDistinct(pool.sort((a,b)=>b.p-a.p),7);
    for(let k=4;k<=top.length;k++)out.push(mkParlay('special','window_4h:'+s,top.slice(0,k)));
  });
  return capScopesPerBucket(dedupeByLegs(out),1);
}
function buildParlays(matches:any[],now:number,rate:((m:any,t:string,line:number|null)=>number|null)|null,oddsOnly:boolean){
  const up=upcomingMatches(matches,now,oddsOnly,24);
  const legCache=new Map<string,any[]>();
  const legsOf=(m:any):any[]=>{let v=legCache.get(m.fixture_id);if(!v){v=parlayLegs(m,rate);legCache.set(m.fixture_id,v)}return v};
  const byKick=new Map<string,any[]>();
  up.forEach(m=>{const a=byKick.get(m.kickoff)||[];a.push(m);byKick.set(m.kickoff,a)});
  const out:any[]=[];
  byKick.forEach((ms,k)=>{if(ms.length>=3)out.push(...topParlays(ms.flatMap(legsOf),3,5,'same_hour:'+k))});
  let lastWin='';
  [...byKick.keys()].forEach(s=>{
    const t0=Date.parse(s);
    const ms=up.filter(m=>{const t=Date.parse(m.kickoff);return t>=t0&&t<=t0+4*3600*1000});
    const wk=ms.map((m:any)=>m.fixture_id).join(',');
    if(wk===lastWin)return;
    lastWin=wk;
    if(ms.length>=5)out.push(...topParlays(ms.flatMap(legsOf),5,7,'window_4h:'+s));
  });
  const byDay=new Map<string,any[]>();
  up.forEach(m=>{const d=String(m.kickoff).substring(0,10);const a=byDay.get(d)||[];a.push(m);byDay.set(d,a)});
  byDay.forEach((ms,d)=>{if(ms.length>=3&&new Set(ms.map(m=>m.kickoff)).size>1)out.push(...topParlays(ms.flatMap(legsOf),3,5,'any_time:'+d))});
  const bySeg=new Map<string,any[]>();
  up.forEach(m=>{const k=String(m.kickoff);const h=Math.floor(Number(k.substring(11,13))/6)*6;const key=k.substring(0,10)+'T'+String(h).padStart(2,'0')+':00';const a=bySeg.get(key)||[];a.push(m);bySeg.set(key,a)});
  bySeg.forEach((ms,key)=>{if(ms.length>=2&&new Set(ms.map(m=>m.kickoff)).size>1)out.push(...topParlays(ms.flatMap(legsOf),2,4,'seg6:'+key,0.5,0.5))});
  return capScopesPerBucket(out,2);
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

async function fetchTeamWarnings(env:any,home:string,away:string):Promise<any[]>{
  if(!env.SUPABASE_SERVICE_KEY)return[];
  const names=[home,away].filter(Boolean);
  if(names.length===0)return[];
  try{
    const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_team_tendency_by_names`,{
      method:'POST',
      headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_names:names}),
      signal:AbortSignal.timeout(2500)
    });
    if(!res.ok)return[];
    const rows:any=await res.json();
    return Array.isArray(rows)?rows.map((r:any)=>({
      team:r.team_name,market:r.market,flag:r.flag,
      nMatches:r.n_matches,nEvents:r.n_events,
      rate:Number(r.rate),lift:Number(r.lift)
    })):[];
  }catch(_e){return[]}
}

async function fetchTeamStatsLambda(env:Env,home:string,away:string){
  if(!env.SUPABASE_SERVICE_KEY||!home||!away)return null;
  try{
    const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_team_lambda_by_names`,{
      method:'POST',
      headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({home_name:home,away_name:away}),
      signal:AbortSignal.timeout(2500)
    });
    if(!res.ok)return null;
    const r:any=await res.json();
    const h=Number(r?.lambda_home_ft),a=Number(r?.lambda_away_ft);
    if(!Number.isFinite(h)||!Number.isFinite(a)||h<0||a<0)return null;
    return{lambdaFT:{home:h,away:a},source:String(r?.source??'team_stats')};
  }catch(_e){return null}
}

const OU_FIXTURE_SEEN=new Map<string,number>();
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

    if(url.pathname==='/api/suggest-parlays'&&request.method==='GET'){
      try{
        const modeQ=url.searchParams.get('mode')||'';
        const mode=['round','special','xspecial','xdaily','single'].includes(modeQ)?modeQ:'suggest';
        const isX=mode==='xspecial'||mode==='xdaily';
        const key=(env as any).SUPABASE_SERVICE_KEY;
        const hdr={'apikey':key,'Authorization':`Bearer ${key}`};
        const today=new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);
        const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/suggest_snapshot?snapshot_date=eq.${today}&select=payload,generated_at&limit=1`,{headers:hdr});
        if(!res.ok)return Response.json({error:'snapshot fetch failed'},{status:500});
        const rows:any=await res.json();
        const all:any[]=[];
        if(Array.isArray(rows?.[0]?.payload?.slots))rows[0].payload.slots.forEach((s:any)=>{if(Array.isArray(s?.matches))s.matches.forEach((m:any)=>all.push(m))});
        let rate:any=null;
        if(mode==='round'){
          const rr=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_round_hit_rates`,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},hdr),body:'{}'});
          const hr:any=rr.ok?await rr.json():{};
          rate=(m:any,t:string,line:number|null)=>{
            const h=hr[String(m.competition||'').toLowerCase()];
            if(!h)return null;
            if(t==='btts')return h.btts_ft;
            if(t==='btts_ht')return typeof h.btts_ht==='number'?h.btts_ht:null;
            if(line==null)return null;
            const col=t==='ou_ht'?(line<=0.75?'o05_ht':'o15_ht'):(line<=1.75?'o15_ft':line<=2.75?'o25_ft':'o35_ft');
            return typeof h[col]==='number'?h[col]:null;
          };
        }
        const oddsOnly=!isX&&url.searchParams.get('odds')!=='0';
        const buildStd=(oo:boolean):any[]=>mode==='special'?buildSpecialTop(all,Date.now(),oo):mode==='single'?buildSingles(all,Date.now(),oo):buildParlays(all,Date.now(),rate,oo);
        let built:any[];
        if(mode==='xspecial')built=buildExtremeSpecial(all,Date.now()).map((x:any)=>({...x,odds_ok:true}));
        else if(mode==='xdaily')built=buildExtremeDaily(all,Date.now()).map((x:any)=>({...x,odds_ok:true}));
        else if(oddsOnly)built=buildStd(true).map((x:any)=>({...x,odds_ok:true}));
        else{
          const withOdds=buildStd(true).map((x:any)=>({...x,odds_ok:true}));
          const seen=new Set(withOdds.map((x:any)=>x.pkey));
          built=[...withOdds,...buildStd(false).filter((x:any)=>!seen.has(x.pkey)).map((x:any)=>({...x,odds_ok:false}))];
        }
        let calib:any={};
        try{
          const cr=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_parlay_calibration`,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},hdr),body:'{}',signal:AbortSignal.timeout(4000)});
          if(cr.ok)calib=await cr.json()||{};
        }catch{}
        const saved=new Map<string,any>();
        try{
          const sr=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/parlay_log?mode=eq.${mode}&day=gte.${today}&or=(user_legs.not.is.null,placed.eq.true)&select=pkey,user_legs,placed&limit=500`,{headers:hdr,signal:AbortSignal.timeout(4000)});
          if(sr.ok){const rr:any=await sr.json();if(Array.isArray(rr))rr.forEach((x:any)=>saved.set(x.pkey,x))}
        }catch{}
        built=built.map((x:any)=>{const c=calib[mode+'|'+x.type],sv=saved.get(x.pkey);return {...x,cal_r:c&&typeof c.r==='number'?c.r:1,cal_n:c?.n??0,user_legs:sv?.user_legs??null,placed:!!sv?.placed}});
        const logRows=parlayLogRows(mode,built.filter((x:any)=>x.odds_ok));
        if(logRows.length)ctx.waitUntil(fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/parlay_log?on_conflict=mode,pkey`,{method:'POST',headers:Object.assign({'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},hdr),body:JSON.stringify(logRows),signal:AbortSignal.timeout(8000)}).catch(()=>null));
        return Response.json({mode,odds_only:oddsOnly,snapshot_date:today,generated_at:rows?.[0]?.generated_at||null,parlays:built},{headers:{'Cache-Control':'public, max-age=180'}});
      }catch(e:any){
        return Response.json({error:String(e?.message||e),status:500},{status:500});
      }
    }

    if(url.pathname==='/api/suggest'&&request.method==='GET'){
      try{
        const minutes=Number(url.searchParams.get('minutes'));
        if(![30,90,180,240,270,360,600,1440,2880].includes(minutes))return Response.json({error:'invalid'},{status:400});
        const key=(env as any).SUPABASE_SERVICE_KEY;
        const today=new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);
        const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/suggest_snapshot?snapshot_date=eq.${today}&select=payload,match_count,generated_at&limit=1`,{headers:{'apikey':key,'Authorization':`Bearer ${key}`}});
        if(!res.ok)return Response.json({error:'snapshot fetch failed',status:500},{status:500});
        const rows:any=await res.json();
        const cacheHeaders={'Cache-Control':'public, max-age=180'};
        if(!Array.isArray(rows)||rows.length===0)return Response.json({minutes,slot_count:0,match_count:0,slots:[],note:'no snapshot'},{headers:cacheHeaders});
        const snap=rows[0];
        const all:any[]=[];
        if(Array.isArray(snap?.payload?.slots))snap.payload.slots.forEach((s:any)=>{if(Array.isArray(s?.matches))s.matches.forEach((m:any)=>all.push(m))});
        const now=Date.now();
        const lo=now-150*60*1000;
        const hi=now+minutes*60*1000;
        const groups=new Map<string,any>();
        let matchCount=0;
        for(const m of all){
          if(!m?.kickoff)continue;
          const t=Date.parse(m.kickoff);
          if(!Number.isFinite(t)||t<lo||t>hi)continue;
          const date=String(m.kickoff).substring(0,10);
          const hour=String(m.kickoff).substring(11,13)+':00';
          const gk=date+' '+hour;
          if(!groups.has(gk))groups.set(gk,{date,hour,matches:[]});
          const started=t<now;
          const sinceKickoff=started?Math.floor((now-t)/60000):0;
          groups.get(gk).matches.push(Object.assign({},alignFtPick(m),{started:started,minutesSinceKickoff:sinceKickoff,live:started&&sinceKickoff<=30,liveMinutes:started&&sinceKickoff<=30?sinceKickoff:0}));
          matchCount++;
        }
        const slots=[...groups.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([,s])=>{s.matches.sort((a:any,b:any)=>Date.parse(a.kickoff)-Date.parse(b.kickoff));return s});
        let liveMeta:any={candidates:0,matched:0,eid_missing:0,not_found:0,status:'off'};
        try{
          liveMeta=await enrichLive(slots.flatMap((s:any)=>s.matches),now,(env as any).DEBUG==='true');
        }catch(_e){
          liveMeta={candidates:0,matched:0,eid_missing:0,not_found:0,status:'off'};
        }
        const suggestHeaders=liveMeta.candidates>0?{'Cache-Control':'public, max-age=30'}:cacheHeaders;
        return Response.json({minutes,generated_at:snap.generated_at,slot_count:slots.length,match_count:matchCount,live_meta:liveMeta,slots},{headers:suggestHeaders});
      }catch(e:any){
        return Response.json({error:String(e?.message||e),status:500},{status:500});
      }
    }

    if(url.pathname==='/api/round-stats'&&request.method==='GET'){
      try{
        const country=(url.searchParams.get('country')||'').trim();
        const league=(url.searchParams.get('league')||'').trim();
        if([...country].length>60||[...league].length>80)return Response.json({error:'invalid params'},{status:400});
        if(!!country!==!!league)return Response.json({error:'country and league go together'},{status:400});
        const key=(env as any).SUPABASE_SERVICE_KEY;
        if(!key)return Response.json({error:'not configured'},{status:500});
        const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_round_stats`,{method:'POST',headers:{'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(country?{p_country:country,p_league:league}:{}),signal:AbortSignal.timeout(8000)});
        if(!res.ok)return Response.json({error:'round stats fetch failed',status:res.status},{status:502});
        return new Response(res.body,{status:200,headers:{'content-type':'application/json','Cache-Control':'public, max-age=300'}});
      }catch(e:any){
        return Response.json({error:String(e?.message||e)},{status:500});
      }
    }

    if(url.pathname==='/api/track-record'&&request.method==='GET'){
      try{
        const days=(url.searchParams.get('days')||'all').toLowerCase();
        if(!['7','30','all'].includes(days))return Response.json({error:'invalid days'},{status:400});
        const tierParam=(url.searchParams.get('tier')||'').toUpperCase();
        if(tierParam&&!['CAO','KHA','TB','THAP','RAT_THAP'].includes(tierParam))return Response.json({error:'invalid tier'},{status:400});
        const modelVersion=url.searchParams.get('model_version')||'';
        if(modelVersion&&!['v1_ht045','v2_ht050','v3_dynamic'].includes(modelVersion))return Response.json({error:'invalid model_version'},{status:400});
        const marketParam=url.searchParams.get('market')||'';
        if(marketParam&&!['over_ft','over_ht','btts_yes','1x2_ft_home'].includes(marketParam))return Response.json({error:'invalid market'},{status:400});
        const listParam=(k:string,max:number,allowed?:string[]):string[]|null|false=>{
          const raw=url.searchParams.get(k)||'';
          if(!raw)return null;
          let arr:any;try{arr=JSON.parse(raw)}catch{return false}
          if(!Array.isArray(arr)||arr.length<1||arr.length>max||arr.some((x:any)=>typeof x!=='string'||!x||[...x].length>80||(allowed&&!allowed.includes(x))))return false;
          return [...new Set(arr as string[])];
        };
        const competitions=listParam('competitions',40);
        if(competitions===false)return Response.json({error:'invalid competitions'},{status:400});
        const countries=listParam('countries',40);
        if(countries===false)return Response.json({error:'invalid countries'},{status:400});
        const regions=listParam('regions',7,['europe','asia','americas','africa','oceania','international','unknown']);
        if(regions===false)return Response.json({error:'invalid regions'},{status:400});
        const beforeRaw=url.searchParams.get('before_kickoff');
        let beforeKickoff:string|null=null;
        if(beforeRaw){const bt=Date.parse(beforeRaw);if(!Number.isFinite(bt))return Response.json({error:'invalid before_kickoff'},{status:400});beforeKickoff=new Date(bt).toISOString();}
        const beforeFixture=url.searchParams.get('before_fixture')||'';
        if(beforeFixture&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeFixture))return Response.json({error:'invalid before_fixture'},{status:400});
        const limitRaw=url.searchParams.get('limit');
        const pageLimit=limitRaw==null?100:Number(limitRaw);
        if(!Number.isInteger(pageLimit)||pageLimit<1||pageLimit>200)return Response.json({error:'invalid limit'},{status:400});
        const key=(env as any).SUPABASE_SERVICE_KEY;
        if(!key)return Response.json({error:'not configured'},{status:500});
        const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_suggest_track_record`,{method:'POST',headers:{'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_days:days==='all'?null:Number(days),p_tier:tierParam||null,p_before_kickoff:beforeKickoff,p_limit:pageLimit,p_before_fixture:beforeFixture||null,...(modelVersion?{p_model_version:modelVersion}:{}),...(marketParam?{p_market:marketParam}:{}),...(competitions?{p_competitions:competitions}:{}),...(countries?{p_countries:countries}:{}),...(regions?{p_regions:regions}:{})}),signal:AbortSignal.timeout(8000)});
        if(!res.ok)return Response.json({error:'track record fetch failed',status:res.status},{status:502});
        return new Response(res.body,{status:200,headers:{'content-type':'application/json','Cache-Control':'public, max-age=300'}});
      }catch(e:any){
        return Response.json({error:String(e?.message||e)},{status:500});
      }
    }

    if(url.pathname==='/api/parlay-edit'&&request.method==='POST'){
      let input:any=null;try{input=await request.clone().json()}catch{}
      if(!input||typeof input!=='object')return Response.json({error:'invalid body'},{status:400});
      const mode=['suggest','round','special','xspecial','xdaily','single'].includes(input.mode)?input.mode:null;
      const pk=typeof input.pkey==='string'&&input.pkey.length>0&&input.pkey.length<2000?input.pkey:null;
      if(!mode||!pk)return Response.json({error:'invalid key'},{status:400});
      const legsIn=input.legs===undefined?null:Array.isArray(input.legs)?input.legs:undefined;
      if(legsIn===undefined||(legsIn&&legsIn.length>10))return Response.json({error:'invalid legs'},{status:400});
      if(input.placed!==undefined&&typeof input.placed!=='boolean')return Response.json({error:'invalid placed'},{status:400});
      if(!legsIn&&input.placed===undefined)return Response.json({error:'nothing to update'},{status:400});
      const quarter=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<10&&Math.abs(v*4-Math.round(v*4))<1e-9;
      const legsOut:any[]=[];
      for(const e of (legsIn||[])){
        if(!e||!Number.isInteger(e.i)||e.i<0||e.i>9)return Response.json({error:'invalid leg'},{status:400});
        const o:any={i:e.i};
        if(e.line!=null){if(!quarter(e.line))return Response.json({error:'invalid line'},{status:400});o.line=e.line}
        if(e.odds!=null){if(!(typeof e.odds==='number'&&Number.isFinite(e.odds)&&e.odds>1&&e.odds<50))return Response.json({error:'invalid odds'},{status:400});o.odds=Math.round(e.odds*1000)/1000}
        if(o.line!==undefined||o.odds!==undefined)legsOut.push(o);
      }
      let up:number|null=null;
      if(input.p!=null){if(!(typeof input.p==='number'&&input.p>=0&&input.p<=1))return Response.json({error:'invalid p'},{status:400});up=Math.round(input.p*10000)/10000}
      const key=(env as any).SUPABASE_SERVICE_KEY;
      if(!key)return Response.json({error:'not configured'},{status:500});
      try{
        const r=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/parlay_log?mode=eq.${mode}&pkey=eq.${encodeURIComponent(pk)}&settled_at=is.null`,{method:'PATCH',headers:{'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(Object.assign({edited_at:new Date().toISOString()},legsIn?{user_legs:legsOut.length?legsOut:null,user_p:legsOut.length?up:null}:{},input.placed!==undefined?{placed:input.placed}:{})),signal:AbortSignal.timeout(8000)});
        if(!r.ok)return Response.json({error:'update failed',status:r.status},{status:502});
        const rows:any=await r.json();
        if(!Array.isArray(rows)||!rows.length)return Response.json({error:'parlay not found or already settled'},{status:404});
        return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
      }catch(e:any){return Response.json({error:String(e?.message||e)},{status:502})}
    }

    if(url.pathname==='/api/parlay-stats'&&request.method==='GET'){
      const key=(env as any).SUPABASE_SERVICE_KEY;
      if(!key)return Response.json({error:'not configured'},{status:500});
      const days=Math.min(365,Math.max(1,Number.parseInt(url.searchParams.get('days')||'30',10)||30));
      const hdr={'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json'};
      try{
        await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_parlay_settle`,{method:'POST',headers:hdr,body:'{}',signal:AbortSignal.timeout(15000)});
        const gq=url.searchParams.get('group');
        const group=gq==='x'?'x':gq==='s'?'s':'std';
        const rpc=async(name:string,withGroup:any,without:any,ms:number)=>{
          let r=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:hdr,body:JSON.stringify(withGroup),signal:AbortSignal.timeout(ms)});
          if(!r.ok)r=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:hdr,body:JSON.stringify(without),signal:AbortSignal.timeout(ms)});
          return r;
        };
        const r=await rpc('cfi_parlay_stats',{p_days:days,p_group:group},{p_days:days},15000);
        if(!r.ok)return Response.json({error:'stats failed',status:r.status},{status:502});
        const out:any=await r.json();
        try{
          const rr=await rpc('cfi_parlay_recent',{p_days:days,p_limit:40,p_group:group},{p_days:days,p_limit:40},8000);
          if(rr.ok){const rec:any=await rr.json();if(Array.isArray(rec))out.recent=rec}
        }catch{}
        try{
          const pr=await rpc('cfi_parlay_placed',{p_limit:50,p_group:group},{p_limit:50},8000);
          if(pr.ok){const pl:any=await pr.json();if(Array.isArray(pl))out.placed_list=pl}
        }catch{}
        return Response.json(out,{headers:{'Cache-Control':'no-store'}});
      }catch(e:any){return Response.json({error:String(e?.message||e)},{status:502})}
    }

    if(url.pathname==='/api/observe-ou'&&(request.method==='POST'||request.method==='DELETE')){
      let input:any=null;try{input=await request.clone().json()}catch{}
      if(request.method==='DELETE'&&(!input||typeof input!=='object'))input={fixture_id:url.searchParams.get('fixture_id'),period:url.searchParams.get('period')};
      if(!input||typeof input!=='object')return Response.json({error:'invalid body'},{status:400});
      const fid=String(input.fixture_id||'');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fid))return Response.json({error:'invalid fixture_id'},{status:400});
      const period=String(input.period||'').toUpperCase();
      if(period!=='HT'&&period!=='FT')return Response.json({error:'invalid period'},{status:400});
      const key=(env as any).SUPABASE_SERVICE_KEY;
      if(!key)return Response.json({error:'not configured'},{status:500});
      const hdr={'apikey':key,'Authorization':`Bearer ${key}`};
      try{
        if(request.method==='DELETE'||input.delete===true){
          const del=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/user_ou_observations?fixture_id=eq.${fid}&period=eq.${period}`,{method:'DELETE',headers:{...hdr,'Prefer':'return=minimal'},signal:AbortSignal.timeout(8000)});
          if(!del.ok)return Response.json({error:'delete failed',status:del.status},{status:502});
          return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
        }
        const quarter=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<10&&Math.abs(v*4-Math.round(v*4))<1e-9;
        const line=input.line;
        if(!quarter(line))return Response.json({error:'invalid line'},{status:400});
        const odds=(v:any)=>v==null?null:(typeof v==='number'&&Number.isFinite(v)&&v>1&&v<20?Math.round(v*1000)/1000:undefined);
        const oddsOver=odds(input.odds_over),oddsUnder=odds(input.odds_under);
        if(oddsOver===undefined||oddsUnder===undefined)return Response.json({error:'invalid odds'},{status:400});
        let modelLine:number|null=null;
        if(input.model_chosen_line!=null){if(!quarter(input.model_chosen_line))return Response.json({error:'invalid model_chosen_line'},{status:400});modelLine=input.model_chosen_line}
        const text=(v:any,max:number):string|null|undefined=>{
          if(v==null)return null;
          if(typeof v!=='string')return undefined;
          const t=v.replace(/[\p{C}\p{Z}]+/gu,' ').trim();
          if([...t].length>max)return undefined;
          return t||null;
        };
        const bookmaker=text(input.bookmaker,30),note=text(input.note,200);
        if(bookmaker===undefined)return Response.json({error:'invalid bookmaker'},{status:400});
        if(note===undefined)return Response.json({error:'invalid note'},{status:400});
        if(oddsOver==null&&oddsUnder==null&&bookmaker==null&&note==null)return Response.json({error:'nothing to save'},{status:400});
        const seen=OU_FIXTURE_SEEN.get(fid);
        if(!seen||seen<Date.now()){
          const chk=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/cfi_living_verified_fixtures?fixture_id=eq.${fid}&select=fixture_id&limit=1`,{headers:hdr,signal:AbortSignal.timeout(5000)});
          if(chk.ok){
            const rows:any=await chk.json();
            if(!Array.isArray(rows)||!rows.length)return Response.json({error:'invalid fixture_id'},{status:400});
            if(OU_FIXTURE_SEEN.size>500)OU_FIXTURE_SEEN.clear();
            OU_FIXTURE_SEEN.set(fid,Date.now()+600000);
          }
        }
        const res=await fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/user_ou_observations?on_conflict=fixture_id,period`,{method:'POST',headers:{...hdr,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({fixture_id:fid,period,line,odds_over:oddsOver,odds_under:oddsUnder,model_chosen_line:modelLine,bookmaker,note,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(8000)});
        if(!res.ok)return Response.json({error:'save failed',status:res.status},{status:502});
        return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
      }catch(e:any){
        return Response.json({error:String(e?.message||e)},{status:500});
      }
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
            const tc:any={status:'SUCCESS',engine:FINAL_VERSION,tierC:true,tierCModel:pr.model,extraMarkets:pem,lambdaFT:{home:Number(pr.xg_home),away:Number(pr.xg_away)},target:tcBody.target,tierCReason:tcBody.reason,tierCEvidenceCount:tcBody.evidenceCount,strictPrior:{required:false,verified:false,tierCFallback:true},evidence:{counts:{home:tcBody.evidenceCount?.home??0,away:tcBody.evidenceCount?.away??0,h2h:0}},outputV3:{version:'CFI_TIER_C_V1',final:'WATCH',primary:{market:'1X2_FT',pick:pick,probability:mp,confidence:'LOW',fairOdds:Number((1/mp).toFixed(2)),decisionUse:false,researchState:'TIER_C_ELO_FALLBACK'},gates:{strictPrior:false,evidenceSufficient:false,consistency:true,tierCFallback:true},quality:{dataQuality:'LOW',modelAgreement:'LOW',predictionGrade:'C'},probabilities:{home:pr.p_home,draw:pr.p_draw,away:pr.p_away},markets6:pr.markets6||[],topScorelines:pr.topScorelines||[],expectedGoals:{home:pr.xg_home,away:pr.xg_away,total:Number((Number(pr.xg_home)+Number(pr.xg_away)).toFixed(2))},elo:{home:pr.elo_home,away:pr.elo_away},lowSample:pr.low_sample===true,marketSummary:{oneXTwo:{ft:{modelPick:pick,modelProbability:mp}}},primaryTargets:{contract:'CFI_TIER_C',count:6,codes:['HOME','DRAW','AWAY','OVER 2.5','UNDER 2.5','BTTS YES']},visibility:{tierC:true,reason:'ELO_ONLY_FALLBACK'}}};
            if(env.SUPABASE_SERVICE_KEY)ctx.waitUntil(fetch(`${TIER_C_LOG_SUPABASE_URL}/rest/v1/tier_c_log`,{method:'POST',headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({match_id:`${tcBody.identity?.homeTeamId}_${tcBody.identity?.awayTeamId}_${tcBody.target?.date}`,home_team:tcBody.target?.home,away_team:tcBody.target?.away,p_home:pr.p_home,p_draw:pr.p_draw,p_away:pr.p_away,p_over25:pr.p_over25,p_btts:pr.p_btts,p_o05_ht:pm['O0.5 HT'],p_o15_ht:pm['O1.5 HT'],p_btts_h1:pm['BTTS H1'],p_o35_ft:pm['O3.5 FT'],p_o45_ft:pm['O4.5 FT'],p_o55_ft:pm['O5.5 FT'],p_2_3_ft:pm['2-3 FT'],p_4_6_ft:pm['4-6 FT'],xg_home:pr.xg_home,xg_away:pr.xg_away,elo_home:pr.elo_home,elo_away:pr.elo_away,model:'elo_prior_v3.1',source:isDryRun(request)?'SUGGEST_ENGINE':null})}).catch(()=>{}));
            const tslC=await fetchTeamStatsLambda(env,String(input?.home??'').trim(),String(input?.away??'').trim());
            if(tslC){tc.lambdaFTEngine=tc.lambdaFT;tc.lambdaFT=tslC.lambdaFT;tc.lambdaSource=tslC.source}else tc.lambdaSource='engine';
            patchRuntimeTelemetry(tc);
            return Response.json(tc,{status:200});
          }
        }catch(_e){}
      }
      if(response.ok&&body&&typeof body==='object'){
        body.extraMarkets=tierAExtraMarkets(body);
        body.lambdaFT=tierALambda(body);
        const tslA=await fetchTeamStatsLambda(env,String(input?.home??'').trim(),String(input?.away??'').trim());
        if(tslA){body.lambdaFTEngine=body.lambdaFT;body.lambdaFT=tslA.lambdaFT;body.lambdaSource=tslA.source}else body.lambdaSource='engine';
        try{
          const homeName=String(input?.home??body?.match?.home??'').trim();
          const awayName=String(input?.away??body?.match?.away??'').trim();
          const warns=await fetchTeamWarnings(env,homeName,awayName);
          if(warns.length)body.tendencyWarnings=warns;
        }catch(_e){}
      }
      if(!response.ok||!shouldCompactPredict(request,input))return Response.json(body,{status:response.status});
      const compact=compactPrediction(body);
      if(body.tendencyWarnings)compact.tendencyWarnings=body.tendencyWarnings;
      if(body.lambdaFT)compact.lambdaFT=body.lambdaFT;
      if(body.lambdaSource)compact.lambdaSource=body.lambdaSource;
      return Response.json(compact,{status:response.status});
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

