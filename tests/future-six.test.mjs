import test from "node:test";
import assert from "node:assert/strict";
import { buildPrediction } from "../src/prediction/final-engine.ts";
import { FUTURE_FACTOR_CODES, buildFutureSixPrediction } from "../src/prediction/future-six.ts";
import { buildParallelPrediction } from "../src/prediction/parallel-engine.ts";

const rows = Array.from({ length: 24 }, (_, index) => ({
  id: String(index),
  matchDate: `2025-01-${String(index + 1).padStart(2, "0")}`,
  homeTeam: index % 2 ? "A" : "X",
  awayTeam: index % 2 ? "Y" : "B",
  ht: index % 4 === 0 ? "2-1" : "1-0",
  ft: index % 5 === 0 ? "5-2" : index % 3 === 0 ? "3-2" : "2-1",
}));

const args = { home: "A", away: "B", targetDate: "2025-02-01", homePayload: rows.slice(0, 12), awayPayload: rows.slice(12), h2hPayload: [], language: "vi" };

test("future-six returns exactly six bounded factor probabilities from strict-prior evidence", () => {
  const result = buildFutureSixPrediction(args);
  assert.deepEqual(Object.keys(result.factors), FUTURE_FACTOR_CODES);
  assert.equal(Object.keys(result.factors).length, 6);
  for (const factor of Object.values(result.factors)) {
    assert.ok(Number.isFinite(factor.probability));
    assert.ok(factor.probability >= 0 && factor.probability <= 1);
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(factor.confidence));
  }
  for (const probability of Object.values(result.marketSignals)) {
    assert.ok(Number.isFinite(probability));
    assert.ok(probability >= 0 && probability <= 1);
  }
  assert.equal(result.calibrated, false);
  assert.equal(result.promotable, false);
});

test("parallel engine preserves production output exactly and labels both prediction methods", () => {
  const production = buildPrediction(args);
  const result = buildParallelPrediction(args);
  assert.deepEqual(result.primaryModel.result, production);
  assert.equal(result.executionMode, "PARALLEL");
  assert.equal(result.primaryModel.predictionType, "HISTORICAL_PRODUCTION");
  assert.equal(result.primaryModel.authoritative, true);
  assert.equal(result.challengerModel.predictionType, "FUTURE_SIX_FACTORS");
  assert.equal(result.challengerModel.authoritative, false);
  assert.match(result.outputLabels.historical, /HISTORICAL PRODUCTION/);
  assert.match(result.outputLabels.futureSix, /6 YẾU TỐ TƯƠNG LAI/);
  assert.equal(result.safety.productionSnapshotRemainsAuthoritative, true);
  assert.equal(result.safety.challengerMayOverwriteProduction, false);
});

test("future fixture mutation cannot alter a strict-prior future-six prediction", () => {
  const futureA = { id: "future", matchDate: "2025-03-01", homeTeam: "A", awayTeam: "B", ht: "0-0", ft: "0-0" };
  const futureB = { ...futureA, ht: "8-8", ft: "12-12" };
  const first = buildFutureSixPrediction({ ...args, homePayload: [...rows.slice(0, 12), futureA] });
  const second = buildFutureSixPrediction({ ...args, homePayload: [...rows.slice(0, 12), futureB] });
  assert.deepEqual(first, second);
});

test("future-six is deterministic across 25 repeated runs", () => {
  const baseline = buildFutureSixPrediction(args);
  for (let i = 0; i < 25; i++) assert.deepEqual(buildFutureSixPrediction(args), baseline);
});

test("missing score evidence remains excluded rather than converted to zero", () => {
  const missing = { id: "missing", matchDate: "2025-01-25", homeTeam: "A", awayTeam: "B", ht: null, ft: null };
  const result = buildFutureSixPrediction({ ...args, homePayload: [missing], awayPayload: [], h2hPayload: [] });
  assert.equal(result.evidence.htCoverage, 0);
  assert.equal(result.evidence.ftCoverage, 0);
});
