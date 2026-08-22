import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreRegistration, normalizeLockedPrediction, settleLockedPrediction, prequentialBrier } from '../research/living-benchmark.mjs';

const base = {
  modelName:'CFI_FUSION', modelVersion:'V1.1', modelFingerprint:'abc123',
  homeTeam:'Derby County', awayTeam:'Cardiff City',
  targetDate:'2026-08-22', maxEvidenceDate:'2026-08-21',
  lockedAt:'2026-08-22T06:30:00Z', kickoffAt:'2026-08-22T14:00:00Z',
  fixtureVerification:{
    fixtureId:'11111111-1111-4111-8111-111111111111', verificationStatus:'VERIFIED',
    homeTeam:'Derby County', awayTeam:'Cardiff City', targetDate:'2026-08-22', kickoffAt:'2026-08-22T14:00:00Z',
    sourceName:'Derby County official', sourceUrl:'https://example.test/fixture'
  },
  sourceSnapshotId:'22222222-2222-4222-8222-222222222222',
  sourcePredictionHash:'hash-abc', sourceSnapshotCreatedAt:'2026-08-21T08:00:00Z',
  sourceSnapshotStatus:'DATA_READY', sourceSnapshotStrictPrior:true,
  sourceSnapshotTargetDate:'2026-08-22', sourceSnapshotHomeTeam:'Derby County', sourceSnapshotAwayTeam:'Cardiff City',
  probabilities:{'3+ HT':.2,'7+ FT':.04,'Other HT':.01,'Other FT':.05},
  top3HT:['1-0','1-1','0-1'], top3FT:['2-1','1-1','2-0']
};

test('pre-registration rejects same-date evidence, missing kickoff and late lock',()=>{
  assert.throws(()=>assertPreRegistration({...base,maxEvidenceDate:'2026-08-22'}),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>assertPreRegistration({...base,kickoffAt:null}),/KICKOFF_AT_REQUIRED/);
  assert.throws(()=>assertPreRegistration({...base,lockedAt:'2026-08-22T14:00:00Z'}),/PREDICTION_NOT_PREMATCH/);
});

test('living lock requires verified fixture with matching identity/date/kickoff',()=>{
  assert.throws(()=>normalizeLockedPrediction({...base,fixtureVerification:{...base.fixtureVerification,verificationStatus:'VOID'}}),/FIXTURE_NOT_VERIFIED/);
  assert.throws(()=>normalizeLockedPrediction({...base,fixtureVerification:{...base.fixtureVerification,awayTeam:'Plymouth'}}),/FIXTURE_IDENTITY_MISMATCH/);
  assert.throws(()=>normalizeLockedPrediction({...base,fixtureVerification:{...base.fixtureVerification,targetDate:'2026-08-23'}}),/FIXTURE_TARGET_DATE_MISMATCH/);
  assert.throws(()=>normalizeLockedPrediction({...base,fixtureVerification:{...base.fixtureVerification,kickoffAt:'2026-08-22T15:00:00Z'}}),/FIXTURE_KICKOFF_MISMATCH/);
});

test('source snapshot must be ready, strict-prior, same fixture and created before lock/kickoff',()=>{
  assert.throws(()=>normalizeLockedPrediction({...base,sourceSnapshotStatus:'INSUFFICIENT_DATA'}),/SOURCE_SNAPSHOT_NOT_READY/);
  assert.throws(()=>normalizeLockedPrediction({...base,sourceSnapshotStrictPrior:false}),/SOURCE_SNAPSHOT_STRICT_PRIOR_REQUIRED/);
  assert.throws(()=>normalizeLockedPrediction({...base,sourceSnapshotAwayTeam:'Plymouth'}),/SOURCE_SNAPSHOT_IDENTITY_MISMATCH/);
  assert.throws(()=>normalizeLockedPrediction({...base,sourceSnapshotTargetDate:'2026-08-23'}),/SOURCE_SNAPSHOT_TARGET_DATE_MISMATCH/);
  assert.throws(()=>normalizeLockedPrediction({...base,sourceSnapshotCreatedAt:'2026-08-22T07:00:00Z'}),/SOURCE_SNAPSHOT_AFTER_LOCK/);
  assert.throws(()=>normalizeLockedPrediction({...base,lockedAt:'2026-08-22T13:59:00Z',sourceSnapshotCreatedAt:'2026-08-22T14:00:00Z'}),/SOURCE_SNAPSHOT_NOT_PREMATCH/);
});

test('locked prediction is immutable, traceable and research-only',()=>{
  const p=normalizeLockedPrediction(base);
  assert.equal(p.productionMutationAllowed,false);
  assert.equal(p.fixtureId,base.fixtureVerification.fixtureId);
  assert.equal(p.sourceSnapshotId,base.sourceSnapshotId);
  assert.equal(p.sourcePredictionHash,base.sourcePredictionHash);
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.probabilities),true);
  assert.equal(Object.isFrozen(p.fixtureVerification),true);
});

test('settlement requires binary actuals for all markets',()=>{
  const p=normalizeLockedPrediction(base);
  assert.throws(()=>settleLockedPrediction(p,{actualMarkets:{'3+ HT':1}}),/INVALID_ACTUAL/);
  const s=settleLockedPrediction(p,{actualHT:'1-0',actualFT:'2-1',actualMarkets:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0},settledAt:'2026-08-22T16:00:00Z',sourceProvenance:{provider:'verified'}});
  assert.equal(s.status,'SETTLED');
});

test('prequential brier uses only settled immutable predictions',()=>{
  const a=settleLockedPrediction(normalizeLockedPrediction(base),{actualMarkets:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0}});
  const second={
    ...base,
    fixtureVerification:{...base.fixtureVerification,fixtureId:'33333333-3333-4333-8333-333333333333'},
    sourceSnapshotId:'44444444-4444-4444-8444-444444444444',
    sourcePredictionHash:'hash-def',
    probabilities:{'3+ HT':.8,'7+ FT':.1,'Other HT':.05,'Other FT':.1}
  };
  const b=settleLockedPrediction(normalizeLockedPrediction(second),{actualMarkets:{'3+ HT':1,'7+ FT':0,'Other HT':0,'Other FT':0}});
  const m=prequentialBrier([a,b]);
  assert.equal(m.n,2);
  assert.ok(m.meanBrier>=0 && m.meanBrier<=1);
});
