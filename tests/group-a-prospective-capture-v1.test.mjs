import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_A_PROSPECTIVE_CAPTURE_V1,
  buildGroupAModelFingerprint,
  selectProspectiveFt1X2Market,
  selectMaxEdge1X2,
  buildProspectiveSnapshotPlan,
  buildProspectiveDecisionPlan,
  createGroupAProspectiveResearchWriter,
  persistGroupAProspectiveCandidate,
} from '../research/group-a-prospective-capture-v1.mjs';

const fixture={fixture_id:'vf-1',target_date:'2026-09-02',kickoff_at:'2026-09-02T18:45:00Z',home_team:'Alpha',away_team:'Beta',canonical_home_team_id:'home-id',canonical_away_team_id:'away-id',verification_status:'VERIFIED'};
const context={version:'CFI_GROUP_A_PROSPECTIVE_CONTEXT_V1',maxEvidenceDate:'2026-08-19',historySupport:{home:40,away:40,h2h:5},competition:{competitionKey:'england:e1',competitionSegment:'MID_PRO',sourceDivision:'E1'},baselineFingerprint:'CFI_FINAL_V5.3.0'};
const learner={stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19',ht:{n:1000,beta:[.1,0,0,0]},ft:{n:1000,beta:[.2,0,0,0]}};
const candidate={status:'READY',modelName:'OPPONENT_STRENGTH_ARM_V1',prediction:{model:'OPPONENT_STRENGTH_ARM_V1',multiMarket:{oneXTwo:{ft:{home:.62,draw:.22,away:.16}}}}};
const marketEarly={market_snapshot_id:'m-early',fixture_id:null,verified_fixture_id:'vf-1',captured_at:'2026-09-02T15:00:00Z',kickoff_at:fixture.kickoff_at,bookmaker:'BOOK',market_family:'1X2',period:'FT',odds_home:2.20,odds_draw:3.30,odds_away:3.60,source_name:'verified-feed',is_closing:false,research_only:true};
const marketLate={...marketEarly,market_snapshot_id:'m-late',captured_at:'2026-09-02T16:00:00Z',odds_home:2.10};

test('capture contract explicitly excludes settlement writes and production mutation',()=>{
  assert.deepEqual(GROUP_A_PROSPECTIVE_CAPTURE_V1.writeAllowlist,['cfi_research_prematch_snapshots','cfi_decision_snapshots']);
  assert.equal(GROUP_A_PROSPECTIVE_CAPTURE_V1.settlementWriterIncluded,false);
  assert.equal(GROUP_A_PROSPECTIVE_CAPTURE_V1.productionMutationAllowed,false);
  assert.equal(GROUP_A_PROSPECTIVE_CAPTURE_V1.decisionUse,false);
});

test('model fingerprint is frozen-state-specific and fixture-independent',()=>{
  const a=buildGroupAModelFingerprint({modelName:candidate.modelName,learner});
  const b=buildGroupAModelFingerprint({modelName:candidate.modelName,learner:{...learner}});
  assert.equal(a,b);assert.equal(a.length,64);
  assert.notEqual(a,buildGroupAModelFingerprint({modelName:'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',learner}));
});

test('market selection uses latest available non-closing pre-decision FT 1X2 snapshot',()=>{
  const out=selectProspectiveFt1X2Market({fixtureId:'vf-1',marketSnapshots:[marketEarly,marketLate],decisionTimestamp:'2026-09-02T16:30:00Z'});
  assert.equal(out.market_snapshot_id,'m-late');
  assert.throws(()=>selectProspectiveFt1X2Market({fixtureId:'vf-1',marketSnapshots:[marketEarly],decisionTimestamp:'2026-09-02T14:00:00Z'}),/PREKICKOFF_1X2_FT_MARKET_REQUIRED/);
});

test('decision chooses deterministic maximum CFI-minus-fair-market edge through shared de-vig math',()=>{
  const best=selectMaxEdge1X2({prediction:candidate.prediction,marketSnapshot:marketLate});
  assert.equal(best.selection,'HOME');
  const plan=buildProspectiveDecisionPlan({snapshotId:'rp-1',marketSnapshot:marketLate,candidate,decisionTimestamp:'2026-09-02T16:30:00Z'});
  assert.equal(plan.research_prediction_snapshot_id,'rp-1');
  assert.equal(plan.prediction_snapshot_id,null);
  assert.equal(plan.decision,'SHADOW');
  assert.equal(plan.decision_use,false);
  assert.equal(plan.research_only,true);
  assert.equal(plan.selection,'HOME');
  assert.ok(Math.abs(plan.edge-(plan.cfi_probability-plan.market_probability))<1e-12);
});

test('snapshot plan binds immutable fixture identity, frozen model lineage and provenance',()=>{
  const plan=buildProspectiveSnapshotPlan({fixture,context,candidate,learner});
  assert.equal(plan.fixture_id,'vf-1');
  assert.equal(plan.model_name,'OPPONENT_STRENGTH_ARM_V1');
  assert.equal(plan.strict_prior,true);
  assert.equal(plan.status,'DATA_READY');
  assert.equal(plan.max_evidence_date,'2026-08-19');
  assert.equal(plan.prediction.prospectiveContext.competitionKey,'england:e1');
  assert.equal(plan.prediction.prospectiveContext.competitionSegment,'MID_PRO');
  assert.equal(plan.prediction_hash.length,64);
  assert.equal(plan.model_fingerprint.length,64);
});

test('writer is POST-only to the two research tables and returns inserted ids',async()=>{
  const calls=[];
  const reader={async readAll(){return [];}};
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),method:options.method,body:JSON.parse(options.body)});
    const table=new URL(String(url)).pathname.split('/').at(-1);
    const body=JSON.parse(options.body);
    const row=table==='cfi_research_prematch_snapshots'?{...body,snapshot_id:'rp-new',created_at:'2026-09-02T16:30:00Z'}:{...body,decision_snapshot_id:'d-new',created_at:'2026-09-02T16:30:00Z'};
    return {ok:true,status:201,async json(){return [row]},async text(){return ''}};
  };
  const writer=createGroupAProspectiveResearchWriter({baseUrl:'https://example.supabase.co',key:'sb_secret_test_only',fetchImpl,reader});
  const snapshot=await writer.persistSnapshot(buildProspectiveSnapshotPlan({fixture,context,candidate,learner}));
  const decision=await writer.persistDecision(buildProspectiveDecisionPlan({snapshotId:snapshot.snapshot_id,marketSnapshot:marketLate,candidate,decisionTimestamp:'2026-09-02T16:30:00Z'}));
  assert.equal(snapshot.snapshot_id,'rp-new');assert.equal(decision.decision_snapshot_id,'d-new');
  assert.deepEqual(calls.map(x=>x.method),['POST','POST']);
  assert.ok(calls[0].url.endsWith('/rest/v1/cfi_research_prematch_snapshots'));
  assert.ok(calls[1].url.endsWith('/rest/v1/cfi_decision_snapshots'));
  assert.deepEqual(writer.writeAllowlist,['cfi_research_prematch_snapshots','cfi_decision_snapshots']);
  assert.equal(calls.some(x=>x.url.includes('cfi_prediction_snapshots')),false);
  assert.equal(calls.some(x=>x.url.includes('cfi_market_decision_settlements')),false);
});

