import base from './index-v49.ts';
import { buildPrediction, FINAL_VERSION, MARKET_CODES, PRIMARY_TARGETS } from '../../src/prediction/final-engine.ts';
import { buildChampionFusionV1, CHAMPION_FUSION_VERSION } from '../../src/prediction/multi-market-champion-fusion-v1.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.2.1';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2_NATIVE_DIVERSITY_FIX';
const ENGINE_VERSION='CFI_FINAL_V5.2.3_NATIVE_DIVERSITY_FIX';
type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function readJson(res:Response){try{return await res.clone().json()}catch{return null}}
async function fetchBigDb(env:Env,input:any){
  if(!env.CFI_DB_BASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});
  const body=await readJson(res);
  if(!res.ok||body?.status!=='OK')throw new Error(`BIG_DB_V2_FAILED:${body?.error??res.status}`);
  return body;
}

function exactTeamEvidenceAudit(big:any){
  const home=Number(big?.exactTeam?.home?.retrieved);
  const away=Number(big?.exactTeam?.away?.retrieved);
  const h2h=Number(big?.exactTeam?.h2h?.retrieved);
  const homeValid=Number.isFinite(home)&&home>0;
  const awayValid=Number.isFinite(away)&&away>0;
  return {verified:homeValid&&awayValid,home:Number.isFinite(home)?home:null,away:Number.isFinite(away)?away:null,h2h:Number.isFinite(h2h)?h2h:null};
}

function temporalEvidenceAudit(big:any,targetDate:string){
  const src=big?.temporalAudit;
  if(!src||typeof src!=='object')return {verified:false,error:'TEMPORAL_AUDIT_REQUIRED',targetDate};
  const observedTarget=String(src?.targetDate??big?.targetDate??'').slice(0,10);
  const maxEvidenceDate=src?.maxEvidenceDate?String(src.maxEvidenceDate).slice(0,10):null;
  const futureEvidenceCount=Number(src?.futureEvidenceCount);
  const sameDateEvidenceCount=Number(src?.sameDateEvidenceCount);
  if(observedTarget!==targetDate)return {verified:false,error:'TEMPORAL_TARGET_DATE_MISMATCH',targetDate,observedTarget:observedTarget||null,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount};
  if(!Number.isFinite(futureEvidenceCount)||!Number.isFinite(sameDateEvidenceCount))return {verified:false,error:'TEMPORAL_COUNTS_REQUIRED',targetDate,maxEvidenceDate,futureEvidenceCount:null,sameDateEvidenceCount:null};
  if(futureEvidenceCount!==0||sameDateEvidenceCount!==0)return {verified:false,error:'TEMPORAL_FUTURE_OR_SAME_DATE_EVIDENCE',targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount};
  if(src?.verified!==true||!maxEvidenceDate||maxEvidenceDate>=targetDate)return {verified:false,error:'TEMPORAL_AUDIT_NOT_VERIFIED',targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount,observable:Boolean(src?.observable)};
  return {verified:true,error:null,targetDate,maxEvidenceDate,futureEvidenceCount,sameDateEvidenceCount,observable:Boolean(src?.observable),exactTeamMaxEvidenceDate:src?.exactTeamMaxEvidenceDate??null,globalPriorMaxEvidenceDate:src?.globalPriorMaxEvidenceDate??null,rule:'fixtureDate < targetDate'};
}

// CRITICAL DIVERSITY FIX: global DB statistics are telemetry/context only.
// They MUST NOT overwrite/shrink match-specific Method A, Method B, FINAL or Top-3.
function attachGlobalPriorTelemetry(prediction:any,big:any){
  const threshold:any={};
  for(const market of MARKET_CODES){
    const g=Number(big?.globalPrior?.markets?.[market]?.rate);
    threshold[market]={globalRate:Number.isFinite(g)?g:null,directOutputShrinkage:false};
    const row=prediction?.markets?.[market];
    if(row){
      row.calibration={...(row.calibration??{}),bigDbPrior:{version:BIG_DB_RETRIEVAL_VERSION,globalRate:Number.isFinite(g)?g:null,globalFixtureCount:Number(big?.globalPrior?.fixtureCount??0),role:'CONTEXT_ONLY'}};
    }
  }
  return {fixtureCount:Number(big?.globalPrior?.fixtureCount??0),applied:true,directOutputShrinkage:false,threshold,scoreline:{mode:'NO_DIRECT_GLOBAL_SCORELINE_SHRINKAGE',directOutputShrinkage:false}};
}

