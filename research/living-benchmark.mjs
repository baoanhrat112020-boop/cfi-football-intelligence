import { assertVerifiedFixture, assertSnapshotSource } from './living-fixture-verification.mjs';

export const LIVING_BENCHMARK_VERSION = 'CFI_LIVING_BENCHMARK_V1.2';
const MARKETS = Object.freeze(['3+ HT','7+ FT','Other HT','Other FT']);

export function assertPreRegistration({ targetDate, maxEvidenceDate, lockedAt, kickoffAt }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate ?? ''))) throw new Error('TARGET_DATE_REQUIRED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(maxEvidenceDate ?? ''))) throw new Error('MAX_EVIDENCE_DATE_REQUIRED');
  if (String(maxEvidenceDate) >= String(targetDate)) throw new Error('STRICT_PRIOR_FAILURE');
  const locked = Date.parse(String(lockedAt ?? ''));
  if (!Number.isFinite(locked)) throw new Error('LOCKED_AT_REQUIRED');
  const kickoff = Date.parse(String(kickoffAt ?? ''));
  if (!Number.isFinite(kickoff)) throw new Error('KICKOFF_AT_REQUIRED');
  if (locked >= kickoff) throw new Error('PREDICTION_NOT_PREMATCH');
  return true;
}

function requiredText(value, error) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(error);
  return text;
}

function requiredProbability(probabilities, market) {
  const raw = probabilities?.[market];
  if (raw === null || raw === undefined || raw === '') throw new Error(`INVALID_PROBABILITY:${market}`);
  const p = Number(raw);
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`INVALID_PROBABILITY:${market}`);
  return p;
}

function parseScore(value, label) {
  const match = String(value ?? '').trim().match(/^(\d+)-(\d+)$/);
  if (!match) throw new Error(`${label}_SCORE_REQUIRED`);
  const home = Number(match[1]), away = Number(match[2]);
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away)) throw new Error(`${label}_SCORE_INVALID`);
  return { home, away, score: `${home}-${away}` };
}

export function deriveActualMarkets(actualHT, actualFT) {
  const ht = parseScore(actualHT, 'ACTUAL_HT');
  const ft = parseScore(actualFT, 'ACTUAL_FT');
  if (ft.home < ht.home || ft.away < ht.away) throw new Error('FT_BELOW_HT_SCORE');
  return Object.freeze({
    '3+ HT': Number(ht.home + ht.away >= 3),
    '7+ FT': Number(ft.home + ft.away >= 7),
    'Other HT': Number(Math.max(ht.home, ht.away) >= 4),
    'Other FT': Number(Math.max(ft.home, ft.away) >= 5),
  });
}

function assertSettlementProvenance(sourceProvenance) {
  if (!sourceProvenance || typeof sourceProvenance !== 'object' || Array.isArray(sourceProvenance)) {
    throw new Error('SETTLEMENT_PROVENANCE_REQUIRED');
  }
  if (sourceProvenance.verified !== true) throw new Error('SETTLEMENT_PROVENANCE_NOT_VERIFIED');
  const sources = Array.isArray(sourceProvenance.sources) ? sourceProvenance.sources : [];
  if (!sources.length || !sources.every(source => source && typeof source === 'object' && requiredText(source.name, 'SETTLEMENT_SOURCE_NAME_REQUIRED') && requiredText(source.reference, 'SETTLEMENT_SOURCE_REFERENCE_REQUIRED'))) {
    throw new Error('SETTLEMENT_SOURCES_REQUIRED');
  }
  return Object.freeze({
    ...sourceProvenance,
    sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))),
  });
}

