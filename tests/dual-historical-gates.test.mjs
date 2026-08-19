import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DUAL_REPLAY_VERSION,
  keysetPage,
  loadCanonicalCorpus,
  persistHistoricalEvaluations,
  replayDualHistorical,
} from "../src/learning/dual-historical-replay.ts";
import { buildPrediction, FINAL_VERSION } from "../src/prediction/final-engine.ts";

function corpus(count = 45) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2020, 0, 1 + index));
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      matchDate: date.toISOString().slice(0, 10),
      competitionId: index % 2 ? "E0" : "D1",
      segment: index % 2 ? "ELITE_PRO" : "MID_PRO",
      homeTeam: index % 2 ? "Beta" : "Alpha",
      awayTeam: index % 2 ? "Alpha" : "Beta",
      ht: { home: index % 5 === 0 ? 2 : 1, away: index % 7 === 0 ? 1 : 0 },
      ft: { home: index % 9 === 0 ? 6 : 2, away: index % 11 === 0 ? 2 : 1 },
    };
  });
}

test("future fixture insertion cannot alter earlier Model A or B evaluation", () => {
  const rows = corpus();
  const before = replayDualHistorical(rows, { minPrior: 8 });
  const after = replayDualHistorical([...rows, {
    ...rows.at(-1),
    id: "00000000-0000-4000-8000-999999999999",
    matchDate: "2099-01-01",
    ht: { home: 99, away: 0 },
    ft: { home: 100, away: 0 },
  }], { minPrior: 8 });
  assert.deepEqual(after.evaluations.filter((row) => row.targetDate < "2099-01-01"), before.evaluations);
});

test("unsorted and duplicate canonical input is deterministic", () => {
  const rows = corpus();
  const expected = replayDualHistorical(rows, { minPrior: 8 });
  const actual = replayDualHistorical([rows[12], ...rows.toReversed(), { ...rows[12], id: "zz-duplicate" }], { minPrior: 8 });
  assert.deepEqual(actual, expected);
});

test("missing HT and FT remain ineligible only for dependent targets", () => {
  const rows = corpus();
  rows[20].ht = null;
  rows[21].ft = null;
  const result = replayDualHistorical(rows, { minPrior: 8 });
  for (const evaluation of result.evaluations.filter((row) => row.fixtureId === rows[20].id)) {
    assert.equal(evaluation.markets["3+ HT"].actualBoolean, null);
    assert.equal(evaluation.markets["Other HT"].brier, null);
    assert.notEqual(evaluation.markets["7+ FT"].brier, null);
  }
  for (const evaluation of result.evaluations.filter((row) => row.fixtureId === rows[21].id)) {
    assert.equal(evaluation.markets["7+ FT"].actualBoolean, null);
    assert.equal(evaluation.markets["Other FT"].brier, null);
    assert.notEqual(evaluation.markets["3+ HT"].brier, null);
  }
});

test("timestamp input normalizes to one UTC-independent match date", () => {
  const rows = corpus();
  const timestamped = rows.map((row) => ({ ...row, match_date: row.matchDate + "T23:30:00-05:00", matchDate: undefined }));
  const result = replayDualHistorical(timestamped, { minPrior: 8 });
  assert.equal(result.fixtureCount, rows.length);
  assert.equal(result.evaluations[0].targetDate, rows[8].matchDate);
});

test("Model A output and version are unchanged when Model B is evaluated", () => {
  const rows = corpus();
  const result = replayDualHistorical(rows, { minPrior: 8 });
  const target = rows[20];
  const prior = rows.filter((row) => row.matchDate < target.matchDate);
  const prediction = buildPrediction({
    home: target.homeTeam,
    away: target.awayTeam,
    targetDate: target.matchDate,
    language: "en",
    homePayload: prior,
    awayPayload: prior,
    h2hPayload: prior,
  });
  const modelA = result.evaluations.find((row) => row.fixtureId === target.id && row.modelType === "HISTORICAL_PRODUCTION");
  assert.equal(modelA.modelVersion, FINAL_VERSION);
  for (const market of ["3+ HT", "7+ FT", "Other HT", "Other FT"]) {
    assert.equal(modelA.probabilities[market], prediction.markets[market].final);
  }
});