function sixTargetMatrix(prediction:any){
  const threshold=Object.fromEntries(MARKET_CODES.map((market)=>{
    const r=prediction?.markets?.[market]??{};
    return[market,{methodA:r.methodA??null,methodB:r.methodB??null,final:r.final??null,confidence:r.confidence??null,hits:r.hits??null,eligible:r.eligible??null}];
  }));
  const scoreline={
    'Top-3 HT':{methodA:prediction?.scoreline?.ht?.methodA??null,methodB:prediction?.scoreline?.ht?.methodB??null,final:prediction?.scoreline?.ht?.final??null},
    'Top-3 FT':{methodA:prediction?.scoreline?.ft?.methodA??null,methodB:prediction?.scoreline?.ft?.methodB??null,final:prediction?.scoreline?.ft?.final??null}
  };
  const validTop=(x:any)=>Array.isArray(x)&&x.length===3&&x.every((r:any)=>typeof r?.score==='string'&&Number.isFinite(Number(r?.probability)));
  const thresholdComplete=MARKET_CODES.every(m=>['methodA','methodB','final'].every(k=>Number.isFinite(Number((threshold as any)[m]?.[k]))));
  const scorelineComplete=['Top-3 HT','Top-3 FT'].every(t=>['methodA','methodB','final'].every(k=>validTop((scoreline as any)[t]?.[k])));
  return{contract:'CFI_2_METHODS_X_6_TARGETS_V1',primaryTargets:[...PRIMARY_TARGETS],methods:['Method A','Method B','FINAL'],threshold,scoreline,verification:{thresholdComplete,scorelineComplete,complete:thresholdComplete&&scorelineComplete}};
}

function renderedReport(prediction:any,matrix:any){
  const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
  const list=(rows:any)=>Array.isArray(rows)?rows.map((r:any,i:number)=>`${i+1}) ${r.score} ${pct(r.probability)}`).join(' · '):'—';
  const t=matrix.threshold,s=matrix.scoreline,f=prediction?.championFusion,fw=f?.gating?.ft?.weights??{},fmm=f?.multiMarket;
  return [
    `CFI 2 METHODS × 6 TARGETS — ${matrix.contract}`,
    `MATCH: ${prediction?.target?.home??'—'} vs ${prediction?.target?.away??'—'} | ${prediction?.target?.date??'—'} | ENGINE ${prediction?.engine??ENGINE_VERSION}`,
    '',
    'THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',
    ...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),
    '',
    'TOP-3 HT — PRIMARY TARGET',
    `Method A: ${list(s['Top-3 HT']?.methodA)}`,
    `Method B: ${list(s['Top-3 HT']?.methodB)}`,
    `FINAL: ${list(s['Top-3 HT']?.final)}`,
    '',
    'TOP-3 FT — PRIMARY TARGET',
    `Method A: ${list(s['Top-3 FT']?.methodA)}`,
    `Method B: ${list(s['Top-3 FT']?.methodB)}`,
    `FINAL: ${list(s['Top-3 FT']?.final)}`,
    '',
    `VERDICT: ${prediction?.verdict??'—'} | UNCERTAINTY: ${prediction?.scoreline?.uncertainty??'—'}`,
    `CONTRACT COMPLETE: ${matrix.verification.complete?'YES':'NO'}`,
    '',
    `CHAMPION FUSION V1: ${f?.status??'UNAVAILABLE'} | decisionUse=${f?.decisionUse===true?'true':'false'} | coherence=${f?.coherence?.status??'—'} | uncertainty=${f?.uncertainty??'—'}`,
    `Fusion Champion: 3+ HT ${pct(f?.champion?.thresholds?.['3+ HT'])} | 7+ FT ${pct(f?.champion?.thresholds?.['7+ FT'])} | Other HT ${pct(f?.champion?.thresholds?.['Other HT'])} | Other FT ${pct(f?.champion?.thresholds?.['Other FT'])}`,
    `Fusion Top-3 HT: ${list(f?.champion?.top3HT)} `,
    `Fusion Top-3 FT: ${list(f?.champion?.top3FT)} `,
    `Fusion FT 1X2: H ${pct(fmm?.oneXTwo?.ft?.home)} | X ${pct(fmm?.oneXTwo?.ft?.draw)} | A ${pct(fmm?.oneXTwo?.ft?.away)} | FT O2.5 ${pct(fmm?.overUnder?.ft?.['2.5']?.over?.fullWin)} | FT O6.5 ${pct(fmm?.overUnder?.ft?.['6.5']?.over?.fullWin)}`,
    `Fusion FT weights: HIST ${pct(fw.HISTORICAL)} | RECENT ${pct(fw.RECENT_FORM)} | FUTURE_SIX ${pct(fw.FUTURE_SIX)} | DIR_POISSON ${pct(fw.DIRECTIONAL_POISSON)}`,
    `Fusion policy: SHADOW_RESEARCH only; prospective paired settlement required before promotion.`
  ].join('\n');
}

