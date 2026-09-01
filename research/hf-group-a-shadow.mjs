import fs from 'node:fs/promises';
import { runGroupAFullSuitePrimaryV2 } from './group-a-primary-v2-gate.mjs';
import { PRODUCTION_BASELINE_LOCK } from './production-baseline-lock.mjs';

export const CFI_HF_GROUP_A_SHADOW = Object.freeze({
  version: 'CFI_HF_GROUP_A_SHADOW_V1',
  status: 'SHADOW_RESEARCH',
  decisionUse: false,
  productionMutationAllowed: false,
  primaryContract: 'CFI_2_METHODS_X_6_TARGETS_V2',
  multiMarketVersion: 'CFI_MULTI_MARKET_V1',
  selectedCandidates: Object.freeze([
    'OPPONENT_STRENGTH_ARM_V1',
    'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',
  ]),
});

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function summarizeHfGroupAShadow(result, env = process.env) {
  assert(result?.baseline?.engine === PRODUCTION_BASELINE_LOCK.engine, 'HF_GROUP_A_BASELINE_ENGINE_DRIFT');
  assert(result?.baseline?.runtime === PRODUCTION_BASELINE_LOCK.runtime, 'HF_GROUP_A_BASELINE_RUNTIME_DRIFT');
  assert(result?.baseline?.primaryContract === CFI_HF_GROUP_A_SHADOW.primaryContract, 'HF_GROUP_A_PRIMARY_CONTRACT_DRIFT');
  assert(result?.baseline?.multiMarketVersion === CFI_HF_GROUP_A_SHADOW.multiMarketVersion, 'HF_GROUP_A_MULTI_MARKET_DRIFT');
  assert(result?.baseline?.commitSha === PRODUCTION_BASELINE_LOCK.commitSha, 'HF_GROUP_A_BASELINE_COMMIT_DRIFT');
  assert(result?.strictPrior === true, 'HF_GROUP_A_STRICT_PRIOR_REQUIRED');
  assert(result?.sameDateLeakage === false, 'HF_GROUP_A_SAME_DATE_LEAKAGE');
  assert(result?.futureLeakage === false, 'HF_GROUP_A_FUTURE_LEAKAGE');
  assert(result?.noReconstruction === true, 'HF_GROUP_A_NO_RECONSTRUCTION_REQUIRED');
  assert(result?.decisionUse === false, 'HF_GROUP_A_DECISION_USE_FORBIDDEN');
  assert(result?.productionMutationAllowed === false, 'HF_GROUP_A_PRODUCTION_MUTATION_FORBIDDEN');
  assert(result?.evaluationContract?.top3GateUse === false, 'HF_GROUP_A_TOP3_GATE_FORBIDDEN');

  const challengers = {};
  for (const name of CFI_HF_GROUP_A_SHADOW.selectedCandidates) {
    const candidate = result?.challengers?.[name];
    assert(candidate, `HF_GROUP_A_CANDIDATE_MISSING:${name}`);
    assert(candidate.decisionUse === false, `HF_GROUP_A_CANDIDATE_DECISION_USE_FORBIDDEN:${name}`);
    assert(candidate.productionMutationAllowed === false, `HF_GROUP_A_CANDIDATE_PRODUCTION_MUTATION_FORBIDDEN:${name}`);
    assert(candidate.evaluationContract?.top3GateUse === false, `HF_GROUP_A_CANDIDATE_TOP3_GATE_FORBIDDEN:${name}`);
    challengers[name] = {
      status: candidate.status,
      eligible: candidate.coverage?.eligible ?? 0,
      active: candidate.coverage?.active ?? 0,
      abstain: candidate.coverage?.abstain ?? 0,
      aggregate: candidate.aggregate,
      primaryEvaluation: candidate.primaryEvaluation,
      multiMarketEvaluation: candidate.multiMarketEvaluation,
      auxiliaryDiagnostics: candidate.auxiliaryDiagnostics,
      primaryRegressionCount: candidate.primaryRegressionCount,
      multiMarketRegressionCount: candidate.multiMarketRegressionCount,
      segmentRegressionCount: candidate.segmentRegressionCount,
      regressions: candidate.regressions,
      hardBlockers: candidate.hardBlockers,
      promotionDecision: candidate.promotionDecision,
      shadowEligible: candidate.shadowEligible,
      decisionUse: false,
      productionMutationAllowed: false,
    };
  }

  return {
    version: CFI_HF_GROUP_A_SHADOW.version,
    status: CFI_HF_GROUP_A_SHADOW.status,
    executionPlatform: 'HUGGING_FACE_JOBS',
    jobId: env.JOB_ID ?? null,
    accelerator: env.ACCELERATOR ?? null,
    cpuCores: env.CPU_CORES ?? null,
    memory: env.MEMORY ?? null,
    baseline: result.baseline,
    evaluationContract: result.evaluationContract,
    strictPrior: true,
    sameDateLeakage: false,
    futureLeakage: false,
    noReconstruction: true,
    decisionUse: false,
    productionMutationAllowed: false,
    productionWritePath: null,
    selectedCandidates: [...CFI_HF_GROUP_A_SHADOW.selectedCandidates],
    coverage: result.coverage,
    determinism: result.determinism,
    challengers,
    universalBlockers: [
      'BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS',
      'INSUFFICIENT_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT',
    ],
  };
}

export async function runHfGroupAShadow(corpus, featureBundle, options = {}) {
  const raw = runGroupAFullSuitePrimaryV2(corpus, featureBundle, options);
  return summarizeHfGroupAShadow(raw, options.env ?? process.env);
}

async function main() {
  const corpusPath = process.argv[2];
  const featurePath = process.argv[3];
  if (!corpusPath || !featurePath) {
    throw new Error('USAGE: node research/hf-group-a-shadow.mjs <r0.json> <group-a.json>');
  }
  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  const features = JSON.parse(await fs.readFile(featurePath, 'utf8'));
  const summary = await runHfGroupAShadow(corpus, features);
  process.stdout.write(`CFI_HF_GROUP_A_RESULT=${JSON.stringify(summary)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
