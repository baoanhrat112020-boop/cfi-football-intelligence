import { createHash } from 'node:crypto';
import { classifyResearchKey, createResearchSupabaseReader } from './supabase-read-adapter.mjs';
import { buildForwardDecision, deriveFairMarketProbability } from './forward-market-evidence-pipeline.mjs';

export const GROUP_A_PROSPECTIVE_CAPTURE_V1=Object.freeze({
  version:'CFI_GROUP_A_PROSPECTIVE_CAPTURE_V1',
  researchOnly:true,
  decisionUse:false,
  productionMutationAllowed:false,
  productionEligible:false,
  noReconstruction:true,
  settlementWriterIncluded:false,
  settlementPath:'EXISTING_APPEND_ONLY_CFI_MARKET_DECISION_SETTLEMENTS',
  writeAllowlist:Object.freeze(['cfi_research_prematch_snapshots','cfi_decision_snapshots']),
});

const text=x=>String(x??'').trim();
const iso=x=>Number.isFinite(Date.parse(text(x)));
const stableHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sideOrder=Object.freeze(['HOME','DRAW','AWAY']);

function enc(value){return encodeURIComponent(String(value));}

export function buildGroupAModelFingerprint({modelName,learner}={}){
  if(!text(modelName)||!learner||learner.stateVersion!=='CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1'||learner.trainedThrough!=='2026-08-19'){
    throw new Error('GROUP_A_PROSPECTIVE_FROZEN_MODEL_LINEAGE_REQUIRED');
  }
  return stableHash({
    contract:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',
    modelName:text(modelName),
    trainedThrough:'2026-08-19',
    learner,
  });
}

export function selectProspectiveFt1X2Market({fixtureId,marketSnapshots=[],decisionTimestamp}={}){
  if(!text(fixtureId)||!iso(decisionTimestamp))throw new Error('GROUP_A_PROSPECTIVE_MARKET_SELECTION_INPUT_INVALID');
  const t=Date.parse(decisionTimestamp);
  const rows=marketSnapshots.filter(row=>
    text(row?.verified_fixture_id)===text(fixtureId)
    && row?.research_only===true
    && row?.market_family==='1X2'
    && row?.period==='FT'
    && row?.is_closing!==true
    && iso(row?.captured_at)
    && iso(row?.kickoff_at)
    && Date.parse(row.captured_at)<Date.parse(row.kickoff_at)
    && Date.parse(row.captured_at)<=t
    && t<Date.parse(row.kickoff_at)
  ).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at)||text(a.market_snapshot_id).localeCompare(text(b.market_snapshot_id)));
  if(!rows.length)throw new Error('GROUP_A_PROSPECTIVE_PREKICKOFF_1X2_FT_MARKET_REQUIRED');
  const selected=rows[0];
  for(const side of sideOrder)deriveFairMarketProbability(selected,side);
  return selected;
}

export function selectMaxEdge1X2({prediction,marketSnapshot}={}){
  const row=prediction?.multiMarket?.oneXTwo?.ft;
  const cfi={HOME:Number(row?.home),DRAW:Number(row?.draw),AWAY:Number(row?.away)};
  if(!Object.values(cfi).every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw new Error('GROUP_A_PROSPECTIVE_1X2_PROBABILITIES_REQUIRED');
  const ranked=sideOrder.map(selection=>{
    const market=deriveFairMarketProbability(marketSnapshot,selection);
    return {selection,cfiProbability:cfi[selection],marketProbability:market.probability,edge:cfi[selection]-market.probability,vig:market.vig};
  }).sort((a,b)=>b.edge-a.edge||sideOrder.indexOf(a.selection)-sideOrder.indexOf(b.selection));
  return ranked[0];
}

export function buildProspectiveSnapshotPlan({fixture,context,candidate,learner}={}){
  if(candidate?.status!=='READY')throw new Error('GROUP_A_PROSPECTIVE_CANDIDATE_NOT_READY');
  const fixtureId=text(fixture?.fixture_id),modelName=text(candidate?.modelName),kickoff=text(fixture?.kickoff_at),targetDate=text(fixture?.target_date).slice(0,10);
  if(!fixtureId||!modelName||!iso(kickoff)||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))throw new Error('GROUP_A_PROSPECTIVE_SNAPSHOT_IDENTITY_INVALID');
  if(fixture?.verification_status!=='VERIFIED')throw new Error('GROUP_A_PROSPECTIVE_VERIFIED_FIXTURE_REQUIRED');
  if(context?.maxEvidenceDate>='2026-08-20'||context?.maxEvidenceDate>=targetDate)throw new Error('GROUP_A_PROSPECTIVE_SNAPSHOT_TEMPORAL_INVALID');
  const modelFingerprint=buildGroupAModelFingerprint({modelName,learner});
  const storedPrediction={
    ...candidate.prediction,
    prospectiveContext:{
      version:context?.version??null,
      maxEvidenceDate:context?.maxEvidenceDate??null,
      historySupport:context?.historySupport??null,
      competitionKey:context?.competition?.competitionKey??null,
      competitionSegment:context?.competition?.competitionSegment??null,
      baselineFingerprint:context?.baselineFingerprint??null,
      fixtureSourceDivision:context?.competition?.sourceDivision??null,
    },
  };
  const predictionHash=stableHash(storedPrediction);
  return {
    fixture_id:fixtureId,
    model_name:modelName,
    model_version:`${modelName}+FROZEN_2026_08_19`,
    model_fingerprint:modelFingerprint,
    target_date:targetDate,
    kickoff_at:kickoff,
    home_team:text(fixture?.home_team),
    away_team:text(fixture?.away_team),
    canonical_home_team_id:text(fixture?.canonical_home_team_id),
    canonical_away_team_id:text(fixture?.canonical_away_team_id),
    max_evidence_date:context.maxEvidenceDate,
    prediction:storedPrediction,
    prediction_hash:predictionHash,
    status:'DATA_READY',
    strict_prior:true,
  };
}

