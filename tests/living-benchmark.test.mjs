import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreRegistration, normalizeLockedPrediction, settleLockedPrediction, prequentialBrier } from '../research/living-benchmark.mjs';

const base = {
  modelName:'CFI_FUSION', modelVersion:'V1.1', modelFingerprint:'abc123', fixtureId:'fixture-1',
  targetDate:'2026-08-23', maxEvidenceDate:'2026-08-22',
  lockedAt:'2026-08-22T10:00:00Z', kickoffAt:'2026-08-23T12:00:00Z',
  probabilities:{'3+ HT':.2,'7+ FT':.04,'Other HT':.01,'Other FT':.05},
  top3HT:['1-0','1-1','0-1'], top3FT:['2-1','1-1','2-0']
};

test('pre-registration rejects same-date evidence and late lock',()=>{
  assert.throws(()=>assertPreRegistration({...base,maxEvidenceDate:'2026-08-23'}),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>assertPreRegistration({...base,lockedAt:'2026-08-23T12:00:00Z'}),/PREDICTION_NOT_PREMATCH/);
});

test('locked prediction is immutable and research-only',()=>{
  const p=normalizeLockedPrediction(base);
  assert.equal(p.productionMutationAllowed,false);
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.probabilities),true);
});

test('settlement requires binary actuals for all markets',()=>{
  const p=normalizeLockedPrediction(base);
  assert.throws(()=>settleLockedPrediction(p,{actualMarkets:{'3+ HT':1}}),/INVALID_ACTUAL/);
  const s=settleLockedPrediction(p,{actualHT:'1-0',actualFT:'2-1',actualMarkets:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0},settledAt:'2026-08-23T14:00:00Z',sourceProvenance:{provider:'verified'}});
  assert.equal(s.status,'SETTLED');
});

test('prequential brier uses only settled immutable predictions',()=>{
  const a=settleLockedPrediction(normalizeLockedPrediction(base),{actualMarkets:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0}});
  const b=settleLockedPrediction(normalizeLockedPrediction({...base,fixtureId:'fixture-2',probabilities:{'3+ HT':.8,'7+ FT':.1,'Other HT':.05,'Other FT':.1}}),{actualMarkets:{'3+ HT':1,'7+ FT':0,'Other HT':0,'Other FT':0}});
  const m=prequentialBrier([a,b]);
  assert.equal(m.n,2);
  assert.ok(m.meanBrier>=0 && m.meanBrier<=1);
});
