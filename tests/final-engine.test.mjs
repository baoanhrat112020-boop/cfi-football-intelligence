import test from "node:test";
import assert from "node:assert/strict";
import { buildPrediction, MARKET_CODES, marketHit, normalizeFixtures, strictPriorEvidence, walkForwardBacktest } from "../src/prediction/final-engine.ts";

const flat = { fixture_id: "1", match_date: "2025-01-01", home_team: "A", away_team: "B", ht_home: 1, ht_away: 0, ft_home: 2, ft_away: 1 };
const nested = { id: "1", matchDate: "2025-01-01", homeTeam: "A", awayTeam: "B", ht: { home: 1, away: 0 }, ft: { home: 2, away: 1 } };
const strings = { id: "1", date: "2025-01-01", home_name: "A", away_name: "B", htScore: "1-0", ftScore: "2-1" };

test("canonical adapter normalizes wrappers and equivalent score shapes", () => {
  const production = { ...flat, home_team: undefined, away_team: undefined, home: { canonical_name: "A" }, away: { canonical_name: "B" } };
  for (const payload of [{ fixtures: [flat] }, { history: [nested] }, { result: { body: { rows: [strings] } } }, { body: { fixtures: [production] } }]) {
    const [row] = normalizeFixtures(payload);
    assert.deepEqual({ date: row.matchDate, home: row.homeTeam, away: row.awayTeam, ht: row.ht, ft: row.ft }, { date: "2025-01-01", home: "A", away: "B", ht: { home: 1, away: 0 }, ft: { home: 2, away: 1 } });
  }
});

test("strict-prior removes target/future rows and deduplicates overlapping streams", () => {
  const future = { ...nested, id: "2", matchDate: "2025-02-01" };
  const evidence = strictPriorEvidence({ fixtures: [nested, future] }, { data: [flat] }, { rows: [strings] }, "2025-02-01");
  assert.deepEqual(evidence.counts, { homeFixtures: 1, awayFixtures: 1, h2hFixtures: 1, uniqueCanonical: 1, htCoverage: 1, ftCoverage: 1 });
});

test("frozen market definitions and zero-hit Bayesian smoothing remain intact", () => {
  const row = normalizeFixtures([{ ...nested, ht: "2-1", ft: "5-2" }])[0];
  assert.deepEqual(MARKET_CODES.map((market) => marketHit(row, market)), [true, true, false, true]);
  const prediction = buildPrediction({ home: "A", away: "B", targetDate: "2025-02-01", homePayload: [nested], awayPayload: [], h2hPayload: [], language: "en" });
  for (const market of MARKET_CODES) assert.ok(prediction.markets[market].smoothedRate > 0);
});

test("native prediction is complete, localized, covered and six-target normalized", () => {
  const rows = Array.from({ length: 44 }, (_, index) => ({ ...nested, id: String(index), matchDate: `2024-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`, homeTeam: index % 2 ? "A" : "C", awayTeam: index % 2 ? "D" : "B" }));
  const result = buildPrediction({ home: "A", away: "B", targetDate: "2025-01-01", homePayload: rows.slice(0, 21), awayPayload: rows.slice(21, 42), h2hPayload: rows.slice(42), language: "zh" });
  assert.equal(result.language, "zh");
  assert.equal(result.evidence.htCoverage, 44);
  assert.equal(result.evidence.ftCoverage, 44);
  for (const market of MARKET_CODES) for (const key of ["methodA", "methodB", "final", "confidence", "hits", "eligible", "rawRate", "smoothedRate", "supportingFactors", "opposingFactors"]) assert.ok(key in result.markets[market]);
  for (const side of ["ht","ft"]) {
    assert.equal(result.scoreline[side].methodA.length,3);
    assert.equal(result.scoreline[side].methodB.length,3);
    assert.equal(result.scoreline[side].final.length,3);
    assert.ok(result.scoreline[side].final.reduce((sum,row)=>sum+row.probability,0)<=1);
  }
  assert.equal(result.scoreline.futureSix.version,"CFI_FUTURE_SIX_SCORELINE_V0.1");
  assert.equal(result.ranking.length, 6);
  assert.equal(result.localized.probabilityUnit, "0..1");
});

