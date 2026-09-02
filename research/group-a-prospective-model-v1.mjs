import { createHash } from 'node:crypto';
import { buildIndependentScoreGrid, buildMultiMarketFromScoreGrids } from '../src/prediction/multi-market-v1.ts';

export const GROUP_A_PROSPECTIVE_MODEL_V1 = Object.freeze({
  version: 'CFI_GROUP_A_PROSPECTIVE_MODEL_V1',
  stateVersion: 'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',
  trainedThrough: '2026-08-19',
  holdoutStart: '2026-08-20',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  productionEligible: false,
  noReconstruction: true,
  selectedCandidates: Object.freeze([
    'OPPONENT_STRENGTH_ARM_V1',
    'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',
  ]),
  strengthClip: 2,
  confidenceFloor: 0.40,
  minOnlineSamples: 500,
  segmentPriorWeight: 500,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x)));
const finite = x => Number.isFinite(Number(x));
const text = x => String(x ?? '').trim();

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateBase(base = {}) {
  const out = {
    htHome: Number(base.htHome),
    htAway: Number(base.htAway),
    ftHome: Number(base.ftHome),
    ftAway: Number(base.ftAway),
  };
  if (!Object.values(out).every(x => Number.isFinite(x) && x >= 0)) {
    throw new Error('GROUP_A_PROSPECTIVE_BASE_EXPECTED_GOALS_REQUIRED');
  }
  return out;
}

export function effectiveFrozenStrength(row = {}) {
  if (row.strict_prior !== true) throw new Error('GROUP_A_PROSPECTIVE_NON_STRICT_STRENGTH');
  const asOf = text(row.as_of_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf >= GROUP_A_PROSPECTIVE_MODEL_V1.holdoutStart) {
    throw new Error('GROUP_A_PROSPECTIVE_STRENGTH_HOLDOUT_LEAKAGE');
  }
  const confidence = clamp(finite(row.confidence) ? Number(row.confidence) : 0, 0, 1);
  return {
    asOfDate: asOf,
    confidence,
    attack: clamp(finite(row.attack_index) ? Number(row.attack_index) : 0, -GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip, GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip) * confidence,
    defense: clamp(finite(row.defense_index) ? Number(row.defense_index) : 0, -GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip, GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip) * confidence,
    net: clamp(finite(row.net_strength) ? Number(row.net_strength) : 0, -GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip, GROUP_A_PROSPECTIVE_MODEL_V1.strengthClip) * confidence,
    segment: text(row.segment_v2) || 'UNKNOWN',
    competitionKey: text(row.competition_key) || null,
  };
}

function validateLearnerEnvelope(learner, modelName) {
  if (!learner || learner.stateVersion !== GROUP_A_PROSPECTIVE_MODEL_V1.stateVersion) {
    throw new Error(`GROUP_A_PROSPECTIVE_FROZEN_STATE_REQUIRED:${modelName}`);
  }
  if (learner.trainedThrough !== GROUP_A_PROSPECTIVE_MODEL_V1.trainedThrough) {
    throw new Error(`GROUP_A_PROSPECTIVE_TRAINING_BOUNDARY_DRIFT:${modelName}`);
  }
}

function dot(beta, x, label) {
  if (!Array.isArray(beta) || beta.length !== x.length || beta.some(v => !finite(v))) {
    throw new Error(`GROUP_A_PROSPECTIVE_INVALID_RIDGE_STATE:${label}`);
  }
  return beta.reduce((sum, value, i) => sum + Number(value) * x[i], 0);
}

function residual(row) {
  return {
    n: Math.max(0, Math.floor(Number(row?.n) || 0)),
    h: finite(row?.h) ? Number(row.h) : 0,
    a: finite(row?.a) ? Number(row.a) : 0,
  };
}

function output(modelName, base, adjusted, metadata = {}) {
  const htGrid = buildIndependentScoreGrid(adjusted.htHome, adjusted.htAway, 10);
  const ftGrid = buildIndependentScoreGrid(adjusted.ftHome, adjusted.ftAway, 14);
  const multiMarket = buildMultiMarketFromScoreGrids({ ht: htGrid, ft: ftGrid });
  if (multiMarket?.consistencyGuard?.status !== 'PASS') {
    throw new Error(`GROUP_A_PROSPECTIVE_COHERENCE_FAIL:${modelName}`);
  }
  const prediction = {
    contract: GROUP_A_PROSPECTIVE_MODEL_V1.version,
    model: modelName,
    modelVersion: `${modelName}+FROZEN_2026_08_19`,
    stateVersion: GROUP_A_PROSPECTIVE_MODEL_V1.stateVersion,
    status: 'SHADOW_RESEARCH',
    researchOnly: true,
    decisionUse: false,
    productionEligible: false,
    noReconstruction: true,
    trainedThrough: GROUP_A_PROSPECTIVE_MODEL_V1.trainedThrough,
    baselineExpectedGoals: base,
    expectedGoals: adjusted,
    scoreline: { ht: htGrid, ft: ftGrid },
    multiMarket,
    metadata,
  };
  return {
    status: 'READY',
    modelName,
    prediction,
    predictionHash: stableHash(prediction),
    researchOnly: true,
    decisionUse: false,
    productionMutationAllowed: false,
    productionEligible: false,
  };
}

