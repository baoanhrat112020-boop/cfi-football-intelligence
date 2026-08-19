import test from "node:test";
import assert from "node:assert/strict";
import { replayDualHistorical } from "../src/learning/dual-historical-replay.ts";

const fixtures = Array.from({ length: 18 }, (_, i) => ({
  id: `f${i+1}`,
  matchDate: `2026-01-${String(i+1).padStart(2,"0")}`,
  homeTeam: i % 2 ? "Beta" : "Alpha",
  awayTeam: i % 2 ? "Alpha" : "Beta",
  ht: { home: i % 4 === 0 ? 2 : 1, away: i % 5 === 0 ? 1 : 0 },
  ft: { home: i % 6 === 0 ? 5 : 2, away: i % 7 === 0 ? 2 : 1 },
}));

test("historical replay evaluates both models from strict-prior evidence", () => {
  const result = replayDualHistorical(fixtures, { minPrior: 8 });
  assert.equal(result.strictPrior, true);
  assert.equal(result.sameDateLeakage, false);
  assert.equal(result.canonicalFixtureMutations, 0);
  assert.equal(result.evaluationRows, result.evaluatedFixtures * 2);
  assert.ok(result.evaluations.some(r => r.modelType === "HISTORICAL_PRODUCTION"));
  assert.ok(result.evaluations.some(r => r.modelType === "FUTURE_SIX_FACTORS"));
  assert.equal(result.scoreboard.futureSix.top3HTAccuracy, null);
  assert.equal(result.scoreboard.futureSix.top3FTAccuracy, null);
});

test("future result mutation cannot change an earlier historical replay", () => {
  const a = replayDualHistorical(fixtures, { minPrior: 8 });
  const mutated = structuredClone(fixtures);
  mutated[17].ht = { home: 9, away: 9 };
  mutated[17].ft = { home: 12, away: 11 };
  const b = replayDualHistorical(mutated, { minPrior: 8 });
  const earlierA = a.evaluations.filter(r => r.targetDate < "2026-01-18");
  const earlierB = b.evaluations.filter(r => r.targetDate < "2026-01-18");
  assert.deepEqual(earlierB, earlierA);
});

test("same-date fixtures never learn from one another", () => {
  const rows = structuredClone(fixtures);
  rows[10].matchDate = rows[9].matchDate;
  const a = replayDualHistorical(rows, { minPrior: 8 });
  rows[10].ft = { home: 20, away: 0 };
  const b = replayDualHistorical(rows, { minPrior: 8 });
  const targetDate = rows[9].matchDate;
  const sameDateOther = r => r.targetDate === targetDate && r.fixtureId === rows[9].id;
  assert.deepEqual(a.evaluations.filter(sameDateOther), b.evaluations.filter(sameDateOther));
});

test("replay is deterministic and replay keys are idempotent", () => {
  const a = replayDualHistorical(fixtures, { minPrior: 8 });
  const b = replayDualHistorical([...fixtures].reverse(), { minPrior: 8 });
  assert.deepEqual(a, b);
  const keys = a.evaluations.map(r => r.replayKey);
  assert.equal(new Set(keys).size, keys.length);
});
