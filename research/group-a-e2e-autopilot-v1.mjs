import fs from 'node:fs/promises';
import {
  classifyResearchKey,
  createResearchSupabaseReader,
  resolveResearchCredentials,
} from './supabase-read-adapter.mjs';
import {
  createGroupAProspectiveResearchWriter,
} from './group-a-prospective-capture-v1.mjs';
import {
  GROUP_A_PROSPECTIVE_RUNNER_V1,
  runGroupAProspectiveCapture,
} from './group-a-prospective-runner-v1.mjs';

export const GROUP_A_E2E_AUTOPILOT_V1=Object.freeze({
  version:'CFI_GROUP_A_E2E_AUTOPILOT_V1',
  researchOnly:true,
  decisionUse:false,
  productionMutationAllowed:false,
  productionEligible:false,
  noReconstruction:true,
  captureRunner:GROUP_A_PROSPECTIVE_RUNNER_V1.version,
  settlementWriterIncluded:false,
  settlementRpc:'cfi_settle_forward_market_ready_v3_research',
  settlementVersion:'CFI_FORWARD_MARKET_SETTLEMENT_V3_RESEARCH',
  preKickoffSettlementPolicy:'DEFER_TO_POST_KICKOFF_EXISTING_RPC',
});

const text=x=>String(x??'').trim();
const iso=x=>Number.isFinite(Date.parse(text(x)));
const enc=x=>encodeURIComponent(String(x));
const before=(a,b)=>iso(a)&&iso(b)&&Date.parse(a)<Date.parse(b);

function requireOne(rows,label){
  if(!Array.isArray(rows)||rows.length!==1)throw new Error(`GROUP_A_E2E_${label}_CARDINALITY:${Array.isArray(rows)?rows.length:'INVALID'}`);
  return rows[0];
}

export function auditImmutableCaptureRecords({captureRow,snapshot,decision,market}={}){
  if(!captureRow||!snapshot||!decision||!market)throw new Error('GROUP_A_E2E_AUDIT_INPUT_REQUIRED');
  if(snapshot.snapshot_id!==captureRow.snapshotId||snapshot.fixture_id!==captureRow.fixtureId||snapshot.model_name!==captureRow.modelName)throw new Error('GROUP_A_E2E_SNAPSHOT_IDENTITY_MISMATCH');
  if(!text(snapshot.model_fingerprint)||!text(snapshot.prediction_hash))throw new Error('GROUP_A_E2E_SNAPSHOT_HASH_LINEAGE_REQUIRED');
  if(snapshot.status!=='DATA_READY'||snapshot.strict_prior!==true)throw new Error('GROUP_A_E2E_SNAPSHOT_STRICT_PRIOR_REQUIRED');
  if(!before(snapshot.created_at,snapshot.kickoff_at))throw new Error('GROUP_A_E2E_SNAPSHOT_MUST_PRECEDE_KICKOFF');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text(snapshot.max_evidence_date))||!/^\d{4}-\d{2}-\d{2}$/.test(text(snapshot.target_date)))throw new Error('GROUP_A_E2E_EVIDENCE_DATE_REQUIRED');
  if(snapshot.max_evidence_date>='2026-08-20'||snapshot.max_evidence_date>=snapshot.target_date)throw new Error('GROUP_A_E2E_STRICT_PRIOR_BOUNDARY_FAIL');

  if(decision.decision_snapshot_id!==captureRow.decisionSnapshotId||decision.research_prediction_snapshot_id!==snapshot.snapshot_id)throw new Error('GROUP_A_E2E_DECISION_IDENTITY_MISMATCH');
  if(decision.prediction_snapshot_id!==null&&decision.prediction_snapshot_id!==undefined)throw new Error('GROUP_A_E2E_PRODUCTION_PREDICTION_REFERENCE_FORBIDDEN');
  if(decision.market_snapshot_id!==market.market_snapshot_id||decision.market_snapshot_id!==captureRow.marketSnapshotId)throw new Error('GROUP_A_E2E_DECISION_MARKET_MISMATCH');
  if(decision.decision_use!==false||decision.research_only!==true||decision.decision!=='SHADOW')throw new Error('GROUP_A_E2E_DECISION_ISOLATION_FAIL');
  if(!['HOME','DRAW','AWAY'].includes(decision.selection))throw new Error('GROUP_A_E2E_DECISION_SELECTION_INVALID');
  if(!before(decision.decision_timestamp,market.kickoff_at))throw new Error('GROUP_A_E2E_DECISION_MUST_PRECEDE_KICKOFF');

  if(market.verified_fixture_id!==snapshot.fixture_id)throw new Error('GROUP_A_E2E_MARKET_FIXTURE_MISMATCH');
  if(market.research_only!==true||market.is_closing===true||market.market_family!=='1X2'||market.period!=='FT')throw new Error('GROUP_A_E2E_MARKET_CONTRACT_FAIL');
  if(!before(market.captured_at,market.kickoff_at)||snapshot.kickoff_at!==market.kickoff_at)throw new Error('GROUP_A_E2E_MARKET_TEMPORAL_FAIL');

  return Object.freeze({
    status:'PASS',fixtureId:snapshot.fixture_id,modelName:snapshot.model_name,
    snapshotId:snapshot.snapshot_id,decisionSnapshotId:decision.decision_snapshot_id,
    marketSnapshotId:market.market_snapshot_id,predictionHash:snapshot.prediction_hash,
    modelFingerprint:snapshot.model_fingerprint,researchOnly:true,decisionUse:false,
    productionMutationAllowed:false,noReconstruction:true,
  });
}

