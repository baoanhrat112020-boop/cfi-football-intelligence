import { replayDualHistorical, DUAL_REPLAY_VERSION, MODEL_TYPES } from "./dual-historical-replay.ts";

export const V3_3_RESEARCH_CUTOFF = "2026-08-20";
export const V3_3_STAGE_TABLE = "cfi_v3_3_replay_stage";
export const V3_3_SOURCE_VIEW = "cfi_v3_3_replay_source";
export const V3_3_MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT", "Top-3 HT", "Top-3 FT"] as const;

type StageRow = {
  fixture_id: string;
  target_date: string;
  model_type: string;
  model_version: string;
  replay_version: string;
  market: typeof V3_3_MARKETS[number];
  predicted_probability: number | null;
  outcome_boolean: boolean | null;
  brier: number | null;
  top1_hit: boolean | null;
  top3_hit: boolean | null;
  rank_of_hit: number | null;
  prior_sample: number;
  strict_prior: true;
  same_day_excluded: true;
  factor_probabilities: unknown | null;
  factor_confidence: unknown | null;
  factor_evidence: unknown | null;
};

type ReplayEvaluation = {
  fixtureId: string;
  targetDate: string;
  modelType: string;
  modelVersion: string;
  priorSample: number;
  probabilities: Record<string, number>;
  outcomes: Record<string, 0 | 1 | null>;
  brier: Record<string, number | null>;
  top3HT: { top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  top3FT: { top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  factors?: unknown;
};

function assertFiniteProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`INVALID_PROBABILITY:${label}:${value}`);
}

export function assertResearchFixture(input: any, cutoff = V3_3_RESEARCH_CUTOFF) {
  const date = String(input?.matchDate ?? input?.match_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_MATCH_DATE");
  if (date >= cutoff) throw new Error(`HOLDOUT_FIXTURE_REJECTED:${date}`);
  return true;
}

export function evaluationToStageRows(evaluation: ReplayEvaluation, replayVersion = DUAL_REPLAY_VERSION): StageRow[] {
  if (!MODEL_TYPES.includes(evaluation.modelType as any)) throw new Error(`INVALID_MODEL_TYPE:${evaluation.modelType}`);
  if (!Number.isInteger(evaluation.priorSample) || evaluation.priorSample < 0) throw new Error(`INVALID_PRIOR_SAMPLE:${evaluation.priorSample}`);

  const factors = evaluation.modelType === "FUTURE_SIX_FACTORS" ? (evaluation.factors ?? null) : null;
  const common = {
    fixture_id: evaluation.fixtureId,
    target_date: evaluation.targetDate,
    model_type: evaluation.modelType,
    model_version: evaluation.modelVersion,
    replay_version: replayVersion,
    prior_sample: evaluation.priorSample,
    strict_prior: true as const,
    same_day_excluded: true as const,
    factor_probabilities: null,
    factor_confidence: null,
    factor_evidence: factors,
  };

  const thresholdRows = ["3+ HT", "7+ FT", "Other HT", "Other FT"].map((market) => {
    const probability = Number(evaluation.probabilities[market]);
    assertFiniteProbability(probability, `${evaluation.fixtureId}:${evaluation.modelType}:${market}`);
    const outcome = evaluation.outcomes[market];
    const score = evaluation.brier[market];
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) throw new Error(`INVALID_BRIER:${market}:${score}`);
    return {
      ...common,
      market: market as StageRow["market"],
      predicted_probability: probability,
      outcome_boolean: outcome === null ? null : Boolean(outcome),
      brier: score,
      top1_hit: null,
      top3_hit: null,
      rank_of_hit: null,
    };
  });

  const topRows: StageRow[] = [
    {
      ...common,
      market: "Top-3 HT",
      predicted_probability: null,
      outcome_boolean: null,
      brier: null,
      top1_hit: evaluation.top3HT.top1Hit,
      top3_hit: evaluation.top3HT.top3Hit,
      rank_of_hit: evaluation.top3HT.rankOfHit,
    },
    {
      ...common,
      market: "Top-3 FT",
      predicted_probability: null,
      outcome_boolean: null,
      brier: null,
      top1_hit: evaluation.top3FT.top1Hit,
      top3_hit: evaluation.top3FT.top3Hit,
      rank_of_hit: evaluation.top3FT.rankOfHit,
    },
  ];
  return [...thresholdRows, ...topRows];
}

export function replayToStageRows(input: unknown, options: { minPrior?: number; cutoff?: string } = {}) {
  const cutoff = options.cutoff ?? V3_3_RESEARCH_CUTOFF;
  if (Array.isArray(input)) input.forEach((fixture) => assertResearchFixture(fixture, cutoff));
  const replay = replayDualHistorical(input, { minPrior: options.minPrior ?? 10 });
  if (replay.strictPrior !== true) throw new Error("STRICT_PRIOR_REPLAY_REQUIRED");
  if (replay.sameDateLeakage !== false) throw new Error("SAME_DATE_LEAKAGE_DETECTED");
  if (replay.canonicalFixtureMutations !== 0) throw new Error("CANONICAL_FIXTURE_MUTATION_DETECTED");
  const rows = replay.evaluations.flatMap((evaluation: ReplayEvaluation) => evaluationToStageRows(evaluation, replay.replayVersion));
  const expectedRows = replay.evaluationRows * 6;
  if (rows.length !== expectedRows) throw new Error(`ROW_COUNT_MISMATCH:${rows.length}:${expectedRows}`);
  return { replay, rows };
}

export async function runV3_3Replay(args: {
  loadFixtures: () => Promise<unknown[]>;
  upsertRows: (rows: StageRow[]) => Promise<void>;
  minPrior?: number;
  batchSize?: number;
  cutoff?: string;
}) {
  const fixtures = await args.loadFixtures();
  fixtures.forEach((fixture) => assertResearchFixture(fixture, args.cutoff ?? V3_3_RESEARCH_CUTOFF));
  const { replay, rows } = replayToStageRows(fixtures, { minPrior: args.minPrior, cutoff: args.cutoff });
  const batchSize = Math.max(1, args.batchSize ?? 500);
  for (let i = 0; i < rows.length; i += batchSize) await args.upsertRows(rows.slice(i, i + batchSize));
  return {
    replayVersion: replay.replayVersion,
    fixtureCount: replay.fixtureCount,
    evaluatedFixtures: replay.evaluatedFixtures,
    evaluationRows: replay.evaluationRows,
    stageRows: rows.length,
    scoreboard: replay.scoreboard,
  };
}
