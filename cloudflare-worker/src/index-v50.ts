import base from './index-v49.ts';
import { buildPrediction, FINAL_VERSION, MARKET_CODES, PRIMARY_TARGETS } from '../../src/prediction/final-engine.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.2';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V2';
const ENGINE_VERSION='CFI_FINAL_V5.2.3';
type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
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

function globalWeight(n:number){return clamp(.04+.12*(1-Math.min(1,n/60)),.04,.16)}
function applyMarketPriors(prediction:any,big:any){
  const applied:any={};
  for(const market of MARKET_CODES){
    const row=prediction?.markets?.[market];
    const g=Number(big?.globalPrior?.markets?.[market]?.rate);
    if(!row||!Number.isFinite(g))continue;
    const n=Number(row.eligible??0),w=globalWeight(n);
    for(const k of ['methodA','methodB','final']){
      const p=Number(row[k]);if(Number.isFinite(p))row[k]=clamp((1-w)*p+w*g);
    }
    row.calibration={...(row.calibration??{}),bigDbPrior:{version:BIG_DB_RETRIEVAL_VERSION,globalRate:g,globalWeight:w,globalFixtureCount:Number(big?.globalPrior?.fixtureCount??0)}};
    row.supportingFactors=[...(row.supportingFactors??[]),`big_db_global_prior:${g.toFixed(4)}`,`big_db_weight:${w.toFixed(3)}`];
    applied[market]={globalRate:g,weight:w,eligible:n};
  }
  const ranking=Object.entries(prediction?.markets??{}).filter(([k])=>(MARKET_CODES as readonly string[]).includes(k)).map(([market,v]:any)=>({target:market,probability:Number(v.final),confidence:v.predictiveConfidence??v.confidence,sampleConfidence:v.sampleConfidence})).sort((a,b)=>b.probability-a.probability);
  prediction.ranking=ranking;
  prediction.verdict=(ranking[0]?.probability??0)>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
  if(prediction.localized)prediction.localized.verdict=prediction.verdict;
  return applied;
}

function shrinkTop3(rows:any[],globalRows:any[],w:number){
  if(!Array.isArray(rows)||rows.length!==3||!Array.isArray(globalRows))return rows;
  const gm=new Map(globalRows.map((r:any)=>[String(r.score),Number(r.probability)]));
  const mass=rows.reduce((s:number,r:any)=>s+Number(r.probability||0),0);
  const out=rows.map((r:any)=>({score:r.score,probability:(1-w)*Number(r.probability||0)+w*(gm.get(String(r.score))??0)}));
  const z=out.reduce((s:number,r:any)=>s+r.probability,0)||1;
  return out.map((r:any)=>({...r,probability:r.probability/z*mass})).sort((a:any,b:any)=>b.probability-a.probability);
}
function applyScorelinePriors(prediction:any,big:any){
  const n=Number(prediction?.evidence?.uniqueCanonical??0),w=clamp(globalWeight(n)*.75,.03,.12);
  const ht=big?.globalScorelinePrior?.ht,ft=big?.globalScorelinePrior?.ft;
  for(const branch of ['methodA','methodB','final']){
    if(prediction?.scoreline?.ht?.[branch])prediction.scoreline.ht[branch]=shrinkTop3(prediction.scoreline.ht[branch],ht,w);
    if(prediction?.scoreline?.ft?.[branch])prediction.scoreline.ft[branch]=shrinkTop3(prediction.scoreline.ft[branch],ft,w);
  }
  prediction.scoreline.mostLikelyPath=`${prediction?.scoreline?.ht?.final?.[0]?.score??'—'} HT → ${prediction?.scoreline?.ft?.final?.[0]?.score??'—'} FT`;
  return {mode:'CURRENT_TOP3_PROBABILITY_SHRINKAGE',weight:w,globalFixtureCount:Number(big?.globalPrior?.fixtureCount??0)};
}

