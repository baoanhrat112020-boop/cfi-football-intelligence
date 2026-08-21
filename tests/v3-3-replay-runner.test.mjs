import test from "node:test";
import assert from "node:assert/strict";
import { replayToStageRows, runV3_3Replay } from "../src/learning/v3-3-replay-runner.ts";

const fixtures = Array.from({ length: 24 }, (_, i) => ({
  id: `f${i + 1}`,
  matchDate: `2026-07-${String(i + 1).padStart(2, "0")}`,
  homeTeam: i % 2 ? "Beta" : "Alpha",
  awayTeam: i % 2 ? "Alpha" : "Beta",
  ht: { home: i % 4 === 0 ? 2 : 1, away: i % 5 === 0 ? 1 : 0 },
  ft: { home: i % 6 === 0 ? 5 : 2, away: i % 7 === 0 ? 2 : 1 },
}));

test("V3.3 runner emits exactly six stage rows for each A/B/FINAL evaluation", () => {
  const { replay, rows } = replayToStageRows(fixtures, { minPrior: 8 });
  assert.equal(replay.strictPrior, true);
  assert.equal(replay.sameDateLeakage, false);
  assert.equal(rows.length, replay.evaluationRows * 6);
  assert.equal(replay.evaluationRows, replay.evaluatedFixtures * 3);
  assert.ok(rows.some((r) => r.model_type === "HISTORICAL_PRODUCTION"));
  assert.ok(rows.some((r) => r.model_type === "FUTURE_SIX_FACTORS"));
  assert.ok(rows.some((r) => r.model_type === "FINAL_CFI"));
  assert.ok(rows.every((r) => r.strict_prior === true && r.same_day_excluded === true));
  assert.ok(rows.every((r) => r.target_date < "2026-08-20"));
  assert.ok(rows.filter((r) => !r.market.startsWith("Top-3")).every((r) => Number.isFinite(r.predicted_probability) && r.predicted_probability >= 0 && r.predicted_probability <= 1));
});

test("V3.3 runner persists real strict-prior evidence counts instead of fabricated zero", () => {
  const { replay, rows } = replayToStageRows(fixtures, { minPrior: 8 });
  assert.ok(replay.evaluations.some((e) => e.priorSample > 0));
  assert.ok(rows.some((r) => r.prior_sample > 0));
  for (const evaluation of replay.evaluations) {
    const staged = rows.filter((r) => r.fixture_id === evaluation.fixtureId && r.model_type === evaluation.modelType);
    assert.equal(staged.length, 6);
    assert.ok(staged.every((r) => r.prior_sample === evaluation.priorSample));
  }
});

test("V3.3 runner fails closed on prospective holdout fixtures", () => {
  const contaminated = [...fixtures, { ...fixtures[0], id: "holdout", matchDate: "2026-08-20" }];
  assert.throws(() => replayToStageRows(contaminated, { minPrior: 8 }), /HOLDOUT_FIXTURE_REJECTED/);
});

test("V3.3 replay is deterministic and input-order invariant", () => {
  const a = replayToStageRows(fixtures, { minPrior: 8 });
  const b = replayToStageRows([...fixtures].reverse(), { minPrior: 8 });
  assert.deepEqual(b.replay, a.replay);
  assert.deepEqual(b.rows, a.rows);
});

test("V3.3 writer batches rows without changing replay results", async () => {
  const writes = [];
  const result = await runV3_3Replay({
    loadFixtures: async () => fixtures,
    upsertRows: async (rows) => writes.push(...rows),
    minPrior: 8,
    batchSize: 7,
  });
  assert.equal(writes.length, result.stageRows);
  assert.equal(result.stageRows, result.evaluationRows * 6);
});
