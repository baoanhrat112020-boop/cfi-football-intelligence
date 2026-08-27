import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTI_MARKET_HISTORICAL_V2,
  buildIndependentScoreGrid,
  projectChampionMarginals,
  eventMass,
  ftJointFromOddsRatio,
} from '../research/multi-market-historical-learning-v2.mjs';

test('V2 contract covers full Multi-Market evaluation groups', () => {
  for (const group of ['CHAMPION','SCORELINE','1X2_HT','1X2_FT','OU_HT','OU_FT','AH_HT','AH_FT','COHERENCE']) {
    assert.ok(MULTI_MARKET_HISTORICAL_V2.groups.includes(group));
  }
  assert.equal(MULTI_MARKET_HISTORICAL_V2.strictPrior, true);
  assert.equal(MULTI_MARKET_HISTORICAL_V2.decisionUse, false);
  assert.deepEqual(MULTI_MARKET_HISTORICAL_V2.models, ['R0','FUTURE_SIX','F5','F10P']);
});

test('closed-form projection preserves all four Champion marginals to machine precision', () => {
  const htGrid = buildIndependentScoreGrid(0.92, 0.71, 10);
  const ftGrid = buildIndependentScoreGrid(1.64, 1.21, 14);
  const target = { p3Ht: 0.1843, pOtherHt: 0.0317, p7Ft: 0.0432, pOtherFt: 0.0691 };
  const out = projectChampionMarginals({ htGrid, ftGrid, ...target });
  assert.equal(out.coherent, true);
  assert.ok(out.maxAbsError < 1e-12);
  assert.ok(Math.abs(eventMass(out.ht, '3+ HT') - target.p3Ht) < 1e-12);
  assert.ok(Math.abs(eventMass(out.ht, 'Other HT') - target.pOtherHt) < 1e-12);
  assert.ok(Math.abs(eventMass(out.ft, '7+ FT') - target.p7Ft) < 1e-12);
  assert.ok(Math.abs(eventMass(out.ft, 'Other FT') - target.pOtherFt) < 1e-12);
});

test('FT 2x2 solution respects Frechet bounds under strong dependence', () => {
  const q = [0.82, 0.04, 0.09, 0.05];
  const p7 = 0.18;
  const pOther = 0.13;
  const joint = ftJointFromOddsRatio(p7, pOther, q);
  assert.ok(joint >= Math.max(0, p7 + pOther - 1) - 1e-12);
  assert.ok(joint <= Math.min(p7, pOther) + 1e-12);
});

test('HT projection fails closed on impossible Other HT > 3+ HT', () => {
  const htGrid = buildIndependentScoreGrid(0.8, 0.7, 10);
  const ftGrid = buildIndependentScoreGrid(1.4, 1.2, 14);
  assert.throws(() => projectChampionMarginals({
    htGrid, ftGrid, p3Ht: 0.05, pOtherHt: 0.08, p7Ft: 0.03, pOtherFt: 0.04,
  }), /INFEASIBLE_HT_MARGINALS/);
});
