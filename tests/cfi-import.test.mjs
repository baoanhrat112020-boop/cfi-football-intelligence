import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../config/sources.json" with { type: "json" };
import { parseFootballDataCsv, runBulkImport, selectSources, validateManifest } from "../supabase/functions/_shared/cfi-import-core.ts";
import { normalizeRefreshRequest } from "../supabase/functions/_shared/cfi-current-refresh.ts";

const header = "Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG";
const source = { id: "test", enabled: true, provider: "test", country: "England", league: "Test", season: "2025-26", url: "https://example.test/data.csv", format: "football-data-v1", current: true };

function regressionCsv(count = 380, start = 0) {
  const rows = Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return `01/08/25,Home ${index},Away ${index},2,1,1,0`;
  });
  return [header, ...rows].join("\n");
}

function canonicalBatchStore() {
  const records = new Set();
  return async (fixtures) => {
    const counters = { rows: fixtures.length, NEW: 0, DUPLICATE_COMPATIBLE: 0, COMPLEMENTARY: 0, CONFLICT: 0, REJECTED: 0, ERROR: 0 };
    for (const fixture of fixtures) {
      const key = `${fixture.matchDate}|${fixture.homeTeam}|${fixture.awayTeam}`;
      if (records.has(key)) counters.DUPLICATE_COMPATIBLE++;
      else { records.add(key); counters.NEW++; }
    }
    return { status: "OK", counters };
  };
}

test("manifest validates and covers multiple leagues, countries, and five seasons", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.ok(new Set(manifest.sources.map((item) => item.country)).size >= 3);
  assert.ok(new Set(manifest.sources.map((item) => item.season)).size >= 5);
  assert.throws(() => validateManifest({ version: 1, sources: [{ ...source, id: "x" }, { ...source, id: "x" }] }), /DUPLICATE_SOURCE_ID/);
});

test("E0 regression contract is idempotent for 380 rows", async () => {
  const upsertBatch = canonicalBatchStore();
  const testManifest = { version: 1, sources: [source] };
  const dependencies = { concurrency: 2, batchSize: 500, fetchText: async () => regressionCsv(), upsertBatch };
  const first = await runBulkImport(testManifest, {}, dependencies);
  assert.deepEqual({ rows: first.counters.rows, NEW: first.counters.NEW, ERROR: first.counters.ERROR }, { rows: 380, NEW: 380, ERROR: 0 });
  const second = await runBulkImport(testManifest, {}, dependencies);
  assert.deepEqual({ rows: second.counters.rows, NEW: second.counters.NEW, DUPLICATE_COMPATIBLE: second.counters.DUPLICATE_COMPATIBLE, ERROR: second.counters.ERROR }, { rows: 380, NEW: 0, DUPLICATE_COMPATIBLE: 380, ERROR: 0 });
});

test("blank, malformed, partial and impossible scores are rejected, never zero-filled", () => {
  const csv = [header,
    "01/08/25,A,B,2,1,1,0",
    "02/08/25,C,D,,,1,0",
    "bad,E,F,2,1,1,0",
    "03/08/25,G,H,1,0,2,0",
  ].join("\n");
  const parsed = parseFootballDataCsv(csv, source);
  assert.equal(parsed.fixtures.length, 1);
  assert.equal(parsed.rejected, 3);
  assert.equal(parsed.fixtures[0].ft.home, 2);
});

test("one failed source is isolated and checkpointed", async () => {
  const good = { ...source, id: "good", url: "https://example.test/good.csv" };
  const bad = { ...source, id: "bad", url: "https://example.test/bad.csv" };
  const result = await runBulkImport({ version: 1, sources: [good, bad] }, {}, {
    concurrency: 2,
    batchSize: 500,
    fetchText: async (url) => { if (url.includes("bad")) throw new Error("CSV_FETCH_FAILED:404"); return regressionCsv(1); },
    upsertBatch: canonicalBatchStore(),
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.counters.NEW, 1);
  assert.equal(result.counters.ERROR, 1);
  assert.deepEqual(result.checkpoint.completedSourceIds, ["good"]);
  assert.deepEqual(result.checkpoint.failedSourceIds, ["bad"]);
});

test("currentOnly refresh selects only current manifest sources", () => {
  const selected = selectSources(manifest, { currentOnly: true });
  assert.ok(selected.length > 0);
  assert.ok(selected.every((item) => item.current === true));
  assert.ok(selected.every((item) => item.enabled === true));
});

test("current-season refresh is idempotent and source growth adds only new rows", async () => {
  const upsertBatch = canonicalBatchStore();
  const testManifest = { version: 1, sources: [source] };
  let csv = regressionCsv(3);
  const dependencies = { concurrency: 1, batchSize: 500, fetchText: async () => csv, upsertBatch };

  const first = await runBulkImport(testManifest, { currentOnly: true }, dependencies);
  assert.equal(first.counters.NEW, 3);

  const same = await runBulkImport(testManifest, { currentOnly: true }, dependencies);
  assert.equal(same.counters.NEW, 0);
  assert.equal(same.counters.DUPLICATE_COMPATIBLE, 3);

  csv = [regressionCsv(3), regressionCsv(2, 3).split("\n").slice(1).join("\n")].join("\n");
  const grown = await runBulkImport(testManifest, { currentOnly: true }, dependencies);
  assert.equal(grown.counters.NEW, 2);
  assert.equal(grown.counters.DUPLICATE_COMPATIBLE, 3);
  assert.equal(grown.counters.ERROR, 0);
});

test("scheduler payload validation forces currentOnly and bounds concurrency", () => {
  assert.deepEqual(normalizeRefreshRequest({}), { concurrency: 3, filters: { currentOnly: true } });
  assert.deepEqual(normalizeRefreshRequest({ concurrency: 5, sourceIds: [" a ", "a", "b"] }), {
    concurrency: 5,
    filters: { currentOnly: true, sourceIds: ["a", "b"] },
  });
  assert.throws(() => normalizeRefreshRequest({ concurrency: 0 }), /INVALID_CONCURRENCY/);
  assert.throws(() => normalizeRefreshRequest({ concurrency: 6 }), /INVALID_CONCURRENCY/);
  assert.throws(() => normalizeRefreshRequest({ sourceIds: [""] }), /INVALID_SOURCE_IDS/);
  assert.throws(() => normalizeRefreshRequest([]), /INVALID_REFRESH_PAYLOAD/);
});
