import fs from 'node:fs/promises';
import { runGroupAFullSuiteV1 } from './group-a-full-suite-v1.mjs';
import { PRODUCTION_BASELINE_LOCK } from './production-baseline-lock.mjs';

export const GROUP_A_PRIMARY_V2_GATE = Object.freeze({
  version: 'CFI_GROUP_A_PRIMARY_V2_GATE_V1',
  researchOnly: true,
  decisionUse: false,
  primaryContract: 'CFI_2_METHODS_X_6_TARGETS_V2',
  primaryTargets: Object.freeze([
    '3+ HT',
    '7+ FT',
    'Other HT',
    'Other FT',
    'Top-1 HT',
    'Top-1 FT',
  ]),
  auxiliaryDiagnostics: Object.freeze([
    'Top-3 HT',
    'Top-3 FT',
  ]),
  thresholdBrierRegressionTolerance: 0.0005,
  multiMarketFamilyBrierRegressionTolerance: 0.0005,
  top1AccuracyRegressionTolerance: 0.002,
  segmentBrierRegressionTolerance: 0.0005,
  minimumSegmentRows: 500,
});

const finite = value => Number.isFinite(Number(value));
const delta = (candidate, baseline) => finite(candidate) && finite(baseline)
  ? Number(candidate) - Number(baseline)
  : null;

function top1Metric(metrics, part) {
  return metrics?.scoreline?.[part]?.top1Accuracy ?? null;
}

function top3Metric(metrics, part) {
  return metrics?.scoreline?.[part]?.top3Accuracy ?? null;
}

export function evaluateGroupACandidatePrimaryV2(candidate, baselineMetrics, options = {}) {
  const thresholdTol = Number(options.thresholdBrierRegressionTolerance ?? GROUP_A_PRIMARY_V2_GATE.thresholdBrierRegressionTolerance);
  const familyTol = Number(options.multiMarketFamilyBrierRegressionTolerance ?? GROUP_A_PRIMARY_V2_GATE.multiMarketFamilyBrierRegressionTolerance);
  const top1Tol = Number(options.top1AccuracyRegressionTolerance ?? GROUP_A_PRIMARY_V2_GATE.top1AccuracyRegressionTolerance);
  const segmentTol = Number(options.segmentBrierRegressionTolerance ?? GROUP_A_PRIMARY_V2_GATE.segmentBrierRegressionTolerance);
  const minSegmentRows = Math.max(1, Math.floor(options.minimumSegmentRows ?? GROUP_A_PRIMARY_V2_GATE.minimumSegmentRows));
  const metrics = candidate?.metrics ?? {};
  const regressions = [];
  const primary = {};

  for (const target of ['3+ HT', '7+ FT', 'Other HT', 'Other FT']) {
    const baseline = baselineMetrics?.champion?.[target]?.brier ?? null;
    const challenger = metrics?.champion?.[target]?.brier ?? null;
    const d = delta(challenger, baseline);
    primary[target] = { metric: 'brier', baseline, challenger, delta: d, tolerance: thresholdTol };
    if (d !== null && d > thresholdTol) regressions.push(`primary.${target}:brier:+${d.toFixed(6)}`);
  }

  for (const part of ['ht', 'ft']) {
    const label = part === 'ht' ? 'Top-1 HT' : 'Top-1 FT';
    const baseline = top1Metric(baselineMetrics, part);
    const challenger = top1Metric(metrics, part);
    const d = delta(challenger, baseline);
    primary[label] = { metric: 'accuracy', baseline, challenger, delta: d, tolerance: top1Tol };
    if (d !== null && d < -top1Tol) regressions.push(`primary.${label}:accuracy:${d.toFixed(6)}`);
  }

  const multiMarket = {};
  for (const family of ['oneXTwo', 'overUnder', 'asianHandicap']) {
    multiMarket[family] = {};
    for (const part of ['ht', 'ft']) {
      const baseline = baselineMetrics?.[family]?.[part]?.brier ?? null;
      const challenger = metrics?.[family]?.[part]?.brier ?? null;
      const d = delta(challenger, baseline);
      multiMarket[family][part] = { baseline, challenger, delta: d, tolerance: familyTol };
      if (d !== null && d > familyTol) regressions.push(`${family}.${part}:brier:+${d.toFixed(6)}`);
    }
  }

  const segmentRegressions = [];
  for (const [segment, row] of Object.entries(candidate?.segments ?? {})) {
    if (Number(row?.n ?? 0) < minSegmentRows) continue;
    const baseline = row?.baseline?.brier ?? row?.productionBaseline?.brier ?? null;
    const challenger = row?.challenger?.brier ?? null;
    const d = delta(challenger, baseline);
    if (d !== null && d > segmentTol) segmentRegressions.push(`segment.${segment}:brier:+${d.toFixed(6)}`);
  }
  regressions.push(...segmentRegressions);

  const diagnostics = {
    'Top-3 HT': {
      metric: 'accuracy',
      baseline: top3Metric(baselineMetrics, 'ht'),
      challenger: top3Metric(metrics, 'ht'),
      delta: delta(top3Metric(metrics, 'ht'), top3Metric(baselineMetrics, 'ht')),
      gateUse: false,
    },
    'Top-3 FT': {
      metric: 'accuracy',
      baseline: top3Metric(baselineMetrics, 'ft'),
      challenger: top3Metric(metrics, 'ft'),
      delta: delta(top3Metric(metrics, 'ft'), top3Metric(baselineMetrics, 'ft')),
      gateUse: false,
    },
  };

  const inheritedBlockers = (candidate?.hardBlockers ?? []).filter(x => x !== 'UNACCEPTABLE_FULL_CONTRACT_REGRESSION');
  const hardBlockers = [...new Set([
    ...inheritedBlockers,
    ...(regressions.length ? ['UNACCEPTABLE_FULL_CONTRACT_REGRESSION'] : []),
  ])];

  return {
    ...candidate,
    evaluationContract: {
      version: GROUP_A_PRIMARY_V2_GATE.version,
      primaryContract: GROUP_A_PRIMARY_V2_GATE.primaryContract,
      primaryTargets: [...GROUP_A_PRIMARY_V2_GATE.primaryTargets],
      auxiliaryDiagnostics: [...GROUP_A_PRIMARY_V2_GATE.auxiliaryDiagnostics],
      top3GateUse: false,
    },
    primaryEvaluation: primary,
    auxiliaryDiagnostics: diagnostics,
    multiMarketEvaluation: multiMarket,
    regressions,
    primaryRegressionCount: regressions.filter(x => x.startsWith('primary.')).length,
    multiMarketRegressionCount: regressions.filter(x => /^(oneXTwo|overUnder|asianHandicap)\./.test(x)).length,
    segmentRegressionCount: segmentRegressions.length,
    hardBlockers,
    shadowEligible: false,
    promotionDecision: 'HOLD',
    productionEligible: false,
    decisionUse: false,
    productionMutationAllowed: false,
  };
}

