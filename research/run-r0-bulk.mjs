import fs from 'node:fs/promises';
import { replayDualHistorical } from '../src/learning/dual-historical-replay.ts';
import { scoreReplayAllModels } from './replay-promotion-adapter.mjs';

export const R0_DATASET_CONTRACT = Object.freeze({
  manifestVersion: 'CFI_TIME_MACHINE_V2',
  warmupStart: '2015-01-01',
  researchStart: '2016-01-01',
  researchEnd: '2026-08-19',
  prospectiveHoldoutStart: '2026-08-20',
  minGlobalPriorFixtures: 8,
  strictPrior: true,
  sameDayExcluded: true,
  productionChampion: 'CFI_FINAL_V5.2.5',
  productionEntrypoint: 'cloudflare-worker/src/index-v55.ts',
  productionRuntime: 'CFI_SIX_TARGET_RUNTIME_V1.4',
  bigDbRetrieval: 'CFI_BIG_DB_RETRIEVAL_V2.1.2',
  numericalCore: 'src/prediction/final-engine.ts::buildPrediction',
  parityBasis: 'index-v50 invokes buildPrediction; v51-v55 add strict-prior telemetry/release/consistency/diversity guards without direct global-prior shrinkage of six-target outputs',
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
  const corpus = freezeR0Corpus(input);
  const replayFull = replayDualHistorical(corpus, {
    minPrior: options.minPrior ?? R0_DATASET_CONTRACT.minGlobalPriorFixtures,
  });
  const replay = restrictReplayToResearchWindow(replayFull);
  const scores = scoreReplayAllModels(replay, options.scoreOptions ?? {});
  const champion = scores.FINAL_CFI ?? null;
  return {
    contract: R0_DATASET_CONTRACT,
    productionParity: {
      releaseEngine: R0_DATASET_CONTRACT.productionChampion,
      numericalCore: R0_DATASET_CONTRACT.numericalCore,
      productionEntrypoint: R0_DATASET_CONTRACT.productionEntrypoint,
      directGlobalPriorShrinkage: false,
      verifiedBySourceContract: true,
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
