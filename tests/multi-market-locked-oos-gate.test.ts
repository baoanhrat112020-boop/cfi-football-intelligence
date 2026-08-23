import test from 'node:test';
import assert from 'node:assert/strict';
import { lockMultiMarketShadow } from '../src/prediction/multi-market-live-shadow.ts';
import { evaluateLockedOosGate, type SettledLockedOosRow } from '../src/prediction/multi-market-locked-oos-gate.ts';

function row(i:number,candidate={home:.62,draw:.20,away:.18},baseline={home:.50,draw:.25,away:.25},outcome='home'):SettledLockedOosRow{
 const fixtureId=`fx-${i}`;
 return{
  fixtureId,kickoffAt:'2026-08-24T12:00:00Z',settledAt:'2026-08-24T14:10:00Z',maxEvidenceDate:'2026-08-23',outcome,resultVerified:true,
  snapshot:lockMultiMarketShadow({fixtureId,targetDate:'2026-08-24',createdAt:'2026-08-24T10:00:00Z',modelVersion:'CFI_MULTI_MARKET_V1',payload:{market:'FT_1X2',probabilities:candidate,baselineProbabilities:baseline}}),
 };
}

test('30 immutable prospective rows beating baseline pass locked OOS shadow gate only',()=>{
 const rows=Array.from({length:30},(_,i)=>row(i));
 const r=evaluateLockedOosGate(rows);
 assert.equal(r.status,'PASS');
 assert.equal(r.shadowTrialGatePassed,true);
 assert.equal(r.productionEligible,false);
 assert.equal(r.decisionUse,false);
 assert.ok(Number(r.candidateBrier)<Number(r.baselineBrier));
});

test('post-kickoff snapshot, reconstruction and replay fail closed',()=>{
 const a=row(1);a.snapshot=lockMultiMarketShadow({fixtureId:a.fixtureId,targetDate:'2026-08-24',createdAt:'2026-08-24T12:00:00Z',modelVersion:'CFI_MULTI_MARKET_V1',payload:a.snapshot.payload});
 const b={...row(2),reconstructed:true};
 const c={...row(3),predictionHistoryReplay:true};
 const r=evaluateLockedOosGate([a,b,c],{minSample:1});
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.some(x=>x.includes('SNAPSHOT_NOT_PREKICKOFF')));
 assert.ok(r.hardFailures.some(x=>x.includes('RECONSTRUCTED_PREDICTION_FORBIDDEN')));
 assert.ok(r.hardFailures.some(x=>x.includes('PREDICTION_HISTORY_REPLAY_FORBIDDEN')));
});

test('tampered fingerprint and same-date evidence are rejected',()=>{
 const a=row(1);a.snapshot={...a.snapshot,payload:{...a.snapshot.payload,probabilities:{home:.7,draw:.15,away:.15}}};
 const b={...row(2),maxEvidenceDate:'2026-08-24'};
 const r=evaluateLockedOosGate([a,b],{minSample:1});
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.some(x=>x.includes('LOCK_FINGERPRINT_INVALID')));
 assert.ok(r.hardFailures.some(x=>x.includes('STRICT_PRIOR_FAILURE')));
});

test('candidate that loses to baseline cannot pass despite sufficient sample',()=>{
 const rows=Array.from({length:30},(_,i)=>row(i,{home:.34,draw:.33,away:.33},{home:.70,draw:.15,away:.15}));
 const r=evaluateLockedOosGate(rows);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.includes('LOCKED_OOS_BRIER_REGRESSION'));
});

test('invalid probability support and duplicate fixture fail closed',()=>{
 const a=row(1);a.snapshot=lockMultiMarketShadow({fixtureId:a.fixtureId,targetDate:'2026-08-24',createdAt:'2026-08-24T10:00:00Z',modelVersion:'CFI_MULTI_MARKET_V1',payload:{market:'FT_1X2',probabilities:{home:.7,draw:.4,away:-.1},baselineProbabilities:a.snapshot.payload.baselineProbabilities}});
 const b=row(1);
 const r=evaluateLockedOosGate([a,b],{minSample:1});
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.some(x=>x.includes('PROBABILITY_VECTOR_INVALID')));
 assert.ok(r.hardFailures.some(x=>x.includes('DUPLICATE_FIXTURE')));
});
