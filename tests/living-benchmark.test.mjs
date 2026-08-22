import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVING_BENCHMARK_VERSION, assertPreRegistration, normalizeLockedPrediction, settleLockedPrediction, deriveActualMarkets, prequentialBrier } from '../research/living-benchmark.mjs';

const base = {
  modelName:'CFI_FUSION', modelVersion:'V1.2', modelFingerprint:'abc123',
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

const verifiedProvenance={
  verified:true,
  sources:[
    {name:'Official result',reference:'fixture:11111111-1111-4111-8111-111111111111'},
    {name:'Independent result provider',reference:'provider-match-abc'},
  ]
};

const settleBase={
  actualHT:'1-0',actualFT:'2-1',
  actualMarkets:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0},
  settledAt:'2026-08-22T16:00:00Z',
  sourceProvenance:verifiedProvenance,
};

test('living benchmark contract is V1.2',()=>{
  assert.equal(LIVING_BENCHMARK_VERSION,'CFI_LIVING_BENCHMARK_V1.2');
});

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

test('lock rejects missing model identity and blank probability coercion',()=>{
  assert.throws(()=>normalizeLockedPrediction({...base,modelName:'   '}),/MODEL_NAME_REQUIRED/);
  assert.throws(()=>normalizeLockedPrediction({...base,modelVersion:null}),/MODEL_VERSION_REQUIRED/);
  assert.throws(()=>normalizeLockedPrediction({...base,modelFingerprint:''}),/MODEL_FINGERPRINT_REQUIRED/);
  assert.throws(()=>normalizeLockedPrediction({...base,probabilities:{...base.probabilities,'7+ FT':''}}),/INVALID_PROBABILITY:7\+ FT/);
  assert.throws(()=>normalizeLockedPrediction({...base,probabilities:{...base.probabilities,'Other FT':null}}),/INVALID_PROBABILITY:Other FT/);
});

test('locked prediction is immutable, traceable and explicitly LOCKED',()=>{
  const p=normalizeLockedPrediction(base);
  assert.equal(p.status,'LOCKED');
  assert.equal(p.productionMutationAllowed,false);
  assert.equal(p.fixtureId,base.fixtureVerification.fixtureId);
  assert.equal(p.sourceSnapshotId,base.sourceSnapshotId);
  assert.equal(p.sourcePredictionHash,base.sourcePredictionHash);
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.probabilities),true);
  assert.equal(Object.isFrozen(p.fixtureVerification),true);
});

test('actual markets are derived from canonical HT/FT scores',()=>{
  assert.deepEqual(deriveActualMarkets('4-0','5-2'),{'3+ HT':1,'7+ FT':1,'Other HT':1,'Other FT':1});
  assert.deepEqual(deriveActualMarkets('1-0','2-1'),{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0});
  assert.throws(()=>deriveActualMarkets('2-1','1-3'),/FT_BELOW_HT_SCORE/);
  assert.throws(()=>deriveActualMarkets('HT 2-1','3-2'),/ACTUAL_HT_SCORE_REQUIRED/);
});

test('settlement rejects contradictory score-market labels',()=>{
  const p=normalizeLockedPrediction(base);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,actualMarkets:{...settleBase.actualMarkets,'3+ HT':1}}),/ACTUAL_MARKET_SCORE_MISMATCH:3\+ HT/);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,actualHT:'4-0',actualFT:'5-2'}),/ACTUAL_MARKET_SCORE_MISMATCH/);
});

test('settlement requires post-kickoff timestamp and verified result provenance',()=>{
  const p=normalizeLockedPrediction(base);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,settledAt:null}),/SETTLED_AT_REQUIRED/);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,settledAt:'2026-08-22T13:00:00Z'}),/SETTLEMENT_NOT_POST_KICKOFF/);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,sourceProvenance:{verified:false,sources:verifiedProvenance.sources}}),/SETTLEMENT_PROVENANCE_NOT_VERIFIED/);
  assert.throws(()=>settleLockedPrediction(p,{...settleBase,sourceProvenance:{verified:true,sources:[]}}),/SETTLEMENT_SOURCES_REQUIRED/);
});

test('settlement is single-use and cannot revise actuals after result is known',()=>{
  const p=normalizeLockedPrediction(base);
  const settled=settleLockedPrediction(p,settleBase);
  assert.equal(settled.status,'SETTLED');
  assert.equal(settled.actualHT,'1-0');
  assert.equal(settled.actualFT,'2-1');
  assert.equal(Object.isFrozen(settled.sourceProvenance),true);
  assert.throws(()=>settleLockedPrediction(settled,{...settleBase,actualFT:'3-1'}),/PREDICTION_ALREADY_SETTLED/);
});

test('prequential brier uses only settled immutable predictions',()=>{
  const a=settleLockedPrediction(normalizeLockedPrediction(base),settleBase);
  const second={
    ...base,
    fixtureVerification:{...base.fixtureVerification,fixtureId:'33333333-3333-4333-8333-333333333333'},
    sourceSnapshotId:'44444444-4444-4444-8444-444444444444',
    sourcePredictionHash:'hash-def',
    probabilities:{'3+ HT':.8,'7+ FT':.1,'Other HT':.05,'Other FT':.1}
  };
  const b=settleLockedPrediction(normalizeLockedPrediction(second),{
    actualHT:'2-1',actualFT:'3-1',
    actualMarkets:{'3+ HT':1,'7+ FT':0,'Other HT':0,'Other FT':0},
    settledAt:'2026-08-22T16:30:00Z',sourceProvenance:verifiedProvenance,
  });
  const m=prequentialBrier([normalizeLockedPrediction({...base,fixtureVerification:{...base.fixtureVerification,fixtureId:'55555555-5555-4555-8555-555555555555'},sourceSnapshotId:'66666666-6666-4666-8666-666666666666'}),a,b]);
  assert.equal(m.n,2);
  assert.ok(m.meanBrier>=0 && m.meanBrier<=1);
});
