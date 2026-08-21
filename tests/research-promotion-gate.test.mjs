import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStrictPrior, evaluateRun, compareAblation } from '../research/promotion-gate.mjs';

const markets = ['threePlusHT','sevenPlusFT','otherHT','otherFT'];
const row = (i, positive, p) => ({
  targetTimestamp: `2026-01-${String(10+i).padStart(2,'0')}T12:00:00Z`,
  maxEvidenceTimestamp: `2026-01-${String(9+i).padStart(2,'0')}T23:00:00Z`,
  probabilities: Object.fromEntries(markets.map((m, j) => [m, Math.max(0.01, Math.min(0.99, p - j*0.03))])),
  actual: Object.fromEntries(markets.map((m, j) => [m, positive ? (j < 2 ? 1 : 0) : (j < 2 ? 0 : 1)])),
  top3HT: positive ? ['1-1','2-1','1-0'] : ['0-0','1-0','0-1'],
  top3FT: positive ? ['2-1','3-1','2-2'] : ['1-1','1-0','0-1'],
  actualScore: { ht: positive ? '1-1' : '0-0', ft: positive ? '2-1' : '1-1' },
});

test('strict-prior accepts evidence strictly before target', () => {
  assert.equal(assertStrictPrior(row(0, true, .8)).pass, true);
});

test('strict-prior rejects evidence at or after target', () => {
  const x = row(0, true, .8);
  x.maxEvidenceTimestamp = x.targetTimestamp;
  assert.deepEqual(assertStrictPrior(x), { pass: false, reason: 'TEMPORAL_LEAKAGE' });
});

test('hard gate overrides a numerically strong run', () => {
  const rows = [row(0,true,.9), row(1,false,.1), row(2,true,.85), row(3,false,.15)];
  rows[0].reconstructed = true;
  const result = evaluateRun(rows);
  assert.equal(result.status, 'FAIL_HARD_GATE');
  assert.equal(result.shadowEligible, false);
  assert.equal(result.productionEligible, false);
  assert.ok(result.hardFailures.includes('STRICT_PRIOR_FAILURE'));
});

test('diverse calibrated challenger can pass shadow gate but never auto-production', () => {
  const rows = [row(0,true,.9), row(1,false,.1), row(2,true,.85), row(3,false,.15), row(4,true,.8), row(5,false,.2)];
  const result = evaluateRun(rows, { stability: .95, robustness: 1 });
  assert.ok(result.score >= 80, `score=${result.score}`);
  assert.equal(result.shadowEligible, true);
  assert.equal(result.productionEligible, false);
});

test('cross-match probability collapse is a hard failure', () => {
  const rows = [row(0,true,.51), row(1,false,.51), row(2,true,.51), row(3,false,.51)];
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
