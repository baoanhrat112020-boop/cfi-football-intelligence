import fs from 'node:fs/promises';
import { replayDualHistorical } from '../src/learning/dual-historical-replay.ts';
import { scoreReplayAllModels } from './replay-promotion-adapter.mjs';
import { PRODUCTION_BASELINE_LOCK, verifyProductionBaselineLock } from './production-baseline-lock.mjs';

export const R0_DATASET_CONTRACT = Object.freeze({
  manifestVersion: 'CFI_TIME_MACHINE_V2',
  warmupStart: '2015-01-01',
  researchStart: '2016-01-01',
  researchEnd: '2026-08-19',
  prospectiveHoldoutStart: '2026-08-20',
  minGlobalPriorFixtures: 8,
  strictPrior: true,
  sameDayExcluded: true,
  baselineLockVersion: PRODUCTION_BASELINE_LOCK.version,
  baselineCommitSha: PRODUCTION_BASELINE_LOCK.commitSha,
  productionChampion: PRODUCTION_BASELINE_LOCK.engine,
  numericalCoreEngine: PRODUCTION_BASELINE_LOCK.numericalCoreEngine,
  productionRuntimeReportedEngine: PRODUCTION_BASELINE_LOCK.productionRuntimeReportedEngine,
  runtimeTelemetryMatchesNumericalCore: PRODUCTION_BASELINE_LOCK.runtimeTelemetryMatchesNumericalCore,
  runtimeTelemetryStatus: PRODUCTION_BASELINE_LOCK.runtimeTelemetryStatus,
  productionRuntime: PRODUCTION_BASELINE_LOCK.runtime,
  primaryContract: PRODUCTION_BASELINE_LOCK.primaryContract,
  multiMarketVersion: PRODUCTION_BASELINE_LOCK.multiMarketVersion,
  crossMarketCoherence: PRODUCTION_BASELINE_LOCK.crossMarketCoherence,
  historicalEvaluator: PRODUCTION_BASELINE_LOCK.historicalEvaluator,
  productionEntrypoint: PRODUCTION_BASELINE_LOCK.productionEntrypoint,
  prematchEntrypoint: PRODUCTION_BASELINE_LOCK.prematchEntrypoint,
  predictionPath: PRODUCTION_BASELINE_LOCK.predictionPath,
  bigDbRetrieval: PRODUCTION_BASELINE_LOCK.bigDbRetrieval,
  numericalCore: 'src/prediction/final-engine.ts::buildPrediction',
  decisionUse: false,
  productionMutationAllowed: false,
  parityBasis: 'Exact source blobs are pinned to V2.2 baseline commit. Numerical core is CFI_FINAL_V5.3.1 while the pinned production Worker telemetry still reports CFI_FINAL_V5.3.0; this label lag is explicitly preserved and must not be confused with numerical-core drift. R0 and challengers use the pinned numerical core + Top-1 V2 + CFI_MULTI_MARKET_V1 + CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.2. Any locked source drift fails closed before replay.',
});

function dateOf(row) {
  return String(row?.matchDate ?? row?.match_date ?? row?.date ?? '').slice(0, 10);
}

export function freezeR0Corpus(input) {
  const rows = Array.isArray(input) ? input : (input?.fixtures ?? input?.rows ?? input?.data ?? []);
  if (!Array.isArray(rows)) throw new Error('R0_CORPUS_REQUIRED');
  const frozen = rows.filter(row => {
    const d = dateOf(row);
    return d >= R0_DATASET_CONTRACT.warmupStart && d < R0_DATASET_CONTRACT.prospectiveHoldoutStart;
  });
  if (frozen.some(row => dateOf(row) >= R0_DATASET_CONTRACT.prospectiveHoldoutStart)) {
    throw new Error('R0_HOLDOUT_LEAKAGE');
  }
  return frozen;
}