function sixTargetMatrix(prediction:any){
  const threshold=Object.fromEntries(MARKET_CODES.map((market)=>{const r=prediction?.markets?.[market]??{};return[market,{methodA:r.methodA??null,methodB:r.methodB??null,final:r.final??null,confidence:r.confidence??null,hits:r.hits??null,eligible:r.eligible??null}]}));
  const scoreline={'Top-3 HT':{methodA:prediction?.scoreline?.ht?.methodA??null,methodB:prediction?.scoreline?.ht?.methodB??null,final:prediction?.scoreline?.ht?.final??null},'Top-3 FT':{methodA:prediction?.scoreline?.ft?.methodA??null,methodB:prediction?.scoreline?.ft?.methodB??null,final:prediction?.scoreline?.ft?.final??null}};
  const validTop=(x:any)=>Array.isArray(x)&&x.length===3&&x.every((r:any)=>typeof r?.score==='string'&&Number.isFinite(Number(r?.probability)));
  const thresholdComplete=MARKET_CODES.every(m=>['methodA','methodB','final'].every(k=>Number.isFinite(Number((threshold as any)[m]?.[k]))));
  const scorelineComplete=['Top-3 HT','Top-3 FT'].every(t=>['methodA','methodB','final'].every(k=>validTop((scoreline as any)[t]?.[k])));
  return{contract:'CFI_2_METHODS_X_6_TARGETS_V1',primaryTargets:[...PRIMARY_TARGETS],methods:['Method A','Method B','FINAL'],threshold,scoreline,verification:{thresholdComplete,scorelineComplete,complete:thresholdComplete&&scorelineComplete}};
}
function renderedReport(prediction:any,matrix:any){
  const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
  const list=(rows:any)=>Array.isArray(rows)?rows.map((r:any,i:number)=>`${i+1}) ${r.score} ${pct(r.probability)}`).join(' · '):'—';
  const t=matrix.threshold,s=matrix.scoreline;
  return [`CFI 2 METHODS × 6 TARGETS — ${matrix.contract}`,`MATCH: ${prediction?.target?.home??'—'} vs ${prediction?.target?.away??'—'} | ${prediction?.target?.date??'—'} | ENGINE ${prediction?.engine??ENGINE_VERSION}`,'','THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),'','TOP-3 HT — PRIMARY TARGET',`Method A: ${list(s['Top-3 HT']?.methodA)}`,`Method B: ${list(s['Top-3 HT']?.methodB)}`,`FINAL: ${list(s['Top-3 HT']?.final)}`,'','TOP-3 FT — PRIMARY TARGET',`Method A: ${list(s['Top-3 FT']?.methodA)}`,`Method B: ${list(s['Top-3 FT']?.methodB)}`,`FINAL: ${list(s['Top-3 FT']?.final)}`,'',`VERDICT: ${prediction?.verdict??'—'} | UNCERTAINTY: ${prediction?.scoreline?.uncertainty??'—'}`,`CONTRACT COMPLETE: ${matrix.verification.complete?'YES':'NO'}`].join('\n');
}
async function recordAudit(env:Env,input:any,prediction:any){
  const date=String(input?.target_date||input?.matchDate||prediction?.target?.date||'').slice(0,10),home=String(input?.home||prediction?.target?.home||'').trim(),away=String(input?.away||prediction?.target?.away||'').trim();
  if(!date||!env.CFI_DB_BASE_URL)return{status:'SKIPPED',reason:!date?'TARGET_DATE_REQUIRED':'DATABASE_NOT_CONFIGURED'};
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-prediction-audit');const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  try{const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'SNAPSHOT',target_date:date,home,away,language:String(input?.language||'vi'),source:'GPT_ACTION',prediction})});return{status:r.ok?'RECORDED':'ERROR',httpStatus:r.status,body:await readJson(r)}}catch(e:any){return{status:'ERROR',message:String(e?.message||e)}}
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname!=='/api/predict'||request.method!=='POST')return base.fetch(request,env,ctx);
  let input:any={};try{input=await request.clone().json()}catch{}
  const home=String(input?.home||'').trim(),away=String(input?.away||'').trim(),targetDate=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  try{
    const big=await fetchBigDb(env,{home,away,target_date:targetDate});
    const homePayload={fixtures:big?.fixtures?.home??[]},awayPayload={fixtures:big?.fixtures?.away??[]},h2hPayload={fixtures:big?.fixtures?.h2h??[]};
    const prediction:any=buildPrediction({home,away,targetDate,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload});
    prediction.baseEngine=FINAL_VERSION;prediction.engine=ENGINE_VERSION;
    const thresholdPrior=applyMarketPriors(prediction,big);
    const scorelinePrior=applyScorelinePriors(prediction,big);
    const retrieval={version:BIG_DB_RETRIEVAL_VERSION,required:true,source:'PERSISTENT_DB',targetDate:targetDate??null,currentSessionProvenance:big?.currentSessionProvenance??'NOT_OBSERVABLE',exactTeam:big?.exactTeam??null,bigDbOnlyAdded:Number(big?.bigDbOnlyAdded??0),globalPrior:{fixtureCount:Number(big?.globalPrior?.fixtureCount??0),applied:true,threshold:thresholdPrior,scoreline:scorelinePrior},predictionInput:{homeFixtures:(big?.fixtures?.home??[]).length,awayFixtures:(big?.fixtures?.away??[]).length,h2hFixtures:(big?.fixtures?.h2h??[]).length,globalPriorApplied:true},note:'Exact-team history is retrieved first. When exact-team history is screenshot-only or sparse, the prediction is additionally regularized by strict-prior aggregate priors learned from the full Persistent DB.'};
    const matrix=sixTargetMatrix(prediction);
    if(!matrix.verification.complete)return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,status:'RUNTIME_CONTRACT_ERROR',error:'INCOMPLETE_2_METHODS_X_6_TARGETS'},{status:500});
    const report=renderedReport(prediction,matrix),audit=await recordAudit(env,input,{...prediction,bigDbRetrieval:retrieval});
    return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,renderedReport:report,presentationContract:{mode:'RENDER_RENDERED_REPORT_VERBATIM',source:'renderedReport',contract:matrix.contract},runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,baseEngine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2',primaryTargets:6,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION},audit});
  }catch(e:any){return Response.json({status:'ERROR',error:'BIG_DB_V2_PREDICTION_FAILURE',message:String(e?.message||e),runtime:{version:RUNTIME_VERSION,engine:ENGINE_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500})}
}} satisfies ExportedHandler<Env>;