export function normalizeLockedPrediction(input = {}) {
  assertPreRegistration(input);
  assertVerifiedFixture(input);
  assertSnapshotSource(input);

  const sourceCreated = Date.parse(String(input.sourceSnapshotCreatedAt));
  const locked = Date.parse(String(input.lockedAt));
  if (sourceCreated > locked) throw new Error('SOURCE_SNAPSHOT_AFTER_LOCK');
  if (input.sourceSnapshotStrictPrior !== true) throw new Error('SOURCE_SNAPSHOT_STRICT_PRIOR_REQUIRED');

  const modelName = requiredText(input.modelName, 'MODEL_NAME_REQUIRED');
  const modelVersion = requiredText(input.modelVersion, 'MODEL_VERSION_REQUIRED');
  const modelFingerprint = requiredText(input.modelFingerprint, 'MODEL_FINGERPRINT_REQUIRED');
  const probabilities = Object.freeze(Object.fromEntries(MARKETS.map(market => [market, requiredProbability(input.probabilities, market)])));

  const fixtureVerification = Object.freeze({ ...input.fixtureVerification });
  return Object.freeze({
    benchmarkVersion: LIVING_BENCHMARK_VERSION,
    status: 'LOCKED',
    modelName,
    modelVersion,
    modelFingerprint,
    fixtureId: String(input.fixtureVerification.fixtureId),
    homeTeam: String(input.homeTeam ?? ''),
    awayTeam: String(input.awayTeam ?? ''),
    targetDate: String(input.targetDate),
    kickoffAt: String(input.kickoffAt),
    lockedAt: String(input.lockedAt),
    maxEvidenceDate: String(input.maxEvidenceDate),
    sourceSnapshotId: String(input.sourceSnapshotId),
    sourcePredictionHash: String(input.sourcePredictionHash),
    sourceSnapshotCreatedAt: String(input.sourceSnapshotCreatedAt),
    sourceSnapshotStatus: String(input.sourceSnapshotStatus),
    sourceSnapshotStrictPrior: true,
    sourceSnapshotTargetDate: String(input.sourceSnapshotTargetDate),
    sourceSnapshotHomeTeam: String(input.sourceSnapshotHomeTeam),
    sourceSnapshotAwayTeam: String(input.sourceSnapshotAwayTeam),
    fixtureVerification,
    probabilities,
    top3HT: Object.freeze(Array.isArray(input.top3HT) ? [...input.top3HT] : []),
    top3FT: Object.freeze(Array.isArray(input.top3FT) ? [...input.top3FT] : []),
    tailConditional: input.tailConditional ?? null,
    productionMutationAllowed: false,
  });
}

export function settleLockedPrediction(prediction, settlement) {
  if (!prediction || prediction.benchmarkVersion !== LIVING_BENCHMARK_VERSION) throw new Error('LOCKED_PREDICTION_REQUIRED');
  if (prediction.status !== 'LOCKED') {
    if (prediction.status === 'SETTLED') throw new Error('PREDICTION_ALREADY_SETTLED');
    throw new Error('PREDICTION_NOT_LOCKED');
  }
  if (!settlement || typeof settlement !== 'object') throw new Error('SETTLEMENT_REQUIRED');

  const derived = deriveActualMarkets(settlement.actualHT, settlement.actualFT);
  if (!settlement.actualMarkets || typeof settlement.actualMarkets !== 'object') throw new Error('ACTUAL_MARKETS_REQUIRED');
  for (const market of MARKETS) {
    if (![0,1].includes(settlement.actualMarkets[market])) throw new Error(`INVALID_ACTUAL:${market}`);
    if (settlement.actualMarkets[market] !== derived[market]) throw new Error(`ACTUAL_MARKET_SCORE_MISMATCH:${market}`);
  }

  const settledAt = Date.parse(String(settlement.settledAt ?? ''));
  if (!Number.isFinite(settledAt)) throw new Error('SETTLED_AT_REQUIRED');
  const kickoffAt = Date.parse(String(prediction.kickoffAt ?? ''));
  if (!Number.isFinite(kickoffAt) || settledAt <= kickoffAt) throw new Error('SETTLEMENT_NOT_POST_KICKOFF');
  const sourceProvenance = assertSettlementProvenance(settlement.sourceProvenance);

  return Object.freeze({
    ...prediction,
    actualHT: parseScore(settlement.actualHT, 'ACTUAL_HT').score,
    actualFT: parseScore(settlement.actualFT, 'ACTUAL_FT').score,
    actualMarkets: derived,
    settledAt: new Date(settledAt).toISOString(),
    sourceProvenance,
    status: 'SETTLED',
  });
}

export function prequentialBrier(settledRows = []) {
  const rows = settledRows.filter(r => r?.status === 'SETTLED');
  if (!rows.length) return { n: 0, meanBrier: null, byMarket: {} };
  const byMarket = {};
  for (const market of MARKETS) {
    const vals = rows.map(r => (Number(r.probabilities[market]) - Number(r.actualMarkets[market])) ** 2);
    byMarket[market] = vals.reduce((a,b) => a + b, 0) / vals.length;
  }
  const meanBrier = Object.values(byMarket).reduce((a,b) => a + b, 0) / MARKETS.length;
  return { n: rows.length, meanBrier, byMarket };
}