export function restrictReplayToResearchWindow(replay) {
  const start = R0_DATASET_CONTRACT.researchStart;
  const endExclusive = R0_DATASET_CONTRACT.prospectiveHoldoutStart;
  const evaluations = (replay?.evaluations ?? []).filter(row => {
    const d = String(row?.targetDate ?? '').slice(0, 10);
    return d >= start && d < endExclusive;
  });
  return {
    ...replay,
    evaluations,
    evaluatedFixtures: new Set(evaluations.map(row => row.fixtureId)).size,
    evaluationRows: evaluations.length,
  };
}

export function runR0Bulk(input, options = {}) {
  const baselineVerification = verifyProductionBaselineLock(options.baselineLockOptions ?? {});
  const corpus = freezeR0Corpus(input);
  const replayFull = replayDualHistorical(corpus, {
    minPrior: options.minPrior ?? R0_DATASET_CONTRACT.minGlobalPriorFixtures,
  });
  const replay = restrictReplayToResearchWindow(replayFull);
  const scores = scoreReplayAllModels(replay, options.scoreOptions ?? {});
  const champion = scores.FINAL_CFI ?? null;
  return {
    contract: R0_DATASET_CONTRACT,
    baselineVerification,
    productionParity: {
      baselineCommitSha: R0_DATASET_CONTRACT.baselineCommitSha,
      releaseEngine: R0_DATASET_CONTRACT.productionChampion,
      numericalCoreEngine: R0_DATASET_CONTRACT.numericalCoreEngine,
      productionRuntimeReportedEngine: R0_DATASET_CONTRACT.productionRuntimeReportedEngine,
      runtimeTelemetryMatchesNumericalCore: R0_DATASET_CONTRACT.runtimeTelemetryMatchesNumericalCore,
      runtimeTelemetryStatus: R0_DATASET_CONTRACT.runtimeTelemetryStatus,
      runtime: R0_DATASET_CONTRACT.productionRuntime,
      primaryContract: R0_DATASET_CONTRACT.primaryContract,
      multiMarketVersion: R0_DATASET_CONTRACT.multiMarketVersion,
      crossMarketCoherence: R0_DATASET_CONTRACT.crossMarketCoherence,
      historicalEvaluator: R0_DATASET_CONTRACT.historicalEvaluator,
      predictionPath: R0_DATASET_CONTRACT.predictionPath,
      numericalCore: R0_DATASET_CONTRACT.numericalCore,
      productionEntrypoint: R0_DATASET_CONTRACT.productionEntrypoint,
      prematchEntrypoint: R0_DATASET_CONTRACT.prematchEntrypoint,
      directGlobalPriorShrinkage: false,
      decisionUse: false,
      verifiedByExactSourceBlobLock: baselineVerification.status === 'PASS',
    },
    corpusCount: corpus.length,
    replay: {
      replayVersion: replay.replayVersion,
      fixtureCount: replayFull.fixtureCount,
      evaluatedFixtures: replay.evaluatedFixtures,
      evaluationRows: replay.evaluationRows,
      strictPrior: replay.strictPrior,
      sameDateLeakage: replay.sameDateLeakage,
      temporalProvenanceComplete: replay.temporalProvenanceComplete,
      scoringWindow: { start: R0_DATASET_CONTRACT.researchStart, end: R0_DATASET_CONTRACT.researchEnd },
    },
    scores,
    r0: champion,
    promotionDecision: champion?.shadowEligible ? 'SHADOW_ELIGIBLE_ONLY' : 'HOLD',
    decisionUse: false,
    productionMutationAllowed: false,
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node --experimental-strip-types research/run-r0-bulk.mjs <corpus.json> [output.json]');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const result = runR0Bulk(raw);
  const text = JSON.stringify(result, null, 2);
  if (process.argv[3]) await fs.writeFile(process.argv[3], text + '\n');
  else process.stdout.write(text + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err?.stack ?? String(err));
    process.exitCode = 1;
  });
}
