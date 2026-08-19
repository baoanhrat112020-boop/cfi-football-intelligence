import test from "node:test";
import assert from "node:assert/strict";
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

test("future-six returns six bounded factor probabilities from strict-prior evidence", () => {
  const result = buildFutureSixPrediction({ home: "A", away: "B", targetDate: "2025-02-01", homePayload: rows.slice(0, 12), awayPayload: rows.slice(12), h2hPayload: [] });
  assert.deepEqual(Object.keys(result.factors), FUTURE_FACTOR_CODES);
  for (const factor of Object.values(result.factors)) {
    assert.ok(factor.probability >= 0 && factor.probability <= 1);
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(factor.confidence));
  }
  for (const probability of Object.values(result.marketSignals)) assert.ok(probability >= 0 && probability <= 1);
  assert.equal(result.calibrated, false);
  assert.equal(result.promotable, false);
});

test("parallel engine preserves production output and labels both prediction methods", () => {
  const result = buildParallelPrediction({ home: "A", away: "B", targetDate: "2025-02-01", homePayload: rows.slice(0, 12), awayPayload: rows.slice(12), h2hPayload: [], language: "vi" });
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
