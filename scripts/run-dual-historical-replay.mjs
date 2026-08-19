import { replayDualHistorical, persistHistoricalEvaluations } from "../src/learning/dual-historical-replay.ts";

const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const persist = process.argv.includes("--persist");
if (!base || !secret) {
  console.error("BLOCKED: SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required.");
  process.exit(2);
}
const rest = `${base}/rest/v1`;
const headers = { apikey: secret, authorization: `Bearer ${secret}`, accept: "application/json" };

async function request(path, init = {}) {
  const response = await fetch(rest + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response;
}

async function canonicalCount() {
  const response = await request("/fixtures?select=fixture_id&limit=1", { method: "HEAD", headers: { Prefer: "count=exact" } });
  const range = response.headers.get("content-range") ?? "";
  return Number(range.split("/")[1]);
}

async function loadTeams(pageSize = 500) {
  const teams = new Map();
  let cursor = null;
  for (;;) {
    const params = new URLSearchParams({ select: "team_id,canonical_name", order: "team_id.asc", limit: String(pageSize) });
    if (cursor) params.set("team_id", `gt.${cursor}`);
    const rows = await (await request(`/teams?${params}`)).json();
    for (const row of rows) teams.set(row.team_id, row.canonical_name);
    if (rows.length < pageSize) break;
    cursor = rows.at(-1).team_id;
  }
  return teams;
}

async function loadFixtures(teams, pageSize = 500) {
  const fixtures = [];
  let cursor = null;
  for (;;) {
    const params = new URLSearchParams({
      select: "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away",
      order: "match_date.asc,fixture_id.asc",
      limit: String(pageSize),
    });
    if (cursor) params.set("or", `(match_date.gt.${cursor.matchDate},and(match_date.eq.${cursor.matchDate},fixture_id.gt.${cursor.fixtureId}))`);
    const rows = await (await request(`/fixtures?${params}`)).json();
    for (const row of rows) fixtures.push({
      id: row.fixture_id,
      matchDate: row.match_date,
      homeTeam: teams.get(row.home_team_id) ?? `UNKNOWN:${row.home_team_id}`,
      awayTeam: teams.get(row.away_team_id) ?? `UNKNOWN:${row.away_team_id}`,
      ht: row.ht_home === null || row.ht_away === null ? null : { home: row.ht_home, away: row.ht_away },
      ft: row.ft_home === null || row.ft_away === null ? null : { home: row.ft_home, away: row.ft_away },
      competitionId: row.competition_id ?? null,
      segment: row.segment ?? null,
    });
    if (rows.length < pageSize) break;
    const last = rows.at(-1);
    cursor = { matchDate: last.match_date, fixtureId: last.fixture_id };
  }
  return fixtures;
}

function report(result, persistence, before, after) {
  const a = result.learners.historicalProduction, b = result.learners.futureSix;
  return {
    report: "CFI HISTORICAL DUAL MODEL REPORT",
    eligibleFixtures: result.evaluatedFixtures,
    modelAEvaluated: a.sampleCount,
    modelBEvaluated: b.sampleCount,
    markets: Object.fromEntries(Object.keys(a.markets).map((market) => [market, {
      modelABrier: a.markets[market].brier,
      modelBBrier: b.markets[market].brier,
      winner: result.scoreboard.scopes.GLOBAL.ALL[market].winner,
    }])),
    top3HT: { modelAAccuracy: a.top3HTAccuracy, modelBAccuracy: "NOT_YET_MODELED" },
    top3FT: { modelAAccuracy: a.top3FTAccuracy, modelBAccuracy: "NOT_YET_MODELED" },
    segments: Object.fromEntries(Object.entries(result.scoreboard.scopes).filter(([key]) => key.startsWith("SEGMENT:"))),
    strictPrior: result.strictPrior,
    pagination: "KEYSET_COMPLETE",
    idempotency: persistence,
    canonicalBefore: before,
    canonicalAfter: after,
    canonicalMutations: after - before,
  };
}

const before = await canonicalCount();
const teams = await loadTeams();
const fixtures = await loadFixtures(teams);
const result = replayDualHistorical(fixtures);
let persistence = { mode: "SAFE_READ_EVALUATION", attempted: 0, inserted: 0, duplicateCompatible: 0, canonicalFixtureMutations: 0 };
if (persist) {
  persistence = { mode: "APPEND_ONLY_EVALUATION", ...(await persistHistoricalEvaluations(result.evaluations, async (rows) => {
    const response = await request("/cfi_historical_model_evaluations?on_conflict=fixture_id,model_type,model_version,replay_version", {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=headers-only" },
      body: JSON.stringify(rows),
    });
    const range = response.headers.get("content-range");
    return { inserted: range ? Number(range.split("-").at(-1)?.split("/")[0] ?? -1) + 1 : rows.length };
  })) };
}
const after = await canonicalCount();
const output = report(result, persistence, before, after);
console.log(JSON.stringify(output, null, 2));
if (after !== before) process.exitCode = 3;