export function applyOpponentStrengthArm({ baseExpectedGoals, homeStrength, awayStrength, learner } = {}) {
  const modelName = 'OPPONENT_STRENGTH_ARM_V1';
  validateLearnerEnvelope(learner, modelName);
  const base = validateBase(baseExpectedGoals);
  const home = effectiveFrozenStrength(homeStrength);
  const away = effectiveFrozenStrength(awayStrength);
  if (Math.min(home.confidence, away.confidence) < GROUP_A_PROSPECTIVE_MODEL_V1.confidenceFloor) {
    return { status: 'ABSTAIN', reason: 'GROUP_A_PROSPECTIVE_STRENGTH_CONFIDENCE_FLOOR', modelName, researchOnly: true, decisionUse: false, productionMutationAllowed: false, productionEligible: false };
  }
  if (Number(learner?.ht?.n ?? 0) < GROUP_A_PROSPECTIVE_MODEL_V1.minOnlineSamples || Number(learner?.ft?.n ?? 0) < GROUP_A_PROSPECTIVE_MODEL_V1.minOnlineSamples) {
    throw new Error('GROUP_A_PROSPECTIVE_OPPONENT_MIN_ONLINE_STATE_REQUIRED');
  }
  const xHome = [1, home.attack, away.defense, home.net - away.net];
  const xAway = [1, away.attack, home.defense, away.net - home.net];
  const delta = {
    htHome: clamp(dot(learner.ht.beta, xHome, 'HT_HOME'), -0.25, 0.25),
    htAway: clamp(dot(learner.ht.beta, xAway, 'HT_AWAY'), -0.25, 0.25),
    ftHome: clamp(dot(learner.ft.beta, xHome, 'FT_HOME'), -0.50, 0.50),
    ftAway: clamp(dot(learner.ft.beta, xAway, 'FT_AWAY'), -0.50, 0.50),
  };
  const adjusted = {
    htHome: Math.max(0.01, base.htHome + delta.htHome),
    htAway: Math.max(0.01, base.htAway + delta.htAway),
    ftHome: Math.max(0.02, base.ftHome + delta.ftHome),
    ftAway: Math.max(0.02, base.ftAway + delta.ftAway),
  };
  return output(modelName, base, adjusted, {
    featurePolicy: 'STRICT_PRIOR_ATTACK_DEFENSE_NET_STRENGTH_DATE_BATCHED_RIDGE',
    strengthAsOf: { home: home.asOfDate, away: away.asOfDate },
    confidence: { home: home.confidence, away: away.confidence },
    delta,
  });
}

export function applyHierarchicalLeagueSegmentCalibration({ baseExpectedGoals, competitionSegment, learner } = {}) {
  const modelName = 'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1';
  validateLearnerEnvelope(learner, modelName);
  const base = validateBase(baseExpectedGoals);
  const segment = text(competitionSegment) || 'UNKNOWN';
  const gh = residual(learner.globalHt);
  const gf = residual(learner.globalFt);
  if (gh.n <= 0 || gf.n <= 0) throw new Error('GROUP_A_PROSPECTIVE_HIERARCHICAL_GLOBAL_STATE_REQUIRED');
  const sh = residual(learner.segmentHt?.[segment]);
  const sf = residual(learner.segmentFt?.[segment]);
  const priorWeight = Number(learner.segmentPriorWeight ?? GROUP_A_PROSPECTIVE_MODEL_V1.segmentPriorWeight);
  if (!Number.isFinite(priorWeight) || priorWeight <= 0) throw new Error('GROUP_A_PROSPECTIVE_SEGMENT_PRIOR_INVALID');
  const wh = sh.n / (sh.n + priorWeight);
  const wf = sf.n / (sf.n + priorWeight);
  const delta = {
    htHome: clamp((1 - wh) * gh.h + wh * sh.h, -0.20, 0.20),
    htAway: clamp((1 - wh) * gh.a + wh * sh.a, -0.20, 0.20),
    ftHome: clamp((1 - wf) * gf.h + wf * sf.h, -0.40, 0.40),
    ftAway: clamp((1 - wf) * gf.a + wf * sf.a, -0.40, 0.40),
  };
  const adjusted = {
    htHome: Math.max(0.01, base.htHome + delta.htHome),
    htAway: Math.max(0.01, base.htAway + delta.htAway),
    ftHome: Math.max(0.02, base.ftHome + delta.ftHome),
    ftAway: Math.max(0.02, base.ftAway + delta.ftAway),
  };
  return output(modelName, base, adjusted, {
    featurePolicy: 'PARTIAL_POOLING_SEGMENT_RESIDUAL_INTENSITY',
    competitionSegment: segment,
    segmentSupport: { ht: sh.n, ft: sf.n },
    segmentPriorWeight: priorWeight,
    delta,
  });
}

export function applyFrozenGroupACandidate(args = {}) {
  if (args.modelName === 'OPPONENT_STRENGTH_ARM_V1') return applyOpponentStrengthArm(args);
  if (args.modelName === 'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1') return applyHierarchicalLeagueSegmentCalibration(args);
  throw new Error(`GROUP_A_PROSPECTIVE_CANDIDATE_NOT_SELECTED:${text(args.modelName)}`);
}
