import base from './index-v49.ts';
import { isDryRun, DRY_RUN_AUDIT } from './dry-run.ts';
import { buildPrediction, FINAL_VERSION, MARKET_CODES, PRIMARY_TARGETS, PRIMARY_CONTRACT } from '../../src/prediction/final-engine.ts';
import { CHAMPION_FUSION_VERSION } from '../../src/prediction/multi-market-champion-fusion.ts';
import { buildProspectiveV22AuditPrediction } from './prospective-v22-research-telemetry.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.2.2';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2_NATIVE_DIVERSITY_FIX';
const ENGINE_VERSION=FINAL_VERSION;
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

export function fixtureIdentityAudit(big:any){
  const identity=big?.identity??{};
  const homeFound=identity?.homeFound===true;
  const awayFound=identity?.awayFound===true;
  const homeCanonical=String(identity?.homeCanonical??'').trim();
  const awayCanonical=String(identity?.awayCanonical??'').trim();
  const homeTeamId=String(identity?.homeTeamId??'').trim();
  const awayTeamId=String(identity?.awayTeamId??'').trim();
  const selfMatch=Boolean(
    (homeTeamId&&awayTeamId&&homeTeamId===awayTeamId)||
    (homeCanonical&&awayCanonical&&homeCanonical===awayCanonical)
  );
  const verified=homeFound&&awayFound&&Boolean(homeCanonical)&&Boolean(awayCanonical)&&Boolean(homeTeamId)&&Boolean(awayTeamId)&&!selfMatch;
  return {
    verified,
    reason:verified?null:selfMatch?'CANONICAL_SELF_MATCH_REJECTED':'CANONICAL_IDENTITY_UNRESOLVED',
    source:'SHARED_IDENTITY_BRIDGE',
    homeFound,
    awayFound,
    homeTeamId:homeTeamId||null,
    awayTeamId:awayTeamId||null,
    homeCanonical:homeCanonical||null,
    awayCanonical:awayCanonical||null,
    homeResolution:identity?.homeResolution??null,
    awayResolution:identity?.awayResolution??null,
  };
}

export const MIN_EXACT_TEAM_EVIDENCE=3;

