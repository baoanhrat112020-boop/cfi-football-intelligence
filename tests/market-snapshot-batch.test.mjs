import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarketSnapshotBatch, validateDecisionBatch } from '../research/market-snapshot-batch.mjs';

const market={fixture_id:'f1',captured_at:'2026-08-23T05:00:00Z',kickoff_at:'2026-08-23T06:00:00Z',bookmaker:'TEST',market_family:'OVER_UNDER',period:'FT',line:2.5,odds_over:2.0,odds_under:1.9,source_name:'verified-feed',is_closing:false};

test('valid forward-only batch is write eligible',()=>{
 const r=validateMarketSnapshotBatch([market]);
 assert.equal(r.writeEligible,true);assert.equal(r.accepted.length,1);assert.equal(r.rejected.length,0);
});

test('post-kickoff and duplicate snapshots fail closed',()=>{
 const late={...market,captured_at:'2026-08-23T06:00:00Z'};
 const r=validateMarketSnapshotBatch([market,market,late]);
 assert.equal(r.writeEligible,false);
 assert.ok(r.rejected.some(x=>x.error.includes('DUPLICATE_SNAPSHOT')));
 assert.ok(r.rejected.some(x=>x.error.includes('CAPTURE_MUST_PRECEDE_KICKOFF')));
});

test('decision batch forbids closing price and decisionUse',()=>{
 const closing={...market,is_closing:true};
 const d={prediction_snapshot_id:'p1',market_snapshot_id:'m1',cfi_probability:.61,market_probability:.55,decision:'WATCH',stake_simulated:0,decision_timestamp:'2026-08-23T05:30:00Z',decisionUse:false};
 assert.equal(validateDecisionBatch([d],{m1:market}).writeEligible,true);
 assert.equal(validateDecisionBatch([{...d,decisionUse:true}],{m1:market}).writeEligible,false);
 assert.equal(validateDecisionBatch([d],{m1:closing}).writeEligible,false);
});
