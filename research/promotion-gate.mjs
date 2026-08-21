export const SCORE_WEIGHTS = Object.freeze({
  brier: 25,
  calibration: 15,
  top3: 15,
  ranking: 15,
  tail: 15,
  stability: 10,
  robustness: 5,
});

export const PROMOTION_BANDS = Object.freeze([
  { min: 95, status: 'EXCEPTIONAL' },
  { min: 90, status: 'STRONG_CANDIDATE' },
  { min: 80, status: 'SHADOW_PASS' },
  { min: 70, status: 'RESEARCH' },
  { min: 0, status: 'REJECT' },
]);

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export function assertStrictPrior(row) {
  const target = Date.parse(row.targetTimestamp);
  const evidence = Date.parse(row.maxEvidenceTimestamp);
  if (!Number.isFinite(target) || !Number.isFinite(evidence)) {
    return { pass: false, reason: 'INVALID_TIMESTAMP' };
  }
  if (evidence >= target) return { pass: false, reason: 'TEMPORAL_LEAKAGE' };
  if (row.reconstructed === true) return { pass: false, reason: 'RECONSTRUCTION' };
  if (row.replayedPredictionHistory === true) return { pass: false, reason: 'PREDICTION_HISTORY_REPLAY' };
  return { pass: true, reason: null };
}

export function brierScore(rows, market) {
  const xs = rows.filter(r => Number.isFinite(r?.probabilities?.[market]) && [0,1].includes(r?.actual?.[market]));
  return mean(xs.map(r => (r.probabilities[market] - r.actual[market]) ** 2));
}

export function expectedCalibrationError(rows, market, bins = 10) {
  const xs = rows.filter(r => Number.isFinite(r?.probabilities?.[market]) && [0,1].includes(r?.actual?.[market]));
  if (!xs.length) return NaN;
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const bucket = xs.filter(r => r.probabilities[market] >= lo && (b === bins - 1 ? r.probabilities[market] <= hi : r.probabilities[market] < hi));
    if (!bucket.length) continue;
    const conf = mean(bucket.map(r => r.probabilities[market]));
    const acc = mean(bucket.map(r => r.actual[market]));
    ece += (bucket.length / xs.length) * Math.abs(conf - acc);
  }
  return ece;
}

function rankAuc(rows, market) {
  const xs = rows.filter(r => Number.isFinite(r?.probabilities?.[market]) && [0,1].includes(r?.actual?.[market]));
  const pos = xs.filter(r => r.actual[market] === 1);
  const neg = xs.filter(r => r.actual[market] === 0);
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  let ties = 0;
  for (const p of pos) for (const n of neg) {
    if (p.probabilities[market] > n.probabilities[market]) wins++;
    else if (p.probabilities[market] === n.probabilities[market]) ties++;
  }
  return (wins + 0.5 * ties) / (pos.length * neg.length);
}

function top3Accuracy(rows, key) {
  const xs = rows.filter(r => Array.isArray(r?.[key]) && typeof r?.actualScore?.[key === 'top3HT' ? 'ht' : 'ft'] === 'string');
  if (!xs.length) return NaN;
  return mean(xs.map(r => r[key].includes(r.actualScore[key === 'top3HT' ? 'ht' : 'ft']) ? 1 : 0));
}

function marketSkill(rows, markets) {
  const values = markets.map(m => brierScore(rows, m)).filter(Number.isFinite);
  if (!values.length) return 0;
  return clamp01(1 - mean(values) / 0.25);
}

export function detectCollapse(rows, markets, tolerance = 0.015) {
  if (rows.length < 3) return { collapsed: false, spread: null };
  const perMarket = {};
  let collapsedCount = 0;
  for (const m of markets) {
    const xs = rows.map(r => r?.probabilities?.[m]).filter(Number.isFinite);
    if (xs.length < 3) continue;
    const spread = Math.max(...xs) - Math.min(...xs);
    perMarket[m] = spread;
    if (spread <= tolerance) collapsedCount++;
  }
  return { collapsed: collapsedCount === Object.keys(perMarket).length && collapsedCount > 0, spread: perMarket };
}

export function evaluateRun(rows, options = {}) {
  const markets = options.markets ?? ['threePlusHT','sevenPlusFT','otherHT','otherFT'];
  const strictPriorFailures = rows.map((r, i) => ({ i, ...assertStrictPrior(r) })).filter(x => !x.pass);
  const collapse = detectCollapse(rows, markets, options.collapseTolerance ?? 0.015);
  const hardFailures = [];
  if (strictPriorFailures.length) hardFailures.push('STRICT_PRIOR_FAILURE');
  if (collapse.collapsed) hardFailures.push('CROSS_MATCH_COLLAPSE');
  if (rows.some(r => r.nondeterministic === true)) hardFailures.push('NONDETERMINISM');
  if (rows.some(r => r.directionalFailure === true)) hardFailures.push('HOME_AWAY_DIRECTIONAL_FAILURE');

  const meanBrier = mean(markets.map(m => brierScore(rows, m)).filter(Number.isFinite));
  const meanEce = mean(markets.map(m => expectedCalibrationError(rows, m)).filter(Number.isFinite));
  const auc = mean(markets.map(m => rankAuc(rows, m)).filter(Number.isFinite));
  const top3 = mean([top3Accuracy(rows,'top3HT'), top3Accuracy(rows,'top3FT')].filter(Number.isFinite));
  const tailSkill = marketSkill(rows, markets);

  const stability = clamp01(options.stability ?? 1);
  const robustness = hardFailures.length ? 0 : clamp01(options.robustness ?? 1);
  const components = {
    brier: clamp01(1 - (Number.isFinite(meanBrier) ? meanBrier : 0.25) / 0.25),
    calibration: clamp01(1 - (Number.isFinite(meanEce) ? meanEce : 1)),
    top3: clamp01(Number.isFinite(top3) ? top3 : 0),
    ranking: clamp01((auc - 0.5) / 0.5),
    tail: tailSkill,
    stability,
    robustness,
  };
  const score = Object.entries(SCORE_WEIGHTS).reduce((sum, [k, w]) => sum + components[k] * w, 0);
  const rawStatus = PROMOTION_BANDS.find(b => score >= b.min).status;
  const status = hardFailures.length ? 'FAIL_HARD_GATE' : rawStatus;
  return {
    score: Number(score.toFixed(2)),
    status,
    productionEligible: false,
    shadowEligible: !hardFailures.length && score >= 80,
    components,
    metrics: { meanBrier, meanEce, auc, top3, collapse },
    hardFailures,
    strictPriorFailures,
  };
}

export function compareAblation(baseline, challenger) {
  return {
    baselineScore: baseline.score,
    challengerScore: challenger.score,
    delta: Number((challenger.score - baseline.score).toFixed(2)),
    promotedToShadow: challenger.shadowEligible && challenger.score >= baseline.score,
  };
}
