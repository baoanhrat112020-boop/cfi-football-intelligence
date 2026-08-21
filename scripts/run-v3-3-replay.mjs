import { runV3_3Replay, V3_3_SOURCE_VIEW, V3_3_STAGE_TABLE, V3_3_RESEARCH_CUTOFF } from "../src/learning/v3-3-replay-runner.ts";

const SUPABASE_URL = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
const PAGE_SIZE = Math.max(100, Number(process.env.CFI_REPLAY_PAGE_SIZE ?? 1000));
const WRITE_BATCH = Math.max(50, Number(process.env.CFI_REPLAY_WRITE_BATCH ?? 500));
const MIN_PRIOR = Math.max(1, Number(process.env.CFI_REPLAY_MIN_PRIOR ?? 10));
const LIMIT = process.env.CFI_REPLAY_LIMIT ? Math.max(1, Number(process.env.CFI_REPLAY_LIMIT)) : null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("V3.3 replay requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
};

async function loadFixtures() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const end = offset + PAGE_SIZE - 1;
    const url = `${SUPABASE_URL}/rest/v1/${V3_3_SOURCE_VIEW}?select=id,matchDate,homeTeam,awayTeam,ht,ft,competitionSegment&order=matchDate.asc,id.asc`;
    const response = await fetch(url, { headers: { ...headers, Range: `${offset}-${end}` } });
    if (!response.ok) throw new Error(`SOURCE_READ_FAILED:${response.status}:${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (LIMIT !== null && rows.length >= LIMIT) return rows.slice(0, LIMIT);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function upsertRows(rows) {
  const conflict = "fixture_id,model_type,model_version,replay_version,market";
  const url = `${SUPABASE_URL}/rest/v1/${V3_3_STAGE_TABLE}?on_conflict=${encodeURIComponent(conflict)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`STAGE_UPSERT_FAILED:${response.status}:${await response.text()}`);
}

const startedAt = new Date().toISOString();
console.log(JSON.stringify({ event: "CFI_V3_3_REPLAY_START", startedAt, cutoff: V3_3_RESEARCH_CUTOFF, minPrior: MIN_PRIOR, limit: LIMIT, pageSize: PAGE_SIZE, writeBatch: WRITE_BATCH }));
const result = await runV3_3Replay({ loadFixtures, upsertRows, minPrior: MIN_PRIOR, batchSize: WRITE_BATCH });
console.log(JSON.stringify({ event: "CFI_V3_3_REPLAY_COMPLETE", startedAt, finishedAt: new Date().toISOString(), ...result }, null, 2));