test('existing snapshot hash mismatch fails closed instead of revising immutable prediction',async()=>{
  const plan=buildProspectiveSnapshotPlan({fixture,context,candidate,learner});
  const reader={async readAll(path){if(path.startsWith('cfi_research_prematch_snapshots?'))return [{snapshot_id:'existing',fixture_id:'vf-1',model_fingerprint:plan.model_fingerprint,prediction_hash:'different',status:'DATA_READY',strict_prior:true}];return [];}};
  const writer=createGroupAProspectiveResearchWriter({baseUrl:'https://example.supabase.co',key:'sb_secret_test_only',fetchImpl:async()=>{throw new Error('WRITE_SHOULD_NOT_RUN')},reader});
  await assert.rejects(()=>writer.persistSnapshot(plan),/EXISTING_SNAPSHOT_MISMATCH/);
});

test('end-to-end persistence remains candidate-specific and does not settle results',async()=>{
  const records={snapshot:[],decision:[]};
  const writer={
    async persistSnapshot(plan){records.snapshot.push(plan);return {...plan,snapshot_id:'rp-1',idempotent:false}},
    async persistDecision(plan){records.decision.push(plan);return {...plan,decision_snapshot_id:'d-1',idempotent:false}},
  };
  const out=await persistGroupAProspectiveCandidate({writer,fixture,context,candidate,learner,marketSnapshots:[marketEarly,marketLate],decisionTimestamp:'2026-09-02T16:30:00Z'});
  assert.equal(out.snapshotId,'rp-1');assert.equal(out.decisionSnapshotId,'d-1');assert.equal(out.settlementPath,'EXISTING_APPEND_ONLY_CFI_MARKET_DECISION_SETTLEMENTS');
  assert.equal(records.snapshot.length,1);assert.equal(records.decision.length,1);
  assert.equal(out.productionMutationAllowed,false);assert.equal(out.productionEligible,false);assert.equal(out.noReconstruction,true);
});
