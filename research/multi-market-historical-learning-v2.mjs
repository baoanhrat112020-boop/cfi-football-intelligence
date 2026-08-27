export const MULTI_MARKET_HISTORICAL_V2 = Object.freeze({
  version: 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1',
  researchOnly: true,
  decisionUse: false,
  strictPrior: true,
  models: Object.freeze(['R0', 'FUTURE_SIX', 'F5', 'F10P']),
  groups: Object.freeze(['CHAMPION', 'SCORELINE', '1X2_HT', '1X2_FT', 'OU_HT', 'OU_FT', 'AH_HT', 'AH_FT', 'COHERENCE']),
  overUnder: Object.freeze({
    ht: Object.freeze([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]),
    ft: Object.freeze([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5]),
  }),
  asianHandicap: Object.freeze([-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
  projectionTolerance: 1e-8,
});

const EPS = 1e-15;
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function poisson(k, lambda) {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return Math.exp(-lambda) * (lambda ** k) / factorial;
}

export function buildIndependentScoreGrid(homeLambda, awayLambda, maxGoals) {
  const rows = [];
  let mass = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      const probability = poisson(home, homeLambda) * poisson(away, awayLambda);
      rows.push({ home, away, total: home + away, probability });
      mass += probability;
    }
  }
  return rows.map(row => ({ ...row, probability: row.probability / Math.max(mass, EPS) }));
}

export const htThresholdGroup = row => Math.max(row.home, row.away) >= 4 ? 2 : row.total >= 3 ? 1 : 0;
export function ftThresholdGroup(row) {
  const sevenPlus = row.total >= 7;
  const otherFt = Math.max(row.home, row.away) >= 5;
  return sevenPlus ? (otherFt ? 3 : 2) : (otherFt ? 1 : 0);
}

function groupMass(grid, classifier, count) {
  const out = Array(count).fill(0);
  for (const row of grid) out[classifier(row)] += row.probability;
  return out;
}

export function htProjectionFactors(grid, p3Ht, pOtherHt) {
  if (pOtherHt > p3Ht + 1e-10) throw new Error('INFEASIBLE_HT_MARGINALS');
  const base = groupMass(grid, htThresholdGroup, 3);
  const target = [1 - p3Ht, p3Ht - pOtherHt, pOtherHt];
  return target.map((value, i) => {
    if (base[i] < EPS && value > 1e-10) throw new Error('ZERO_SUPPORT_HT_GROUP');
    return base[i] < EPS ? 0 : value / base[i];
  });
}

export function ftJointFromOddsRatio(p7Ft, pOtherFt, baseMasses) {
  const [q00, q01, q10, q11] = baseMasses;
  if ([q00, q01, q10, q11].some(x => !(x > 0))) throw new Error('ZERO_SUPPORT_FT_GROUP');
  const lower = Math.max(0, p7Ft + pOtherFt - 1);
  const upper = Math.min(p7Ft, pOtherFt);
  const oddsRatio = (q11 * q00) / (q10 * q01);
  let joint;
  if (Math.abs(oddsRatio - 1) < 1e-12) {
    joint = p7Ft * pOtherFt;
  } else {
    const a = 1 - oddsRatio;
    const b = 1 - p7Ft - pOtherFt + oddsRatio * (p7Ft + pOtherFt);
    const c = -oddsRatio * p7Ft * pOtherFt;
    const discriminant = Math.max(0, b * b - 4 * a * c);
    const root = Math.sqrt(discriminant);
    const candidates = [(-b + root) / (2 * a), (-b - root) / (2 * a)];
    joint = candidates.find(x => x >= lower - 1e-12 && x <= upper + 1e-12);
    if (!Number.isFinite(joint)) joint = clamp(candidates[0], lower, upper);
  }
  return clamp(joint, lower, upper);
}

export function ftProjectionFactors(grid, p7Ft, pOtherFt) {
  const base = groupMass(grid, ftThresholdGroup, 4);
  const joint = ftJointFromOddsRatio(p7Ft, pOtherFt, base);
  const target = [1 - p7Ft - pOtherFt + joint, pOtherFt - joint, p7Ft - joint, joint];
  if (target.some(x => x < -1e-10)) throw new Error('INFEASIBLE_FT_MARGINALS');
  return target.map((value, i) => Math.max(0, value) / base[i]);
}

export function applyGroupProjection(grid, factors, classifier) {
  const projected = grid.map(row => ({ ...row, probability: row.probability * factors[classifier(row)] }));
  const total = projected.reduce((sum, row) => sum + row.probability, 0);
  return projected.map(row => ({ ...row, probability: row.probability / Math.max(total, EPS) }));
}

export function eventMass(grid, event) {
  return grid.reduce((sum, row) => {
    const hit = event === '3+ HT' ? row.total >= 3
      : event === 'Other HT' ? Math.max(row.home, row.away) >= 4
      : event === '7+ FT' ? row.total >= 7
      : event === 'Other FT' ? Math.max(row.home, row.away) >= 5
      : false;
    return sum + (hit ? row.probability : 0);
  }, 0);
}

export function projectChampionMarginals({ htGrid, ftGrid, p3Ht, p7Ft, pOtherHt, pOtherFt }) {
  const ht = applyGroupProjection(htGrid, htProjectionFactors(htGrid, p3Ht, pOtherHt), htThresholdGroup);
  const ft = applyGroupProjection(ftGrid, ftProjectionFactors(ftGrid, p7Ft, pOtherFt), ftThresholdGroup);
  const residuals = [
    Math.abs(eventMass(ht, '3+ HT') - p3Ht),
    Math.abs(eventMass(ht, 'Other HT') - pOtherHt),
    Math.abs(eventMass(ft, '7+ FT') - p7Ft),
    Math.abs(eventMass(ft, 'Other FT') - pOtherFt),
    Math.abs(ht.reduce((s, r) => s + r.probability, 0) - 1),
    Math.abs(ft.reduce((s, r) => s + r.probability, 0) - 1),
  ];
  return { ht, ft, maxAbsError: Math.max(...residuals), coherent: Math.max(...residuals) <= MULTI_MARKET_HISTORICAL_V2.projectionTolerance };
}
