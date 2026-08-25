import test from 'node:test';
import assert from 'node:assert/strict';
import {K049_CONTRACT,buildMaturedTrajectoryLedger,buildTrajectoryPairs,rankTrajectoryRetrieval,evaluateTrajectoryRetrievalWalkForward} from '../research/agent-trajectory-retrieval.mjs';

const mk=(i,{date=`2026-07-${String(i+1).padStart(2,'0')}`,p=.2+(i%5)*.1,y=i%2,steps=['SEARCH','READ','PREDICT']}={})=>({fixture_id:`f${i}`,target:'3PLUS_HT',target_date:date,prediction_created_at:`${date}T08:00:00Z`,kickoff_at:`${date}T12:00:00Z`,settled_at:`${date}T15:00:00Z`,probability:p,outcome:y,trajectory:steps,synthetic:false,reconstructed:false});

test('K049 contract is research-only and R0 immutable',()=>{assert.equal(K049_CONTRACT.researchOnly,true);assert.equal(K049_CONTRACT.decisionUse,false);assert.equal(K049_CONTRACT.productionEligible,false);assert.equal(K049_CONTRACT.baselineLock,'R0_IMMUTABLE');});

test('K049 builds only matured strict-prior trajectory artifacts deterministically',()=>{
 const rows=Array.from({length:35},(_,i)=>mk(i,{date:`2026-${i<20?'06':'07'}-${String((i%20)+1).padStart(2,'0')}`,steps:i%2?['SEARCH','READ','PREDICT']:['SEARCH','H2H','READ','PREDICT']}));
 const ledger=buildMaturedTrajectoryLedger(rows);assert.equal(ledger.length,35);
 const pairs=buildTrajectoryPairs({ledger,target_date:'2026-08-01',minPrior:30});assert.equal(pairs.strictPrior,true);assert.ok(pairs.pairs.length>0);
 const a=rankTrajectoryRetrieval({ledger,query:{trajectory:['SEARCH','READ','PREDICT']},target_date:'2026-08-01',k:5});
 const b=rankTrajectoryRetrieval({ledger:[...ledger].reverse(),query:{trajectory:['SEARCH','READ','PREDICT']},target_date:'2026-08-01',k:5});
 assert.deepEqual(a.ranked,b.ranked);assert.equal(a.productionEligible,false);
});

test('K049 walk-forward fails closed on small sample and evaluates real matured rows',()=>{
 const rows=Array.from({length:40},(_,i)=>mk(i,{date:`2026-${i<20?'06':'07'}-${String((i%20)+1).padStart(2,'0')}`}));
 const r=evaluateTrajectoryRetrievalWalkForward(rows,{minSample:30});assert.ok(['READY','BLOCKED'].includes(r.status));assert.equal(r.strictPrior,true);assert.ok(Number.isFinite(r.deltaBrier));
 const small=evaluateTrajectoryRetrievalWalkForward(rows.slice(0,4),{minSample:30});assert.equal(small.status,'BLOCKED');assert.deepEqual(small.hardFailures,['INSUFFICIENT_WALK_FORWARD_RETRIEVAL_SAMPLE']);
});

test('K049 rejects synthetic, post-kickoff, unmatured and duplicate rows',()=>{
 assert.throws(()=>buildMaturedTrajectoryLedger([{...mk(1),synthetic:true}]),/REAL_TRAJECTORY_ROWS_REQUIRED/);
 assert.throws(()=>buildMaturedTrajectoryLedger([{...mk(1),prediction_created_at:mk(1).kickoff_at}]),/PREDICTION_MUST_PRECEDE_KICKOFF/);
 assert.throws(()=>buildMaturedTrajectoryLedger([{...mk(1),settled_at:mk(1).kickoff_at}]),/OUTCOME_MUST_MATURE_AFTER_KICKOFF/);
 assert.throws(()=>buildMaturedTrajectoryLedger([mk(1),mk(1)]),/DUPLICATE_TRAJECTORY_ROW/);
});