export function exactTeamEvidenceAudit(big:any){
  const home=Number(big?.exactTeam?.home?.retrieved);
  const away=Number(big?.exactTeam?.away?.retrieved);
  const h2h=Number(big?.exactTeam?.h2h?.retrieved);
  const homeValid=Number.isFinite(home)&&home>=MIN_EXACT_TEAM_EVIDENCE;
  const awayValid=Number.isFinite(away)&&away>=MIN_EXACT_TEAM_EVIDENCE;
  return {verified:homeValid&&awayValid,home:Number.isFinite(home)?home:null,away:Number.isFinite(away)?away:null,h2h:Number.isFinite(h2h)?h2h:null,requiredPerTeam:MIN_EXACT_TEAM_EVIDENCE};
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
// They MUST NOT overwrite/shrink match-specific Method A, Method B, FINAL or primary exact-score outputs.
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

const top1From=(x:any)=>Array.isArray(x)?x[0]??null:x??null;
function sixTargetMatrix(prediction:any){
  const threshold=Object.fromEntries(MARKET_CODES.map((market)=>{
    const r=prediction?.markets?.[market]??{};
    return[market,{methodA:r.methodA??null,methodB:r.methodB??null,final:r.final??null,confidence:r.predictiveConfidence??r.confidence??null,hits:r.hits??null,eligible:r.eligible??null}];
  }));
  const exactScore={
    'Top-1 HT':{methodA:top1From(prediction?.scoreline?.ht?.methodA),methodB:top1From(prediction?.scoreline?.ht?.methodB),final:top1From(prediction?.scoreline?.ht?.final)},
    'Top-1 FT':{methodA:top1From(prediction?.scoreline?.ft?.methodA),methodB:top1From(prediction?.scoreline?.ft?.methodB),final:top1From(prediction?.scoreline?.ft?.final)}
  };
  const validExact=(x:any)=>x&&typeof x?.score==='string'&&Number.isFinite(Number(x?.probability));
  const thresholdComplete=MARKET_CODES.every(m=>['methodA','methodB','final'].every(k=>Number.isFinite(Number((threshold as any)[m]?.[k]))));
  const scorelineComplete=['Top-1 HT','Top-1 FT'].every(t=>['methodA','methodB','final'].every(k=>validExact((exactScore as any)[t]?.[k])));
  return{contract:PRIMARY_CONTRACT,primary:true,targetCount:6,primaryTargets:[...PRIMARY_TARGETS],methods:['Method A','Method B','FINAL'],threshold,scoreline:exactScore,exactScore,verification:{thresholdComplete,scorelineComplete,complete:thresholdComplete&&scorelineComplete}};
}

function renderedReport(prediction:any,matrix:any){
  const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
  const exact=(row:any)=>row&&typeof row==='object'&&row.score?`${row.score} ${pct(row.probability)}`:'—';
  const t=matrix.threshold,s=matrix.exactScore,f=prediction?.championFusion,fw=f?.gating?.ft?.weights??{},fmm=f?.multiMarket;
  return [
    `CFI 4 THRESHOLDS + TOP-1 HT + TOP-1 FT — ${matrix.contract}`,
    `MATCH: ${prediction?.target?.home??'—'} vs ${prediction?.target?.away??'—'} | ${prediction?.target?.date??'—'} | ENGINE ${prediction?.engine??ENGINE_VERSION}`,
    '',
    'THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',
    ...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),
    '',
    'TOP-1 HT — PRIMARY TARGET',
    `Method A: ${exact(s['Top-1 HT']?.methodA)}`,
    `Method B: ${exact(s['Top-1 HT']?.methodB)}`,
    `FINAL: ${exact(s['Top-1 HT']?.final)}`,
    '',
    'TOP-1 FT — PRIMARY TARGET',
    `Method A: ${exact(s['Top-1 FT']?.methodA)}`,
    `Method B: ${exact(s['Top-1 FT']?.methodB)}`,
    `FINAL: ${exact(s['Top-1 FT']?.final)}`,
    '',
    `VERDICT: ${prediction?.verdict??'—'} | UNCERTAINTY: ${prediction?.scoreline?.uncertainty??'—'}`,
    `CONTRACT COMPLETE: ${matrix.verification.complete?'YES':'NO'}`,
    '',
    `CHAMPION FUSION V1: ${f?.status??'UNAVAILABLE'} | decisionUse=${f?.decisionUse===true?'true':'false'} | coherence=${f?.coherence?.status??'—'} | uncertainty=${f?.uncertainty?.level??'—'} | abstain=${f?.uncertainty?.abstain===true?'YES':'NO'}`,
    `Fusion Champion: 3+ HT ${pct(f?.champion?.thresholds?.['3+ HT'])} | 7+ FT ${pct(f?.champion?.thresholds?.['7+ FT'])} | Other HT ${pct(f?.champion?.thresholds?.['Other HT'])} | Other FT ${pct(f?.champion?.thresholds?.['Other FT'])}`,
    `Fusion Top-1 HT: ${exact(f?.champion?.top1HT??f?.champion?.['Top-1 HT'])}`,
    `Fusion Top-1 FT: ${exact(f?.champion?.top1FT??f?.champion?.['Top-1 FT'])}`,
    `Fusion FT 1X2: H ${pct(fmm?.oneXTwo?.ft?.home)} | X ${pct(fmm?.oneXTwo?.ft?.draw)} | A ${pct(fmm?.oneXTwo?.ft?.away)} | FT O2.5 ${pct(fmm?.overUnder?.ft?.['2.5']?.over?.fullWin)} | FT O6.5 ${pct(fmm?.overUnder?.ft?.['6.5']?.over?.fullWin)}`,
    `Fusion FT weights: INC ${pct(fw.INCUMBENT_FINAL)} | HIST ${pct(fw.HISTORICAL)} | RECENT ${pct(fw.RECENT_FORM)} | FUTURE_SIX ${pct(fw.FUTURE_SIX)} | DIR ${pct(fw.DIRECTIONAL_RECONCILIATION)}`,
    `Fusion policy: SHADOW_RESEARCH only; prospective paired settlement required before promotion.`
  ].join('\n');
}