test("Model A/B metrics, segments, competition and venue contexts remain separate", () => {
  const result = replayDualHistorical(corpus(60), { minPrior: 8 });
  const a = result.evaluations.filter((row) => row.modelType === "HISTORICAL_PRODUCTION");
  const b = result.evaluations.filter((row) => row.modelType === "FUTURE_SIX_FACTORS");
  assert.equal(a.length, b.length);
  assert.ok(result.scoreboard.scopes["SEGMENT:ELITE_PRO"]);
  assert.ok(result.scoreboard.scopes["SEGMENT:MID_PRO"]);
  assert.ok(result.scoreboard.scopes["COMPETITION:E0"]);
  assert.ok(result.scoreboard.scopes["HOME:Alpha"]);
  assert.equal(result.scoreboard.futureSix.top3HTAccuracy, null);
  assert.equal(b[0].top3HT.status, "NOT_YET_MODELED");
  assert.ok(b[0].factors.GOAL_TEMPO.sampleSize >= 8);
  assert.equal(result.scoreboard.scopes.GLOBAL["25"]["3+ HT"].sampleCount, 25);
  assert.notEqual(result.scoreboard.scopes.GLOBAL.ALL["3+ HT"].winner, "INSUFFICIENT_SAMPLE");
});

test("keyset pagination traverses complete corpus beyond 1,000 without a capped query", async () => {
  const fixtures = corpus(1255);
  let calls = 0;
  const loaded = await loadCanonicalCorpus(async (cursor, limit) => {
    calls++;
    return keysetPage(fixtures, cursor, limit);
  }, 137);
  assert.equal(loaded.length, 1255);
  assert.ok(calls > 8);
  assert.deepEqual(new Set(loaded.map((row) => row.id)).size, 1255);
});

test("keyset loader rejects a non-advancing cursor", async () => {
  const cursor = { matchDate: "2026-01-01", fixtureId: "x" };
  await assert.rejects(
    loadCanonicalCorpus(async () => ({ rows: [], nextCursor: cursor }), 100),
    /NON_ADVANCING_CURSOR/,
  );
});

test("repeated replay keys match immutable database idempotency key", () => {
  const first = replayDualHistorical(corpus(), { minPrior: 8 });
  const second = replayDualHistorical(corpus(), { minPrior: 8 });
  assert.deepEqual(second.evaluations.map((row) => row.replayKey), first.evaluations.map((row) => row.replayKey));
  assert.ok(first.evaluations.every((row) =>
    row.replayKey === `${row.fixtureId}|${row.modelType}|${row.modelVersion}|${DUAL_REPLAY_VERSION}`));
});

test("persistence batching is idempotent and never mutates canonical fixtures", async () => {
  const replay = replayDualHistorical(corpus(), { minPrior: 8 });
  const keys = new Set();
  const sink = async (rows) => {
    let inserted = 0;
    for (const row of rows) {
      const key = [row.fixture_id, row.model_type, row.model_version, row.replay_version].join("|");
      if (!keys.has(key)) { keys.add(key); inserted++; }
    }
    return { inserted };
  };
  const first = await persistHistoricalEvaluations(replay.evaluations, sink, 13);
  const second = await persistHistoricalEvaluations(replay.evaluations, sink, 13);
  assert.equal(first.inserted, replay.evaluationRows);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicateCompatible, replay.evaluationRows);
  assert.equal(second.canonicalFixtureMutations, 0);
});

test("SQL storage is append-only, RLS-protected and cannot copy Future Six Top-3", async () => {
  const sql = await readFile(new URL("../supabase/sql/cfi_dual_historical_learning.sql", import.meta.url), "utf8");
  assert.match(sql, /primary key \(fixture_id, model_type, model_version, replay_version\)/i);
  assert.match(sql, /on conflict \(fixture_id, model_type, model_version, replay_version\) do nothing/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /NOT_YET_MODELED/);
  assert.doesNotMatch(sql, /update\s+public\.fixtures/i);
  assert.doesNotMatch(sql, /update\s+public\.cfi_prediction/i);
});