export function validateResearchSettlementResponse(value){
  const x=Array.isArray(value)&&value.length===1?value[0]:value;
  if(!x||x.status!=='OK'||x.version!==GROUP_A_E2E_AUTOPILOT_V1.settlementVersion)throw new Error('GROUP_A_E2E_SETTLEMENT_RPC_CONTRACT_FAIL');
  if(x.researchOnly!==true||x.decisionUse!==false||x.productionMutation!==false)throw new Error('GROUP_A_E2E_SETTLEMENT_RPC_ISOLATION_FAIL');
  for(const k of ['scanned','inserted','pendingResult'])if(!Number.isInteger(Number(x[k]))||Number(x[k])<0)throw new Error(`GROUP_A_E2E_SETTLEMENT_RPC_${k.toUpperCase()}_INVALID`);
  return x;
}

export function auditResearchSettlementRecord({settlement,decisionSnapshotId}={}){
  if(!settlement)return Object.freeze({status:'PENDING_RESULT',decisionSnapshotId});
  if(settlement.decision_snapshot_id!==decisionSnapshotId)throw new Error('GROUP_A_E2E_SETTLEMENT_DECISION_MISMATCH');
  if(settlement.research_only!==true||settlement.immutable!==true)throw new Error('GROUP_A_E2E_SETTLEMENT_IMMUTABILITY_FAIL');
  if(!['FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS'].includes(settlement.settlement_state))throw new Error('GROUP_A_E2E_SETTLEMENT_STATE_INVALID');
  const p=settlement.result_provenance;
  if(!p||p.resolverVersion!==GROUP_A_E2E_AUTOPILOT_V1.settlementVersion||p.researchOnly!==true||p.productionMutation!==false)throw new Error('GROUP_A_E2E_SETTLEMENT_PROVENANCE_FAIL');
  return Object.freeze({status:'SETTLED',decisionSnapshotId,settlementId:settlement.settlement_id,settlementState:settlement.settlement_state});
}

async function auditCapturedRows({reader,capture}={}){
  const out=[];
  for(const row of capture.results??[]){
    if(row.status!=='CAPTURED')continue;
    const [snapshots,decisions,markets]=await Promise.all([
      reader.readAll(`cfi_research_prematch_snapshots?select=snapshot_id,fixture_id,model_name,model_fingerprint,prediction_hash,status,strict_prior,target_date,kickoff_at,created_at,max_evidence_date&snapshot_id=eq.${enc(row.snapshotId)}`,{critical:false,label:'group_a_e2e_snapshot'}),
      reader.readAll(`cfi_decision_snapshots?select=decision_snapshot_id,research_prediction_snapshot_id,prediction_snapshot_id,market_snapshot_id,decision,decision_timestamp,decision_use,research_only,selection&decision_snapshot_id=eq.${enc(row.decisionSnapshotId)}`,{critical:false,label:'group_a_e2e_decision'}),
      reader.readAll(`cfi_market_snapshots?select=market_snapshot_id,verified_fixture_id,captured_at,kickoff_at,research_only,is_closing,market_family,period&market_snapshot_id=eq.${enc(row.marketSnapshotId)}`,{critical:false,label:'group_a_e2e_market'}),
    ]);
    out.push(auditImmutableCaptureRecords({
      captureRow:row,
      snapshot:requireOne(snapshots,'SNAPSHOT'),
      decision:requireOne(decisions,'DECISION'),
      market:requireOne(markets,'MARKET'),
    }));
  }
  if(out.length!==Number(capture.capturedDecisions??0))throw new Error('GROUP_A_E2E_CAPTURE_AUDIT_COUNT_MISMATCH');
  return out;
}