async function recordAudit(env:Env,input:any,prediction:any){
  if(input?.cfiDryRun===true)return DRY_RUN_AUDIT;
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
  if(isDryRun(request))input={...input,cfiDryRun:true};
  const home=String(input?.home||'').trim(),away=String(input?.away||'').trim(),targetDate=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!targetDate||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:'TARGET_DATE_REQUIRED',strictPrior:{required:true,verified:false,failClosed:true}},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate});

    // CANONICAL-FIRST HARD GATE:
    // ZERO_EXACT_TEAM_EVIDENCE is forbidden until the shared identity bridge
    // has resolved both sides to distinct canonical entities.
    const identity=fixtureIdentityAudit(big);
    if(!identity.verified){
      return Response.json({
        status:'INSUFFICIENT_DATA',
        error:identity.reason,
        predictionStatus:'PREDICTION_NOT_EXECUTED',
        target:{home,away,date:targetDate},
        fixtureIdentityVerified:false,
        fixtureIdentity:identity,
        strictPrior:{required:true,verified:false,targetDate,failClosed:true},
        audit:{status:'SKIPPED',reason:'PREDICTION_NOT_ELIGIBLE'}
      },{status:422});
    }

    const exact=exactTeamEvidenceAudit(big);
    if(!exact.verified){
      return Response.json({
        status:'INSUFFICIENT_DATA',
        error:'ZERO_EXACT_TEAM_EVIDENCE',
        predictionStatus:'PREDICTION_NOT_EXECUTED',
        target:{home,away,date:targetDate},
        exactTeam:exact,
        fixtureIdentityVerified:true,
        fixtureIdentity:identity,
        canonicalFixture:{home:identity.homeCanonical,away:identity.awayCanonical},
        strictPrior:{required:true,verified:false,targetDate,failClosed:true},
        audit:{status:'SKIPPED',reason:'PREDICTION_NOT_ELIGIBLE'}
      },{status:422});
    }
    const temporal=temporalEvidenceAudit(big,targetDate);
    if(!temporal.verified){
      return Response.json({status:'STRICT_PRIOR_GATE_ERROR',error:temporal.error,fixtureIdentityVerified:true,fixtureIdentity:identity,strictPrior:{required:true,verified:false,targetDate,failClosed:true},temporalEvidenceAudit:temporal,audit:{status:'SKIPPED',reason:'STRICT_PRIOR_NOT_VERIFIED'}},{status:500});
    }

    const predictionHome=identity.homeCanonical!,predictionAway=identity.awayCanonical!;
    const homePayload={fixtures:big?.fixtures?.home??[]},awayPayload={fixtures:big?.fixtures?.away??[]},h2hPayload={fixtures:big?.fixtures?.h2h??[]};
    const prediction:any=buildPrediction({home:predictionHome,away:predictionAway,targetDate,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload,bigDbContext:big});
    prediction.target={home,away,date:targetDate,canonicalHome:predictionHome,canonicalAway:predictionAway};
    prediction.fixtureIdentityVerified=true;
    prediction.fixtureIdentity=identity;
    const evidenceCounts=prediction?.evidence?.counts??prediction?.evidence??{};
    if(prediction?.status!=='DATA_READY'||Number(evidenceCounts?.htCoverage??0)<=0||Number(evidenceCounts?.ftCoverage??0)<=0){
      return Response.json({status:'INSUFFICIENT_DATA',error:'SCORE_EVIDENCE_REQUIRED',target:prediction?.target??{home,away,date:targetDate},evidence:prediction?.evidence??null,fixtureIdentityVerified:true,fixtureIdentity:identity,strictPrior:{required:true,verified:true,targetDate,failClosed:true},temporalEvidenceAudit:temporal,audit:{status:'SKIPPED',reason:'PREDICTION_NOT_ELIGIBLE'}},{status:422});
    }

    prediction.baseEngine=FINAL_VERSION;
    prediction.engine=ENGINE_VERSION;
    prediction.temporalEvidenceAudit=temporal;
    prediction.strictPriorAudit={required:true,verified:true,targetDate,telemetryVersion:'CFI_TEMPORAL_AUDIT_V1.1',evidence:temporal};
    const globalPrior=attachGlobalPriorTelemetry(prediction,big);
    const retrieval={version:BIG_DB_RETRIEVAL_VERSION,required:true,source:'PERSISTENT_DB',targetDate,currentSessionProvenance:big?.currentSessionProvenance??'NOT_OBSERVABLE',identity:{...(big?.identity??{}),verified:true,source:'SHARED_IDENTITY_BRIDGE',reason:null},exactTeam:big?.exactTeam??null,bigDbOnlyAdded:Number(big?.bigDbOnlyAdded??0),globalPrior,predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length,globalPriorApplied:true},temporalAudit:temporal,note:'Canonical identity is verified before exact-team evidence gating. Global priors are context telemetry only; match-specific outputs are never directly shrunk.'};
    const matrix=sixTargetMatrix(prediction);
    if(!matrix.verification.complete)return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,status:'RUNTIME_CONTRACT_ERROR',error:'INCOMPLETE_2_METHODS_X_6_TARGETS',audit:{status:'SKIPPED',reason:'RUNTIME_CONTRACT_ERROR'}},{status:500});

    const report=renderedReport(prediction,matrix);
    const auditBase={...prediction,bigDbRetrieval:retrieval,primaryTargetMatrix:{contract:matrix.contract,targetCount:6,threshold:matrix.threshold,exactScore:matrix.exactScore,verification:matrix.verification},sixTargetMatrix:matrix,presentationContract:{contract:matrix.contract,targetCount:6,scorelineOutput:'TOP1_HT_PLUS_TOP1_FT',complete:matrix.verification.complete}};
    const auditPrediction=await buildProspectiveV22AuditPrediction(auditBase);
    const audit=await recordAudit(env,input,auditPrediction);
    return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,primaryTargetMatrix:{contract:matrix.contract,targetCount:6,threshold:matrix.threshold,exactScore:matrix.exactScore,verification:matrix.verification},renderedReport:report,presentationContract:{mode:'RENDER_RENDERED_REPORT_VERBATIM',source:'renderedReport',contract:matrix.contract,targetCount:6,scorelineOutput:'TOP1_HT_PLUS_TOP1_FT',complete:matrix.verification.complete},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,baseEngine:FINAL_VERSION,predictionPath:'NATIVE_V5_3_STRICT_PRIOR_BIGDB_DIVERSITY_FIX_PLUS_CHAMPION_FUSION_V1_V2_SHADOW_TOP1',primaryTargets:6,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION,championFusion:CHAMPION_FUSION_VERSION,multiMarketFusionV3:prediction?.multiMarketFusionV3?.version??null},diversityGuard:{active:true,native:true,thresholdGlobalPriorDirectShrinkage:false,scorelineGlobalPriorDirectShrinkage:false},audit});
  }catch(e:any){
    return Response.json({status:'ERROR',error:'BIG_DB_V2_PREDICTION_FAILURE',message:String(e?.message||e),runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
  }
}} satisfies ExportedHandler<Env>;