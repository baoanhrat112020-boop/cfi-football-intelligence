import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeForwardMarketCapture,deriveFairMarketProbability,buildForwardDecision,settleForwardMarket,forwardCollectionReadiness,FORWARD_MARKET_EVIDENCE_PIPELINE_V1} from '../research/forward-market-evidence-pipeline.mjs';

const base={fixture_id:'fx-1',captured_at:'2026-08-23T10:00:00Z',kickoff_at:'2026-08-23T12:00:00Z',bookmaker:'BOOK_A',market_family:'1X2',period:'FT',odds_home:2.1,odds_draw:3.4,odds_away:3.6,source_name:'provider',source_provenance:'provider:event:123'};

test('pipeline is research-only and forbids synthetic/reconstructed captures',()=>{
  assert.equal(FORWARD_MARKET_EVIDENCE_PIPELINE_V1.decisionUse,false);
  assert.equal(FORWARD_MARKET_EVIDENCE_PIPELINE_V1.baselineLock,'R0_IMMUTABLE');
  assert.equal(normalizeForwardMarketCapture({...base,synthetic:true}).status,'BLOCKED');
  assert.equal(normalizeForwardMarketCapture({...base,reconstructed:true}).status,'BLOCKED');
});

test('valid 1X2 capture normalizes both canonical and verified-fixture lineages',()=>{
  const n=normalizeForwardMarketCapture(base);assert.equal(n.status,'READY');
  const v=normalizeForwardMarketCapture({...base,fixture_id:null,verified_fixture_id:'vf-1'});assert.equal(v.status,'READY');
  const h=deriveFairMarketProbability(n.row,'HOME'),d=deriveFairMarketProbability(n.row,'DRAW'),a=deriveFairMarketProbability(n.row,'AWAY');
  assert.ok(Math.abs(h.probability+d.probability+a.probability-1)<1e-12);
  assert.ok(h.vig>0);
});

test('forward decision reuses fair market probability for production and research prediction lineages',()=>{
  const snapshot=normalizeForwardMarketCapture(base).row;
  const d=buildForwardDecision({snapshot,selection:'HOME',cfi_probability:.55,prediction_snapshot_id:'p1',market_snapshot_id:'m1',decision_timestamp:'2026-08-23T10:05:00Z',decision:'SHADOW'});
  assert.equal(d.decisionUse,false);assert.equal(d.productionEligible,false);assert.ok(d.edge>0);
  const researchSnapshot=normalizeForwardMarketCapture({...base,fixture_id:null,verified_fixture_id:'vf-1'}).row;
  const r=buildForwardDecision({snapshot:researchSnapshot,selection:'AWAY',cfi_probability:.42,research_prediction_snapshot_id:'rp1',market_snapshot_id:'m2',decision_timestamp:'2026-08-23T10:06:00Z',decision:'SHADOW'});
  assert.equal(r.research_prediction_snapshot_id,'rp1');assert.equal(r.prediction_snapshot_id,null);assert.equal(r.decision_use,false);assert.equal(r.research_only,true);
  assert.throws(()=>buildForwardDecision({snapshot,selection:'HOME',cfi_probability:.55,prediction_snapshot_id:'p1',market_snapshot_id:'m1',decision_timestamp:'2026-08-23T12:05:00Z',decision:'SHADOW'}));
});

test('settlement supports 1X2 and quarter O/U/AH five-state outcomes',()=>{
  const one=normalizeForwardMarketCapture(base).row;
  assert.equal(settleForwardMarket({snapshot:one,selection:'HOME',homeGoals:2,awayGoals:1,settled_at:'2026-08-23T14:00:00Z',result_provenance:'verified'}).state,'FULL_WIN');
  const ou=normalizeForwardMarketCapture({...base,market_family:'OVER_UNDER',line:2.25,odds_home:null,odds_draw:null,odds_away:null,odds_over:1.9,odds_under:1.95}).row;
  assert.equal(settleForwardMarket({snapshot:ou,selection:'OVER',homeGoals:2,awayGoals:0,settled_at:'2026-08-23T14:00:00Z',result_provenance:'verified'}).state,'HALF_LOSS');
  const ah=normalizeForwardMarketCapture({...base,market_family:'ASIAN_HANDICAP',line:-0.25,odds_home:1.92,odds_draw:null,odds_away:1.96}).row;
  assert.equal(settleForwardMarket({snapshot:ah,selection:'HOME',homeGoals:1,awayGoals:1,settled_at:'2026-08-23T14:00:00Z',result_provenance:'verified'}).state,'HALF_LOSS');
});

test('collection readiness blocks empty or partially invalid real capture sets',()=>{
  assert.deepEqual(forwardCollectionReadiness([]).hardFailures,['NO_REAL_FORWARD_MARKET_CAPTURE']);
  assert.equal(forwardCollectionReadiness([base]).status,'READY');
  assert.equal(forwardCollectionReadiness([base,{...base,captured_at:'2026-08-23T13:00:00Z'}]).status,'BLOCKED');
});