export function createResearchSettlementRpcClient({baseUrl,key,fetchImpl=fetch}={}){
  if(!baseUrl)throw new Error('CFI_SUPABASE_URL_REQUIRED');
  const keyInfo=classifyResearchKey(key);
  return async function call(){
    const url=new URL(`/rest/v1/rpc/${GROUP_A_E2E_AUTOPILOT_V1.settlementRpc}`,baseUrl);
    const headers={apikey:key,Accept:'application/json','Content-Type':'application/json'};
    if(keyInfo.kind==='legacy_service_role_jwt')headers.Authorization=`Bearer ${key}`;
    let response;
    try{response=await fetchImpl(url,{method:'POST',headers,body:'{}'});}catch{throw new Error('GROUP_A_E2E_SETTLEMENT_RPC_NETWORK_FAIL');}
    if(!response?.ok)throw new Error(`GROUP_A_E2E_SETTLEMENT_RPC_HTTP_${Number(response?.status??0)}`);
    return validateResearchSettlementResponse(await response.json());
  };
}

async function auditCaptureSettlements({reader,capture}={}){
  const out=[];
  for(const row of capture.results??[]){
    if(row.status!=='CAPTURED')continue;
    const rows=await reader.readAll(`cfi_market_decision_settlements?select=settlement_id,decision_snapshot_id,settlement_state,result_provenance,research_only,immutable&decision_snapshot_id=eq.${enc(row.decisionSnapshotId)}`,{critical:false,label:'group_a_e2e_settlement'});
    if(rows.length>1)throw new Error('GROUP_A_E2E_SETTLEMENT_DUPLICATE');
    out.push(auditResearchSettlementRecord({settlement:rows[0]??null,decisionSnapshotId:row.decisionSnapshotId}));
  }
  return out;
}

