import fs from 'node:fs/promises';
import { runGroupAFullSuiteScoreGridV1 } from './group-a-full-suite-scoregrid-v1.mjs';
import { GROUP_A_PRIMARY_V2_GATE, evaluateGroupACandidatePrimaryV2 } from './group-a-primary-v2-gate.mjs';
import { PRODUCTION_BASELINE_LOCK } from './production-baseline-lock.mjs';

export const GROUP_A_PRIMARY_V2_SCOREGRID_GATE = Object.freeze({
  version: 'CFI_GROUP_A_PRIMARY_V2_SCOREGRID_GATE_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  noReconstruction: true,
  pairedBaseline: true,
  primaryContract: GROUP_A_PRIMARY_V2_GATE.primaryContract,
});

export function applyGroupAPrimaryV2PairedScoreGridGate(rawSuite, options = {}) {
  if (rawSuite?.baseline?.primaryContract !== GROUP_A_PRIMARY_V2_GATE.primaryContract) throw new Error('GROUP_A_SCOREGRID_PRIMARY_CONTRACT_DRIFT');
  if (rawSuite?.baseline?.engine !== PRODUCTION_BASELINE_LOCK.engine || rawSuite?.baseline?.commitSha !== PRODUCTION_BASELINE_LOCK.commitSha) throw new Error('GROUP_A_SCOREGRID_PRIMARY_BASELINE_DRIFT');
  if (rawSuite?.scoreGridEvaluation?.pairedBaseline !== true || rawSuite?.scoreGridEvaluation?.noReconstruction !== true) throw new Error('GROUP_A_SCOREGRID_EVALUATION_PROVENANCE_REQUIRED');

  const challengers = Object.fromEntries(Object.entries(rawSuite?.challengers ?? {}).map(([name, candidate]) => {
    const baseline = candidate?.pairedBaselineMetrics;
    if (!baseline) throw new Error(`GROUP_A_SCOREGRID_PAIRED_BASELINE_REQUIRED:${name}`);
    const evaluated = evaluateGroupACandidatePrimaryV2(candidate, baseline, options);
    return [name, {
      ...evaluated,
      pairedBaselineEvaluation: true,
      scoreGridLogLossEvaluation: {
        ht: {
          baseline: baseline?.scoreline?.ht?.logLoss ?? null,
          challenger: candidate?.metrics?.scoreline?.ht?.logLoss ?? null,
          delta: Number.isFinite(Number(candidate?.metrics?.scoreline?.ht?.logLoss)) && Number.isFinite(Number(baseline?.scoreline?.ht?.logLoss))
            ? Number(candidate.metrics.scoreline.ht.logLoss) - Number(baseline.scoreline.ht.logLoss)
            : null,
        },
        ft: {
          baseline: baseline?.scoreline?.ft?.logLoss ?? null,
          challenger: candidate?.metrics?.scoreline?.ft?.logLoss ?? null,
          delta: Number.isFinite(Number(candidate?.metrics?.scoreline?.ft?.logLoss)) && Number.isFinite(Number(baseline?.scoreline?.ft?.logLoss))
            ? Number(candidate.metrics.scoreline.ft.logLoss) - Number(baseline.scoreline.ft.logLoss)
            : null,
        },
      },
    }];
  }));

  return {
    ...rawSuite,
    evaluationContract: {
      version: GROUP_A_PRIMARY_V2_SCOREGRID_GATE.version,
      primaryContract: GROUP_A_PRIMARY_V2_GATE.primaryContract,
      primaryTargets: [...GROUP_A_PRIMARY_V2_GATE.primaryTargets],
      auxiliaryDiagnostics: [...GROUP_A_PRIMARY_V2_GATE.auxiliaryDiagnostics],
      top3GateUse: false,
      pairedBaseline: true,
      fullScoreGridLogLoss: true,
      noReconstruction: true,
    },
    challengers,
    groupAVerdict: Object.values(challengers).every(x => x.hardBlockers.length === 0) ? 'PASS' : 'HOLD',
    decisionUse: false,
    productionMutationAllowed: false,
  };
}

export function runGroupAFullSuitePrimaryV2ScoreGrid(corpus, featureBundle, options = {}) {
  const raw = runGroupAFullSuiteScoreGridV1(corpus, featureBundle, options);
  return applyGroupAPrimaryV2PairedScoreGridGate(raw, options.gateOptions ?? {});
}

async function main() {
  const corpusPath = process.argv[2];
  const featurePath = process.argv[3];
  const output = process.argv[4] ?? 'group-a-primary-v2-scoregrid-result.json';
  if (!corpusPath || !featurePath) throw new Error('USAGE: node research/group-a-primary-v2-scoregrid-gate.mjs <r0.json> <group-a.json> [output.json]');
  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  const features = JSON.parse(await fs.readFile(featurePath, 'utf8'));
  const result = runGroupAFullSuitePrimaryV2ScoreGrid(corpus, features);
  await fs.writeFile(output, `${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify({
    output,
    version: result.version,
    gateVersion: result.evaluationContract.version,
    primaryContract: result.evaluationContract.primaryContract,
    pairedBaseline: result.evaluationContract.pairedBaseline,
    fullScoreGridLogLoss: result.evaluationContract.fullScoreGridLogLoss,
    groupAVerdict: result.groupAVerdict,
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
    challengers: Object.fromEntries(Object.entries(result.challengers).map(([name, x]) => [name, {
      eligible: x.coverage?.eligible ?? 0,
      primaryRegressionCount: x.primaryRegressionCount,
      multiMarketRegressionCount: x.multiMarketRegressionCount,
      segmentRegressionCount: x.segmentRegressionCount,
      scoreGridLogLossEvaluation: x.scoreGridLogLossEvaluation,
      hardBlockers: x.hardBlockers,
      promotionDecision: x.promotionDecision,
    }])),
  })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
