import test from 'node:test';
import assert from 'node:assert/strict';
import { fitJointMarketIntensity,K034_CONTRACT } from '../research/joint-market-intensity-calibration.mjs';

const base={fixture_id:'fixture-1',captured_at:'2026-08-24T10:00:00Z',kickoff_at:'2026-08-24T12:00:00Z',bookmaker:'TEST',period:'FT',source_name:'TEST',source_provenance:{verified:true},is_closing:false,research_only:true};
const x12={...base,market_family:'1X2',line:null,odds_home:2.1,odds_draw:3.4,odds_away:3.6,odds_over:null,odds_under:null};
const ou={...base,market_family:'OVER_UNDER',line:2.5,odds_home:null,odds_draw:null,odds_away:null,odds_over:1.95,odds_under:1.95};

test('K034 contract is immutable research-only',()=>{
 assert.equal(K034_CONTRACT.researchOnly,true);assert.equal(K034_CONTRACT.decisionUse,false);assert.equal(K034_CONTRACT.baselineLock,'R0_IMMUTABLE');assert.equal(K034_CONTRACT.productionEligible,false);
});

test('K034 fits one deterministic latent intensity to paired real market snapshots',()=>{
 const a=fitJointMarketIntensity({oneXTwoSnapshot:x12,overUnderSnapshot:ou});
 const b=fitJointMarketIntensity({oneXTwoSnapshot:{...x12},overUnderSnapshot:{...ou}});
 assert.equal(a.status,'READY');assert.deepEqual(a.fit,b.fit);assert.equal(a.audit.strictPrior,true);assert.ok(a.fit.lambdaHome>0);assert.ok(a.fit.lambdaAway>0);assert.ok(a.fit.squaredError>=0);assert.equal(a.productionEligible,false);
});

test('K034 fails closed with exact contract reasons',()=>{
 assert.throws(()=>fitJointMarketIntensity({oneXTwoSnapshot:x12}),{message:'VALID_FT_OU_SNAPSHOT_REQUIRED'});
 assert.throws(()=>fitJointMarketIntensity({overUnderSnapshot:ou}),{message:'VALID_FT_1X2_SNAPSHOT_REQUIRED'});
 assert.throws(()=>fitJointMarketIntensity({oneXTwoSnapshot:x12,overUnderSnapshot:{...ou,market_family:'ASIAN_HANDICAP'}}),{message:'VALID_FT_OU_SNAPSHOT_REQUIRED'});
 assert.throws(()=>fitJointMarketIntensity({oneXTwoSnapshot:x12,overUnderSnapshot:{...ou,fixture_id:'other'}}),{message:'FIXTURE_MISMATCH'});
 assert.throws(()=>fitJointMarketIntensity({oneXTwoSnapshot:x12,overUnderSnapshot:ou,synthetic:true}),{message:'REAL_MARKET_SNAPSHOTS_REQUIRED'});
 assert.throws(()=>fitJointMarketIntensity({oneXTwoSnapshot:{...x12,captured_at:x12.kickoff_at},overUnderSnapshot:ou}),{message:'STRICT_PRIOR_MARKET_FAILURE'});
});