export function buildProspectiveDecisionPlan({snapshotId,marketSnapshot,candidate,decisionTimestamp}={}){
  if(!text(snapshotId)||candidate?.status!=='READY')throw new Error('GROUP_A_PROSPECTIVE_DECISION_INPUT_INVALID');
  const best=selectMaxEdge1X2({prediction:candidate.prediction,marketSnapshot});
  const row=buildForwardDecision({
    snapshot:marketSnapshot,
    selection:best.selection,
    cfi_probability:best.cfiProbability,
    research_prediction_snapshot_id:text(snapshotId),
    market_snapshot_id:text(marketSnapshot.market_snapshot_id),
    decision_timestamp:decisionTimestamp,
    uncertainty:{},
    stake_simulated:0,
    decision:'SHADOW',
  });
  return {
    prediction_snapshot_id:null,
    research_prediction_snapshot_id:row.research_prediction_snapshot_id,
    market_snapshot_id:row.market_snapshot_id,
    cfi_probability:row.cfi_probability,
    market_probability:row.market_probability,
    edge:row.edge,
    uncertainty:{},
    decision:'SHADOW',
    stake_simulated:0,
    decision_timestamp:row.decision_timestamp,
    decision_use:false,
    research_only:true,
    selection:row.selection,
  };
}

