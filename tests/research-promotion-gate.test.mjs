import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStrictPrior, evaluateRun, compareAblation, DEFAULT_MIN_PROMOTION_SAMPLES } from '../research/promotion-gate.mjs';

const markets = ['threePlusHT','sevenPlusFT','otherHT','otherFT'];
const row = (i, positive, p) => {
  const target = new Date(Date.UTC(2026,0,10+i,12));
  const evidence = new Date(target.getTime()-13*60*60*1000);
  return {
    targetTimestamp: target.toISOString(),
    maxEvidenceTimestamp: evidence.toISOString(),
    probabilities: Object.fromEntries(markets.map((m, j) => [m, Math.max(0.01, Math.min(0.99, p - j*0.03))])),
    actual: Object.fromEntries(markets.map(m => [m, positive ? 1 : 0])),
    top3HT: positive ? ['1-1','2-1','1-0'] : ['0-0','1-0','0-1'],
    top3FT: positive ? ['2-1','3-1','2-2'] : ['1-1','1-0','0-1'],
    actualScore: { ht: positive ? '1-1' : '0-0', ft: positive ? '2-1' : '1-1' },
  };
};
const strongRows=(n=DEFAULT_MIN_PROMOTION_SAMPLES)=>Array.from({length:n},(_,i)=>row(i,i%2===0,i%2===0?.9:.1));

test('strict-prior accepts evidence strictly before target', () => {
  assert.equal(assertStrictPrior(row(0, true, .8)).pass, true);
});

test('strict-prior rejects evidence at or after target', () => {
  const x = row(0, true, .8);
  x.maxEvidenceTimestamp = x.targetTimestamp;
  assert.deepEqual(assertStrictPrior(x), { pass: false, reason: 'TEMPORAL_LEAKAGE' });
});

test('hard gate overrides a numerically strong run', () => {
  const rows = strongRows();
  rows[0].reconstructed = true;
  const result = evaluateRun(rows);
  assert.equal(result.status, 'FAIL_HARD_GATE');
  assert.equal(result.shadowEligible, false);
  assert.equal(result.productionEligible, false);
  assert.ok(result.hardFailures.includes('STRICT_PRIOR_FAILURE'));
});

test('default promotion gate cannot be passed by a tiny perfect sample', () => {
  const result=evaluateRun(strongRows(6),{stability:1,robustness:1});
  assert.equal(result.status,'FAIL_HARD_GATE');
  assert.equal(result.shadowEligible,false);
  assert.ok(result.hardFailures.includes('INSUFFICIENT_SAMPLE'));
  assert.equal(result.metrics.minSamples,DEFAULT_MIN_PROMOTION_SAMPLES);
  const cannotLower=evaluateRun(strongRows(6),{minSamples:1,stability:1,robustness:1});
  assert.ok(cannotLower.hardFailures.includes('INSUFFICIENT_SAMPLE'));
});

test('diverse calibrated challenger can pass shadow gate with sufficient complete support but never auto-production', () => {
  const result = evaluateRun(strongRows(), { stability: .95, robustness: 1 });
  assert.ok(result.score >= 80, `score=${result.score}`);
  assert.equal(result.shadowEligible, true);
  assert.equal(result.productionEligible, false);
  assert.equal(result.metrics.marketSupport.threePlusHT,DEFAULT_MIN_PROMOTION_SAMPLES);
  assert.equal(result.metrics.top3Support.ht,DEFAULT_MIN_PROMOTION_SAMPLES);
  assert.equal(result.metrics.top3Support.ft,DEFAULT_MIN_PROMOTION_SAMPLES);
});

test('out-of-range probability is a hard failure even when Brier would look artificially good',()=>{
  const rows=strongRows();
  rows[0].probabilities.threePlusHT=-.01;
  rows[0].actual.threePlusHT=0;
  const result=evaluateRun(rows,{stability:1,robustness:1});
  assert.equal(result.status,'FAIL_HARD_GATE');
  assert.ok(result.hardFailures.includes('INVALID_MARKET_PROBABILITY_OR_ACTUAL'));
  assert.ok(result.hardFailures.includes('INSUFFICIENT_MARKET_SUPPORT'));
  assert.deepEqual(result.invalidMarketRows[0],{i:0,markets:['threePlusHT']});
});

test('missing Top-3 support cannot still score into shadow on the remaining 85 points',()=>{
  const rows=strongRows();
  rows[0].top3HT=[];
  const result=evaluateRun(rows,{stability:1,robustness:1});
  assert.equal(result.status,'FAIL_HARD_GATE');
  assert.ok(result.hardFailures.includes('INSUFFICIENT_TOP3_SUPPORT'));
  assert.equal(result.metrics.top3Support.ht,DEFAULT_MIN_PROMOTION_SAMPLES-1);
});

test('cross-match probability collapse is a hard failure', () => {
  const rows = strongRows();
  for (const r of rows) for (const m of markets) r.probabilities[m] = .51;
  const result = evaluateRun(rows);
  assert.equal(result.status, 'FAIL_HARD_GATE');
  assert.ok(result.hardFailures.includes('CROSS_MATCH_COLLAPSE'));
});

test('ablation reports delta and only promotes non-regressing shadow challenger', () => {
  const baseline = { score: 78, shadowEligible: false };
  const challenger = { score: 84, shadowEligible: true };
  assert.deepEqual(compareAblation(baseline, challenger), {
    baselineScore: 78,
    challengerScore: 84,
    delta: 6,
    promotedToShadow: true,
  });
});