async function recordAudit(env:Env,input:any,prediction:any){
  const date=String(input?.target_date||input?.matchDate||prediction?.target?.date||'').slice(0,10),home=String(input?.home||prediction?.target?.home||'').trim(),away=String(input?.away||prediction?.target?.away||'').trim();
  if(!date||!env.CFI_DB_BASE_URL)return{status:'SKIPPED',reason:!date?'TARGET_DATE_REQUIRED':'DATABASE_NOT_CONFIGURED'};
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-prediction-audit');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  try{
    const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'SNAPSHOT',target_date:date,home,away,language:String(input?.language||'vi'),source:'GPT_ACTION',prediction})});
    return{status:r.ok?'RECORDED':'ERROR',httpStatus:r.status,body:await readJson(r)};
  }catch(e:any){return{status:'ERROR',message:String(e?.message||e)}}
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return base.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{}
  const home=String(input?.home||'').trim(),away=String(input?.away||'').trim(),targetDate=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!targetDate||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_REQUIRED',strictPrior:{required:true,verified:false,failClosed:true}},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate});
    const exact=exactTeamEvidenceAudit(big);
    if(!exact.verified){
      return Response.json({status:'INSUFFICIENT_DATA',error:'ZERO_EXACT_TEAM_EVIDENCE',target:{home,away,date:targetDate},exactTeam:exact,strictPrior:{required:true,verified:false,targetDate,failClosed:true},audit:{status:'SKIPPED',reason:'PREDICTION_NOT_ELIGIBLE'}},{status:422});
    }
    const temporal=temporalEvidenceAudit(big,targetDate);
    if(!temporal.verified){
      return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:temporal.error,strictPrior:{required:true,verified:false,targetDate,failClosed:true},temporalEvidenceAudit:temporal,audit:{status:'SKIPPED',reason:'STRICT_PRIOR_NOT_VERIFIED'}},{status:500});
    }

    // Exact alias resolution happens inside BigDB. Use the resolved canonical names
    // for team-specific feature extraction while preserving the submitted fixture
    // names in the public target/audit contract.
    const predictionHome=String(big?.identity?.homeCanonical||home),predictionAway=String(big?.identity?.awayCanonical||away);
    const homePayload={fixtures:big?.fixtures?.home??[]},awayPayload={fixtures:big?.fixtures?.away??[]},h2hPayload={fixtures:big?.fixtures?.h2h??[]};
    const prediction:any=buildPrediction({home:predictionHome,away:predictionAway,targetDate,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload});
    prediction.target={home,away,date:targetDate};
    const evidenceCounts=prediction?.evidence?.counts??prediction?.evidence??{};
    if(prediction?.status!=='DATA_READY'||Number(evidenceCounts?.htCoverage??0)<=0||Number(evidenceCounts?.ftCoverage??0)<=0){
      return Response.json({status:'INSUFFICIENT_DATA',error:'SCORE_EVIDENCE_REQUIRED',target:prediction?.target??{home,away,date:targetDate},evidence:prediction?.evidence??null,strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,audit:{status:'SKIPPED',reason:'PREDICTION_NOT_ELIGIBLE'}},{status:422});
    }

    prediction.baseEngine=FINAL_VERSION;
    prediction.engine=ENGINE_VERSION;
    prediction.temporalEvidenceAudit=temporal;
    prediction.strictPriorAudit={required:true,verified:true,targetDate,telemetryVersion:'CFI_TEMPORAL_AUDIT_V1.1',evidence:temporal};
    try{
      prediction.championFusion=buildChampionFusionV1({home:predictionHome,away:predictionAway,targetDate,homePayload,awayPayload,h2hPayload,incumbentMultiMarket:prediction?.multiMarket});
    }catch(e:any){
      prediction.championFusion={version:CHAMPION_FUSION_VERSION,status:'SHADOW_ERROR',decisionUse:false,researchOnly:true,productionEligible:false,error:String(e?.message||e),promotionGate:{decisionUseUntilPromoted:false}};
    }

    const globalPrior=attachGlobalPriorTelemetry(prediction,big);
    const retrieval={version:BIG_DB_RETRIEVAL_VERSION,required:true,source:'PERSISTENT_DB',targetDate,currentSessionProvenance:big?.currentSessionProvenance??'NOT_OBSERVABLE',exactTeam:big?.exactTeam??null,bigDbOnlyAdded:Number(big?.bigDbOnlyAdded??0),globalPrior,predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length,globalPriorApplied:true},temporalAudit:temporal,note:'Global priors are context telemetry only; match-specific outputs are never directly shrunk.'};
    const matrix=sixTargetMatrix(prediction);
    if(!matrix.verification.complete)return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,status:'RUNTIME_CONTRACT_ERROR',error:'INCOMPLETE_2_METHODS_X_6_TARGETS',audit:{status:'SKIPPED',reason:'RUNTIME_CONTRACT_ERROR'}},{status:500});

    const report=renderedReport(prediction,matrix);
    // Snapshot only after exact-team, strict-prior, score-evidence and six-target gates pass.
    // championFusion is attached before this call, so the shadow challenger is immutable and prospectively settleable.
    const audit=await recordAudit(env,input,{...prediction,bigDbRetrieval:retrieval});
    return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,renderedReport:report,presentationContract:{mode:'RENDER_RENDERED_REPORT_VERBATIM',source:'renderedReport',contract:matrix.contract},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,baseEngine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_DIVERSITY_FIX_PLUS_CHAMPION_FUSION_V1_SHADOW',primaryTargets:6,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,championFusion:CHAMPION_FUSION_VERSION},diversityGuard:{active:true,native:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false},audit});
  }catch(e:any){
    return Response.json({status:'ERROR',error:'BIG_DB_V2_PREDICTION_FAILURE',message:String(e?.message||e),runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
  }
}} satisfies ExportedHandler<Env>;