export async function runGroupAE2EAutopilot({corpus,featureBundle,hfSummary,reader,writer=null,settlementRpc=null,maxFixtures,write=false,settle=false,nowFn=()=>new Date().toISOString()}={}){
  if(!reader?.readAll)throw new Error('GROUP_A_E2E_READER_REQUIRED');
  const preflightNow=nowFn();
  const preflight=await runGroupAProspectiveCapture({corpus,featureBundle,hfSummary,reader,writer:null,nowIso:preflightNow,maxFixtures,write:false});
  if(preflight.researchOnly!==true||preflight.decisionUse!==false||preflight.productionMutationAllowed!==false||preflight.noReconstruction!==true)throw new Error('GROUP_A_E2E_PREFLIGHT_ISOLATION_FAIL');
  if(!write){
    return {version:GROUP_A_E2E_AUTOPILOT_V1.version,mode:'DRY_RUN',preflight,capture:null,immutableAudit:[],settlementRequested:false,settlement:{status:'NOT_RUN_DRY_RUN'},settlementAudit:[],...GROUP_A_E2E_AUTOPILOT_V1};
  }
  if(!writer?.persistSnapshot||!writer?.persistDecision)throw new Error('GROUP_A_E2E_WRITER_REQUIRED');
  if(settle&&typeof settlementRpc!=='function')throw new Error('GROUP_A_E2E_SETTLEMENT_RPC_REQUIRED');

  // Fresh wall-clock timestamp is mandatory here: never reuse a stale preflight timestamp for writes.
  const captureNow=nowFn();
  if(!iso(captureNow)||Date.parse(captureNow)<Date.parse(preflightNow))throw new Error('GROUP_A_E2E_CLOCK_INVALID');
  const capture=await runGroupAProspectiveCapture({corpus,featureBundle,hfSummary,reader,writer,nowIso:captureNow,maxFixtures,write:true});
  const immutableAudit=await auditCapturedRows({reader,capture});

  // The capture workflow is pre-kickoff by contract. Do not call the broad research
  // settlement RPC here: it scans unrelated past research decisions and cannot settle
  // the just-captured future cohort. Settlement is explicitly deferred to the existing
  // post-kickoff research settlement path unless a caller separately opts in.
  let settlement={
    status:'NOT_RUN_PREKICKOFF_CAPTURE',
    version:GROUP_A_E2E_AUTOPILOT_V1.settlementVersion,
    researchOnly:true,
    decisionUse:false,
    productionMutation:false,
  };
  let settlementAudit=[];
  if(settle){
    settlement=validateResearchSettlementResponse(await settlementRpc());
    settlementAudit=await auditCaptureSettlements({reader,capture});
  }

  return {
    version:GROUP_A_E2E_AUTOPILOT_V1.version,mode:'WRITE_RESEARCH_ONLY',preflight,capture,
    immutableAudit,settlementRequested:Boolean(settle),settlement,settlementAudit,
    capturedDecisions:capture.capturedDecisions,
    immutableAuditPassed:immutableAudit.length===capture.capturedDecisions,
    settledFromThisCapture:settle?settlementAudit.filter(x=>x.status==='SETTLED').length:0,
    pendingFromThisCapture:settle?settlementAudit.filter(x=>x.status==='PENDING_RESULT').length:0,
    settlementDeferredDecisions:settle?0:capture.capturedDecisions,
    researchOnly:true,decisionUse:false,productionMutationAllowed:false,productionEligible:false,noReconstruction:true,
    settlementWriterIncluded:false,settlementRpc:GROUP_A_E2E_AUTOPILOT_V1.settlementRpc,
    preKickoffSettlementPolicy:GROUP_A_E2E_AUTOPILOT_V1.preKickoffSettlementPolicy,
  };
}

async function main(){
  const [corpusPath,featurePath,hfSummaryPath,outputPath='group-a-e2e-autopilot-result.json',mode='--dry-run',settlementMode='--no-settle']=process.argv.slice(2);
  if(!corpusPath||!featurePath||!hfSummaryPath)throw new Error('USAGE: node research/group-a-e2e-autopilot-v1.mjs <r0.json> <group-a.json> <hf-summary.json> [output.json] [--dry-run|--write] [--no-settle|--settle]');
  if(!['--dry-run','--write'].includes(mode))throw new Error('GROUP_A_E2E_MODE_INVALID');
  if(!['--no-settle','--settle'].includes(settlementMode))throw new Error('GROUP_A_E2E_SETTLEMENT_MODE_INVALID');
  const [corpus,featureBundle,hfSummary]=await Promise.all([corpusPath,featurePath,hfSummaryPath].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
  const {baseUrl,key}=resolveResearchCredentials(process.env);
  const reader=createResearchSupabaseReader({baseUrl,key});
  const write=mode==='--write';
  const settle=write&&settlementMode==='--settle';
  const writer=write?createGroupAProspectiveResearchWriter({baseUrl,key,reader}):null;
  const settlementRpc=settle?createResearchSettlementRpcClient({baseUrl,key}):null;
  const result=await runGroupAE2EAutopilot({corpus,featureBundle,hfSummary,reader,writer,settlementRpc,maxFixtures:process.env.CFI_GROUP_A_PROSPECTIVE_MAX_FIXTURES,write,settle});
  await fs.writeFile(outputPath,`${JSON.stringify(result,null,2)}\n`);
  process.stdout.write(`${JSON.stringify({outputPath,version:result.version,mode:result.mode,preflightReady:result.preflight?.dryRunReady??0,capturedDecisions:result.capturedDecisions??0,immutableAuditPassed:result.immutableAuditPassed??null,settlementRequested:result.settlementRequested,settlement:result.settlement,settlementDeferredDecisions:result.settlementDeferredDecisions??0,researchOnly:true,decisionUse:false,productionMutationAllowed:false})}\n`);
}

if(import.meta.url===`file://${process.argv[1]}`)main().catch(error=>{console.error(error?.stack??String(error));process.exitCode=1});