test("scoreline intensities use target-team goals and opponent concessions across mixed home-away history", () => {
  const homeHistory = [
    { id: "h1", matchDate: "2025-01-01", homeTeam: "HJK", awayTeam: "X", ht: "1-0", ft: "2-0" },
    { id: "h2", matchDate: "2025-01-02", homeTeam: "Y", awayTeam: "HJK", ht: "5-1", ft: "8-2" },
  ];
  const awayHistory = [
    { id: "a1", matchDate: "2025-01-01", homeTeam: "Jaro", awayTeam: "Z", ht: "0-4", ft: "1-7" },
    { id: "a2", matchDate: "2025-01-02", homeTeam: "W", awayTeam: "Jaro", ht: "3-0", ft: "6-1" },
  ];
  const result = buildPrediction({ home: "HJK", away: "Jaro", targetDate: "2025-02-01", homePayload: homeHistory, awayPayload: awayHistory, h2hPayload: [], language: "en" });
  assert.ok(result.scoreline.expectedGoals.htHome > 1 && result.scoreline.expectedGoals.htHome < 4);
  assert.ok(result.scoreline.expectedGoals.ftHome > 2 && result.scoreline.expectedGoals.ftHome < 5);
  assert.ok(result.scoreline.expectedGoals.htAway >= 0 && result.scoreline.expectedGoals.htAway < 3);
  assert.ok(result.scoreline.expectedGoals.ftAway > 0 && result.scoreline.expectedGoals.ftAway < 5);
  assert.notEqual(result.scoreline.expectedGoals.ftHome, 8);
  assert.notEqual(result.scoreline.expectedGoals.ftAway, 7);
  assert.ok(result.scoreline.futureSix.intensity.ftHome > 0);
  assert.ok(result.scoreline.futureSix.intensity.ftAway > 0);
});

test("Young Violets regression has 44/44 coverage without lambda-floor artifacts", () => {
  const rows = Array.from({ length: 44 }, (_, index) => ({ ...nested, id: String(index), matchDate: `2024-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`, homeTeam: index < 21 ? "Young Violets Austria Wien" : "Opponent", awayTeam: index < 21 ? "Opponent" : "SV Austria Salzburg", ht: index % 2 ? "1-0" : "0-1", ft: index % 3 ? "2-1" : "1-2" }));
  const result = buildPrediction({ home: "Young Violets Austria Wien", away: "SV Austria Salzburg", targetDate: "2026-08-15", homePayload: rows.slice(0, 21), awayPayload: rows.slice(21, 42), h2hPayload: rows.slice(42), language: "vi" });
  assert.equal(result.evidence.htCoverage, 44); assert.equal(result.evidence.ftCoverage, 44);
  assert.ok(result.scoreline.expectedGoals.htHome > 0.08); assert.ok(result.scoreline.expectedGoals.ftAway > 0.08);
  for (const market of MARKET_CODES) assert.ok(Number.isFinite(result.markets[market].final));
});

test("missing scores remain missing and are excluded from eligible denominators", () => {
  const missing = { ...nested, id: "missing", ht: null, ft: null };
  const result = buildPrediction({ home: "A", away: "B", targetDate: "2025-02-01", homePayload: [missing], awayPayload: [], h2hPayload: [] });
  assert.equal(result.evidence.htCoverage, 0); assert.equal(result.evidence.ftCoverage, 0);
  assert.equal(result.markets["3+ HT"].eligible, 0); assert.equal(result.markets["7+ FT"].eligible, 0);
});

test("strict-prior walk-forward backtest reports A, B and final Brier scores", () => {
  const rows = Array.from({ length: 24 }, (_, index) => normalizeFixtures([{ ...nested, id: String(index), matchDate: `2024-01-${String(index + 1).padStart(2, "0")}`, ft: index % 3 ? "2-1" : "5-2" }])[0]);
  const report = walkForwardBacktest(rows);
  assert.equal(report.evaluatedMatches, 16);
  for (const market of MARKET_CODES) for (const key of ["prevalence", "brierMethodA", "brierMethodB", "brierFinal"]) assert.ok(key in report.markets[market]);
});
