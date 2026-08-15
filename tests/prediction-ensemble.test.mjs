import test from "node:test";
import assert from "node:assert/strict";
import { predictFourMarkets } from "../src/prediction/ensemble.ts";

function fixture(day, htH, htA, ftH, ftA) {
  return { matchDate: `2026-01-${String(day).padStart(2, "0")}`, htHome: htH, htAway: htA, ftHome: ftH, ftAway: ftA };
}

const history = [
  fixture(1,0,0,1,0), fixture(2,1,0,2,1), fixture(3,2,1,4,2), fixture(4,0,2,1,3),
  fixture(5,1,1,2,2), fixture(6,3,0,5,0), fixture(7,0,0,0,0), fixture(8,2,2,4,3),
  fixture(9,1,0,1,1), fixture(10,0,1,2,1), fixture(11,2,1,5,2), fixture(12,0,0,1,0),
  fixture(13,1,2,3,3), fixture(14,0,3,1,4), fixture(15,2,0,2,1), fixture(16,1,1,3,2),
];

test("returns two options for all four frozen markets", () => {
  const result = predictFourMarkets({ targetDate: "2026-02-01", homeHistory: history, awayHistory: history.slice().reverse(), h2hHistory: history.slice(0, 4) });
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(x => x.market), ["3+ HT", "7+ FT", "Other HT", "Other FT"]);
  for (const row of result) {
    assert.equal(row.optionA.method, "EMPIRICAL_BAYES");
    assert.equal(row.optionB.method, "POISSON_STRUCTURAL");
    assert.ok(row.optionA.probability >= 0 && row.optionA.probability <= 1);
    assert.ok(row.optionB.probability >= 0 && row.optionB.probability <= 1);
    assert.ok(row.selectedProbability >= 0 && row.selectedProbability <= 1);
  }
});

test("strict-prior filter prevents target/future leakage", () => {
  const clean = predictFourMarkets({ targetDate: "2026-01-12", homeHistory: history, awayHistory: [] });
  const poisoned = predictFourMarkets({
    targetDate: "2026-01-12",
    homeHistory: [...history, { matchDate: "2026-01-12", htHome: 9, htAway: 9, ftHome: 15, ftAway: 15 }, { matchDate: "2027-01-01", htHome: 9, htAway: 9, ftHome: 15, ftAway: 15 }],
    awayHistory: [],
  });
  assert.deepEqual(poisoned, clean);
});

test("rare markets stay below dominant high-goal market in mixed sample", () => {
  const result = predictFourMarkets({ targetDate: "2026-02-01", homeHistory: history, awayHistory: history });
  const p3 = result.find(x => x.market === "3+ HT").selectedProbability;
  const pOtherHt = result.find(x => x.market === "Other HT").selectedProbability;
  assert.ok(p3 > pOtherHt);
});
