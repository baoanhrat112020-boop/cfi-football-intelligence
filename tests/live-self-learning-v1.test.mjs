import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLiveCandidate, LIVE_SELF_LEARNING_CONTRACT } from '../research/live-self-learning-v1.mjs';

const base={
  meta:{strictPrior:true,futureLeakageCount:0,sameDateLeakageCount:0,deterministic:true,maxDeterminismDelta:0,samples:800,leagues:12,countries:6},
  champion:{brier:.24,logLoss:.68,calibrationError:.05},
  challenger:{brier:.22,logLoss:.65,calibrationError:.04,markets:{'3+ HT':{brierDelta:-.02},'7+ FT':{brierDelta:-.01},'Other HT':{brierDelta:0},'Other FT':{brierDelta:.005}}}
};

test('strong strict-prior challenger becomes shadow eligible but never auto-production',()=>{
  const r=evaluateLiveCandidate(base);
  assert.equal(r.decision,'SHADOW_ELIGIBLE');
  assert.equal(r.canaryEligible,true);
  assert.equal(r.productionMutationAllowed,false);
  assert.equal(r.contract.autoProductionPromotion,false);
});

test('future leakage hard-fails promotion',()=>{
  const r=evaluateLiveCandidate({...base,meta:{...base.meta,futureLeakageCount:1}});
  assert.equal(r.decision,'HOLD');
  assert.ok(r.reasons.includes('TEMPORAL_LEAKAGE'));
});

test('small sample and nondeterminism hard-fail promotion',()=>{
  const r=evaluateLiveCandidate({...base,meta:{...base.meta,samples:50,deterministic:false,maxDeterminismDelta:.001}});
  assert.equal(r.decision,'HOLD');
  assert.ok(r.reasons.includes('INSUFFICIENT_SAMPLE'));
  assert.ok(r.reasons.includes('NON_DETERMINISTIC'));
});

test('single-market regression blocks an otherwise better challenger',()=>{
  const c=structuredClone(base); c.challenger.markets['Other FT'].brierDelta=LIVE_SELF_LEARNING_CONTRACT.maxMarketRegression+.001;
  const r=evaluateLiveCandidate(c);
  assert.equal(r.decision,'HOLD');
  assert.ok(r.reasons.some(x=>x.startsWith('MARKET_REGRESSION:')));
});