export function applyGroupAPrimaryV2Gate(rawSuite, options = {}) {
  if (rawSuite?.baseline?.primaryContract !== GROUP_A_PRIMARY_V2_GATE.primaryContract) {
    throw new Error('GROUP_A_PRIMARY_CONTRACT_DRIFT');
  }
  if (rawSuite?.baseline?.engine !== PRODUCTION_BASELINE_LOCK.engine || rawSuite?.baseline?.commitSha !== PRODUCTION_BASELINE_LOCK.commitSha) {
    throw new Error('GROUP_A_PRIMARY_BASELINE_DRIFT');
  }
  const baselineMetrics = rawSuite?.baselineMetrics;
  if (!baselineMetrics) throw new Error('GROUP_A_BASELINE_METRICS_REQUIRED');
  const challengers = Object.fromEntries(Object.entries(rawSuite?.challengers ?? {}).map(([name, candidate]) => [
    name,
    evaluateGroupACandidatePrimaryV2(candidate, baselineMetrics, options),
  ]));
  return {
    ...rawSuite,
    evaluationContract: {
      version: GROUP_A_PRIMARY_V2_GATE.version,
      primaryContract: GROUP_A_PRIMARY_V2_GATE.primaryContract,
      primaryTargets: [...GROUP_A_PRIMARY_V2_GATE.primaryTargets],
      auxiliaryDiagnostics: [...GROUP_A_PRIMARY_V2_GATE.auxiliaryDiagnostics],
      top3GateUse: false,
    },
    challengers,
    groupAVerdict: Object.values(challengers).every(x => x.hardBlockers.length === 0) ? 'PASS' : 'HOLD',
    decisionUse: false,
    productionMutationAllowed: false,
  };
}

export function runGroupAFullSuitePrimaryV2(corpus, featureBundle, options = {}) {
  return applyGroupAPrimaryV2Gate(runGroupAFullSuiteV1(corpus, featureBundle, options), options.gateOptions ?? {});
}

async function main() {
  const corpusPath = process.argv[2];
  const featurePath = process.argv[3];
  const output = process.argv[4] ?? 'group-a-primary-v2-result.json';
  if (!corpusPath || !featurePath) throw new Error('USAGE: node research/group-a-primary-v2-gate.mjs <r0.json> <group-a.json> [output.json]');
  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  const features = JSON.parse(await fs.readFile(featurePath, 'utf8'));
  const result = runGroupAFullSuitePrimaryV2(corpus, features);
  await fs.writeFile(output, `${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify({
    output,
    version: result.version,
    gateVersion: result.evaluationContract.version,
    primaryContract: result.evaluationContract.primaryContract,
    groupAVerdict: result.groupAVerdict,
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
    challengers: Object.fromEntries(Object.entries(result.challengers).map(([name, x]) => [name, {
      eligible: x.coverage?.eligible ?? 0,
      primaryRegressionCount: x.primaryRegressionCount,
      multiMarketRegressionCount: x.multiMarketRegressionCount,
      segmentRegressionCount: x.segmentRegressionCount,
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
