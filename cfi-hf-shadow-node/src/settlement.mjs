import { verifyLockedShadow } from '../../src/prediction/multi-market-live-shadow.ts';
import { MARKET_CODES } from '../../src/prediction/final-engine.ts';
import { shadowStamp } from './contracts.mjs';

const EPS = 1e-12;
const clampProbability = (value) => Math.max(EPS, Math.min(1 - EPS, Number(value)));
const brier = (p, y) => (p - y) ** 2;
const logLoss = (p, y) => -(y * Math.log(clampProbability(p)) + (1 - y) * Math.log(1 - clampProbability(p)));

function scorePair(value, label) {
  const home = Number(value?.home ?? value?.home_goals ?? value?.homeGoals);
  const away = Number(value?.away ?? value?.away_goals ?? value?.awayGoals);
  if (![home, away].every((x) => Number.isSafeInteger(x) && x >= 0)) throw new Error(`${label}_SCORE_INVALID`);
  return { home, away };
}

function actualLabels(ht, ft) {
  return {
    '3+ HT': ht.home + ht.away >= 3 ? 1 : 0,
    '7+ FT': ft.home + ft.away >= 7 ? 1 : 0,
    'Other HT': ht.home >= 4 || ht.away >= 4 ? 1 : 0,
    'Other FT': ft.home >= 5 || ft.away >= 5 ? 1 : 0,
  };
}

function scoreText(pair) { return `${pair.home}-${pair.away}`; }

export function settleLockedShadow({ lockedShadow, result, nowMs = Date.now() }) {
  if (!lockedShadow || !verifyLockedShadow(lockedShadow)) throw new Error('LOCKED_SHADOW_FINGERPRINT_INVALID');
  const payload = lockedShadow.payload;
  if (payload?.shadow_only !== true || payload?.production_mutation !== false) throw new Error('LOCKED_SHADOW_SAFETY_FLAGS_INVALID');
  if (payload?.strict_prior?.verified !== true) throw new Error('LOCKED_SHADOW_STRICT_PRIOR_NOT_VERIFIED');

  const kickoffMs = Date.parse(String(payload?.fixture?.kickoff_at ?? ''));
  const predictionMs = Date.parse(String(payload?.prediction_timestamp ?? lockedShadow.createdAt ?? ''));
  const verifiedAtMs = Date.parse(String(result?.verified_at ?? result?.verifiedAt ?? ''));
  if (!Number.isFinite(kickoffMs)) throw new Error('SETTLEMENT_KICKOFF_REQUIRED');
  if (!Number.isFinite(predictionMs) || predictionMs >= kickoffMs) throw new Error('LOCKED_SHADOW_NOT_PREKICKOFF');
  if (!Number.isFinite(nowMs) || nowMs < kickoffMs) throw new Error('SETTLEMENT_BEFORE_KICKOFF_FORBIDDEN');
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs < kickoffMs || verifiedAtMs > nowMs) throw new Error('SETTLEMENT_VERIFICATION_TIME_INVALID');

  const ht = scorePair(result?.ht, 'HT');
  const ft = scorePair(result?.ft, 'FT');
  if (ht.home > ft.home || ht.away > ft.away) throw new Error('SETTLEMENT_SCORE_MONOTONICITY_INVALID');
  const labels = actualLabels(ht, ft);
  const thresholdMetrics = {};

  for (const market of MARKET_CODES) {
    const probability = Number(payload?.markets?.[market]?.final);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`SETTLEMENT_PROBABILITY_INVALID:${market}`);
    const outcome = labels[market];
    thresholdMetrics[market] = {
      probability,
      actual: outcome,
      hit_at_0_5: (probability >= 0.5 ? 1 : 0) === outcome,
      brier: brier(probability, outcome),
      log_loss: logLoss(probability, outcome),
    };
  }

  const predictedHt = String(payload?.primary_targets?.scorelineTargets?.['Top-1 HT']?.final?.score ?? '');
  const predictedFt = String(payload?.primary_targets?.scorelineTargets?.['Top-1 FT']?.final?.score ?? '');
  if (!/^\d+-\d+$/.test(predictedHt) || !/^\d+-\d+$/.test(predictedFt)) throw new Error('SETTLEMENT_TOP1_PREDICTION_MISSING');

  return shadowStamp({
    contract: 'CFI_HF_SHADOW_SETTLEMENT_V1',
    fixture_id: lockedShadow.fixtureId,
    target_date: lockedShadow.targetDate,
    prediction_fingerprint: lockedShadow.fingerprint,
    prediction_timestamp: new Date(predictionMs).toISOString(),
    kickoff_at: new Date(kickoffMs).toISOString(),
    result_verified_at: new Date(verifiedAtMs).toISOString(),
    actual: { ht, ft, labels },
    threshold_metrics: thresholdMetrics,
    exact_score_metrics: {
      'Top-1 HT': { predicted: predictedHt, actual: scoreText(ht), hit: predictedHt === scoreText(ht) },
      'Top-1 FT': { predicted: predictedFt, actual: scoreText(ft), hit: predictedFt === scoreText(ft) },
    },
    strict_prior: payload.strict_prior,
    canonical_production_write: false,
    canonical_settlement_write: false,
    promotion_effect: 'NONE',
  });
}