export function createGroupAProspectiveResearchWriter({baseUrl,key,fetchImpl=fetch,reader=null}={}){
  if(!baseUrl)throw new Error('CFI_SUPABASE_URL_REQUIRED');
  const keyInfo=classifyResearchKey(key);
  const read=reader??createResearchSupabaseReader({baseUrl,key,fetchImpl});
  const headers={apikey:key,Accept:'application/json','Content-Type':'application/json',Prefer:'return=representation'};
  if(keyInfo.kind==='legacy_service_role_jwt')headers.Authorization=`Bearer ${key}`;

  async function insertOnly(table,row){
    if(!GROUP_A_PROSPECTIVE_CAPTURE_V1.writeAllowlist.includes(table))throw new Error(`GROUP_A_PROSPECTIVE_WRITE_TABLE_FORBIDDEN:${table}`);
    const url=new URL(`/rest/v1/${table}`,baseUrl);
    const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(row)});
    if(!response?.ok){
      const detail=await response?.text?.().catch(()=>"")??"";
      const e=new Error(`GROUP_A_PROSPECTIVE_INSERT_FAILED:${table}:${Number(response?.status??0)}`);
      e.status=Number(response?.status??0);e.detail=detail;throw e;
    }
    const body=await response.json();
    if(!Array.isArray(body)||body.length!==1)throw new Error(`GROUP_A_PROSPECTIVE_INSERT_RESPONSE_INVALID:${table}`);
    return body[0];
  }

  async function findSnapshot(fixtureId,modelFingerprint){
    const q=`cfi_research_prematch_snapshots?select=snapshot_id,fixture_id,model_name,model_fingerprint,prediction_hash,status,strict_prior,kickoff_at,created_at&fixture_id=eq.${enc(fixtureId)}&model_fingerprint=eq.${enc(modelFingerprint)}`;
    return read.readAll(q,{critical:false,label:'group_a_existing_snapshot'});
  }
  async function persistSnapshot(plan){
    const existing=await findSnapshot(plan.fixture_id,plan.model_fingerprint);
    if(existing.length>1)throw new Error('GROUP_A_PROSPECTIVE_DUPLICATE_SNAPSHOT_LINEAGE');
    if(existing.length===1){
      if(existing[0].prediction_hash!==plan.prediction_hash||existing[0].status!=='DATA_READY'||existing[0].strict_prior!==true)throw new Error('GROUP_A_PROSPECTIVE_EXISTING_SNAPSHOT_MISMATCH');
      return {...existing[0],idempotent:true};
    }
    try{return {...await insertOnly('cfi_research_prematch_snapshots',plan),idempotent:false};}
    catch(error){
      if(error?.status!==409)throw error;
      const raced=await findSnapshot(plan.fixture_id,plan.model_fingerprint);
      if(raced.length!==1||raced[0].prediction_hash!==plan.prediction_hash)throw new Error('GROUP_A_PROSPECTIVE_SNAPSHOT_RACE_MISMATCH');
      return {...raced[0],idempotent:true};
    }
  }

  async function findDecision(snapshotId){
    const q=`cfi_decision_snapshots?select=decision_snapshot_id,research_prediction_snapshot_id,market_snapshot_id,cfi_probability,market_probability,edge,decision,stake_simulated,decision_timestamp,decision_use,research_only,selection&research_prediction_snapshot_id=eq.${enc(snapshotId)}`;
    return read.readAll(q,{critical:false,label:'group_a_existing_decision'});
  }
  async function persistDecision(plan){
    const existing=await findDecision(plan.research_prediction_snapshot_id);
    if(existing.length>1)throw new Error('GROUP_A_PROSPECTIVE_DUPLICATE_MODEL_DECISION');
    if(existing.length===1){
      const x=existing[0];
      const same=x.market_snapshot_id===plan.market_snapshot_id&&x.selection===plan.selection&&x.decision==='SHADOW'&&x.decision_use===false&&x.research_only===true;
      if(!same)throw new Error('GROUP_A_PROSPECTIVE_EXISTING_DECISION_MISMATCH');
      return {...x,idempotent:true};
    }
    try{return {...await insertOnly('cfi_decision_snapshots',plan),idempotent:false};}
    catch(error){
      if(error?.status!==409)throw error;
      const raced=await findDecision(plan.research_prediction_snapshot_id);
      if(raced.length!==1)throw new Error('GROUP_A_PROSPECTIVE_DECISION_RACE_MISMATCH');
      return {...raced[0],idempotent:true};
    }
  }

  return Object.freeze({persistSnapshot,persistDecision,writeAllowlist:[...GROUP_A_PROSPECTIVE_CAPTURE_V1.writeAllowlist]});
}

export async function persistGroupAProspectiveCandidate({writer,fixture,context,candidate,learner,marketSnapshots,decisionTimestamp}={}){
  if(!writer?.persistSnapshot||!writer?.persistDecision)throw new Error('GROUP_A_PROSPECTIVE_WRITER_REQUIRED');
  if(!iso(decisionTimestamp)||Date.parse(decisionTimestamp)>=Date.parse(fixture?.kickoff_at))throw new Error('GROUP_A_PROSPECTIVE_DECISION_MUST_PRECEDE_KICKOFF');
  const market=selectProspectiveFt1X2Market({fixtureId:fixture.fixture_id,marketSnapshots,decisionTimestamp});
  const snapshotPlan=buildProspectiveSnapshotPlan({fixture,context,candidate,learner});
  const snapshot=await writer.persistSnapshot(snapshotPlan);
  const decisionPlan=buildProspectiveDecisionPlan({snapshotId:snapshot.snapshot_id,marketSnapshot:market,candidate,decisionTimestamp});
  const decision=await writer.persistDecision(decisionPlan);
  return {
    version:GROUP_A_PROSPECTIVE_CAPTURE_V1.version,
    modelName:candidate.modelName,
    fixtureId:fixture.fixture_id,
    marketSnapshotId:market.market_snapshot_id,
    snapshotId:snapshot.snapshot_id,
    decisionSnapshotId:decision.decision_snapshot_id,
    selection:decision.selection,
    edge:Number(decision.edge),
    snapshotIdempotent:snapshot.idempotent===true,
    decisionIdempotent:decision.idempotent===true,
    researchOnly:true,decisionUse:false,productionMutationAllowed:false,productionEligible:false,noReconstruction:true,
    settlementPath:GROUP_A_PROSPECTIVE_CAPTURE_V1.settlementPath,
  };
}
