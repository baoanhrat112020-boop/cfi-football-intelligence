import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  GROUP_A_E2E_AUTOPILOT_V1,
  auditImmutableCaptureRecords,
  auditResearchSettlementRecord,
  createResearchSettlementRpcClient,
  validateResearchSettlementResponse,
} from '../research/group-a-e2e-autopilot-v1.mjs';

const captureRow={
  fixtureId:'fixture-1',modelName:'OPPONENT_STRENGTH_ARM_V1',snapshotId:'snapshot-1',
  decisionSnapshotId:'decision-1',marketSnapshotId:'market-1',status:'CAPTURED',
};
const snapshot={
  snapshot_id:'snapshot-1',fixture_id:'fixture-1',model_name:'OPPONENT_STRENGTH_ARM_V1',
  model_fingerprint:'fp',prediction_hash:'hash',status:'DATA_READY',strict_prior:true,
  target_date:'2026-09-03',kickoff_at:'2026-09-03T01:00:00.000Z',
  created_at:'2026-09-02T12:00:00.000Z',max_evidence_date:'2026-08-19',
};
const decision={
  decision_snapshot_id:'decision-1',research_prediction_snapshot_id:'snapshot-1',prediction_snapshot_id:null,
  market_snapshot_id:'market-1',decision:'SHADOW',decision_timestamp:'2026-09-02T12:00:01.000Z',
  decision_use:false,research_only:true,selection:'HOME',
};
const market={
  market_snapshot_id:'market-1',verified_fixture_id:'fixture-1',captured_at:'2026-09-02T11:55:00.000Z',
  kickoff_at:'2026-09-03T01:00:00.000Z',research_only:true,is_closing:false,market_family:'1X2',period:'FT',
};

test('autopilot immutable capture audit accepts exact research-only prospective chain',()=>{
  const out=auditImmutableCaptureRecords({captureRow,snapshot,decision,market});
  assert.equal(out.status,'PASS');
  assert.equal(out.predictionHash,'hash');
  assert.equal(out.productionMutationAllowed,false);
});

test('autopilot immutable capture audit rejects production prediction refs and post-kickoff decisions',()=>{
  assert.throws(()=>auditImmutableCaptureRecords({captureRow,snapshot,decision:{...decision,prediction_snapshot_id:'production-1'},market}),/PRODUCTION_PREDICTION_REFERENCE_FORBIDDEN/);
  assert.throws(()=>auditImmutableCaptureRecords({captureRow,snapshot,decision:{...decision,decision_timestamp:'2026-09-03T01:00:00.000Z'},market}),/DECISION_MUST_PRECEDE_KICKOFF/);
});

test('autopilot immutable capture audit rejects market identity drift and holdout leakage',()=>{
  assert.throws(()=>auditImmutableCaptureRecords({captureRow,snapshot,decision,market:{...market,verified_fixture_id:'fixture-2'}}),/MARKET_FIXTURE_MISMATCH/);
  assert.throws(()=>auditImmutableCaptureRecords({captureRow,snapshot:{...snapshot,max_evidence_date:'2026-08-20'},decision,market}),/STRICT_PRIOR_BOUNDARY_FAIL/);
});

test('autopilot validates only exact V3 research settlement RPC response',()=>{
  const ok=validateResearchSettlementResponse({status:'OK',version:'CFI_FORWARD_MARKET_SETTLEMENT_V3_RESEARCH',researchOnly:true,decisionUse:false,productionMutation:false,scanned:2,inserted:1,pendingResult:1});
  assert.equal(ok.inserted,1);
  assert.throws(()=>validateResearchSettlementResponse({...ok,version:'CFI_FORWARD_MARKET_SETTLEMENT_V3'}),/CONTRACT_FAIL/);
  assert.throws(()=>validateResearchSettlementResponse({...ok,productionMutation:true}),/ISOLATION_FAIL/);
});

test('autopilot settlement audit accepts immutable V3 research provenance and permits pending result',()=>{
  assert.deepEqual(auditResearchSettlementRecord({settlement:null,decisionSnapshotId:'decision-1'}),{status:'PENDING_RESULT',decisionSnapshotId:'decision-1'});
  const out=auditResearchSettlementRecord({decisionSnapshotId:'decision-1',settlement:{
    settlement_id:'settlement-1',decision_snapshot_id:'decision-1',settlement_state:'FULL_WIN',
    research_only:true,immutable:true,result_provenance:{resolverVersion:'CFI_FORWARD_MARKET_SETTLEMENT_V3_RESEARCH',researchOnly:true,productionMutation:false},
  }});
  assert.equal(out.status,'SETTLED');
});

test('autopilot RPC client posts only to existing V3 research RPC using privileged key',async()=>{
  let seen;
  const client=createResearchSettlementRpcClient({
    baseUrl:'https://example.supabase.co',key:'sb_secret_test',
    fetchImpl:async(url,init)=>{seen={url:String(url),init};return{ok:true,status:200,json:async()=>({status:'OK',version:'CFI_FORWARD_MARKET_SETTLEMENT_V3_RESEARCH',researchOnly:true,decisionUse:false,productionMutation:false,scanned:0,inserted:0,pendingResult:0})};},
  });
  await client();
  assert.match(seen.url,/\/rest\/v1\/rpc\/cfi_settle_forward_market_ready_v3_research$/);
  assert.equal(seen.init.method,'POST');
  assert.equal(seen.init.headers.apikey,'sb_secret_test');
});

test('autopilot contract has no settlement writer and source contains no research settlement insert',async()=>{
  assert.equal(GROUP_A_E2E_AUTOPILOT_V1.settlementWriterIncluded,false);
  assert.equal(GROUP_A_E2E_AUTOPILOT_V1.settlementRpc,'cfi_settle_forward_market_ready_v3_research');
  assert.equal(GROUP_A_E2E_AUTOPILOT_V1.productionMutationAllowed,false);
  const source=await fs.readFile(new URL('../research/group-a-e2e-autopilot-v1.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/insert\s+into\s+public\.cfi_market_decision_settlements/i);
  assert.doesNotMatch(source,/\.from\(['"]cfi_market_decision_settlements['"]\)\.insert/i);
});
