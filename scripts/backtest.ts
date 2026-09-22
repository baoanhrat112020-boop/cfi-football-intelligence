// CFI backtest framework — OPEN_ISSUES.md #2d.
// Deno self-contained script: chạy fixture lịch sử qua /api/predict, đo Brier/log loss/scoreline hit.
//
// GIẢ ĐỊNH (verify qua information_schema, khác context đề bài):
//   fixtures dùng ft_home/ft_away/ht_home/ht_away (không phải fthg/ftag/hthg/htag), không có cột "league"
//   (dùng competition_key/competition_name/country thay thế).
//   outputV3 không có field "markets{...}" — 4 market nằm trong outputV3.champion.thresholds
//   (mảng Card {market, probability, ...}), lấy theo scoreline.ts đã đọc.
//   SUPABASE_SERVICE_KEY chỉ là REST/PostgREST key, không chạy được DDL — "auto-create table" thực hiện
//   bằng cách: thử INSERT, nếu lỗi bảng chưa tồn tại thì in CREATE TABLE để chạy tay 1 lần qua SQL Editor.

import { createClient } from "npm:@supabase/supabase-js@2";

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
    }
  }
  return out;
}
const args = parseArgs(Deno.args);
const FROM = String(args.from || "");
const TO = String(args.to || "");
const LIMIT = Number(args.limit || 100);
const CONCURRENCY = Number(args.concurrency || 5);
const DRY_RUN = Boolean(args["dry-run"]);
const OUTPUT_PATH = String(args.output || "backtest-result.csv");
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error("Cần --from YYYY-MM-DD --to YYYY-MM-DD");
  Deno.exit(1);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
const CFI_API_BASE = Deno.env.get("CFI_API_BASE") || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CFI_API_BASE) {
  console.error("Thiếu env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CFI_API_BASE");
  Deno.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;
type Market = typeof MARKETS[number];

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// retry với exponential backoff; KHÔNG retry khi 422 (fail-closed hợp lệ, không phải lỗi mạng)
async function fetchWithRetry(url: string, opts: RequestInit, retries = 3, baseDelay = 500): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 422) return res;
      if (!res.ok && attempt < retries) { await sleep(baseDelay * 2 ** attempt); continue; }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) throw e;
      await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function pool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

type FixtureRow = {
  fixture_id: string; match_date: string; ft_home: number; ft_away: number; ht_home: number; ht_away: number;
  competition_key: string | null; competition_name: string | null;
  home: { canonical_name: string } | null; away: { canonical_name: string } | null;
};

type RowResult = {
  fixture_id: string; match_date: string; home: string; away: string; competition_key: string;
  ok: boolean; skip_reason: string | null;
  actualTop1FT: string; predTop1FT: string; top1Hit: number; top3Hit: number;
  markets: Record<Market, { p: number | null; actual: number; brier: number | null; logloss: number | null }>;
};

function clip(p: number) { return Math.min(1 - 1e-15, Math.max(1e-15, p)); }
function actualOutcomes(f: FixtureRow): Record<Market, number> {
  return {
    "3+ HT": (f.ht_home + f.ht_away) >= 3 ? 1 : 0,
    "7+ FT": (f.ft_home + f.ft_away) >= 7 ? 1 : 0,
    "Other HT": Math.max(f.ht_home, f.ht_away) >= 4 ? 1 : 0,
    "Other FT": Math.max(f.ft_home, f.ft_away) >= 5 ? 1 : 0,
  };
}

async function runFixture(f: FixtureRow): Promise<RowResult> {
  const home = f.home?.canonical_name || "", away = f.away?.canonical_name || "";
  const comp = f.competition_key || f.competition_name || "UNKNOWN";
  const base: RowResult = {
    fixture_id: f.fixture_id, match_date: f.match_date, home, away, competition_key: comp,
    ok: false, skip_reason: null, actualTop1FT: `${f.ft_home}-${f.ft_away}`, predTop1FT: "",
    top1Hit: 0, top3Hit: 0,
    markets: Object.fromEntries(MARKETS.map((m) => [m, { p: null, actual: 0, brier: null, logloss: null }])) as RowResult["markets"],
  };
  if (!home || !away) { base.skip_reason = "missing_team_name"; return base; }

  let res: Response;
  try {
    res = await fetchWithRetry(`${CFI_API_BASE}/api/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ home, away, target_date: f.match_date, language: "vi", input_mode: "SINGLE_MATCH", response_mode: "full" }),
    });
  } catch (e) { base.skip_reason = `network_error:${String((e as Error).message || e)}`; return base; }

  if (res.status === 422) { base.skip_reason = "422_insufficient_evidence"; return base; }
  if (!res.ok) { base.skip_reason = `http_${res.status}`; return base; }

  let body: any;
  try { body = await res.json(); } catch { base.skip_reason = "non_json_response"; return base; }
  const out = body?.outputV3;
  if (!out) { base.skip_reason = "no_outputV3"; return base; }

  const thresholds = Array.isArray(out?.champion?.thresholds) ? out.champion.thresholds : [];
  const actual = actualOutcomes(f);
  for (const m of MARKETS) {
    const card = thresholds.find((x: any) => x.market === m);
    const p = Number.isFinite(Number(card?.probability)) ? Number(card.probability) : null;
    const a = actual[m];
    base.markets[m] = { p, actual: a, brier: p === null ? null : (p - a) ** 2, logloss: p === null ? null : -(a * Math.log(clip(p)) + (1 - a) * Math.log(clip(1 - p))) };
  }

  const top3FT = Array.isArray(out?.champion?.top3FT) ? out.champion.top3FT : [];
  base.predTop1FT = top3FT[0]?.score || "";
  base.top1Hit = base.predTop1FT === base.actualTop1FT ? 1 : 0;
  base.top3Hit = top3FT.some((x: any) => x?.score === base.actualTop1FT) ? 1 : 0;
  base.ok = true;
  return base;
}

async function loadFixtures(): Promise<FixtureRow[]> {
  const { data, error } = await db.from("fixtures")
    .select("fixture_id,match_date,ft_home,ft_away,ht_home,ht_away,competition_key,competition_name,home:teams!fixtures_home_team_id_fkey(canonical_name),away:teams!fixtures_away_team_id_fkey(canonical_name)")
    .gte("match_date", FROM).lte("match_date", TO)
    .not("ft_home", "is", null).not("ft_away", "is", null)
    .not("ht_home", "is", null).not("ht_away", "is", null)
    .order("match_date", { ascending: true })
    .limit(LIMIT);
  if (error) throw new Error(`load fixtures failed: ${error.message}`);
  return (data || []) as unknown as FixtureRow[];
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

function aggregate(rows: RowResult[]) {
  const ok = rows.filter((r) => r.ok);
  const perMarket: Record<Market, { brier: number | null; logloss: number | null }> = {} as any;
  for (const m of MARKETS) {
    perMarket[m] = {
      brier: mean(ok.map((r) => r.markets[m].brier).filter((x): x is number => x !== null)),
      logloss: mean(ok.map((r) => r.markets[m].logloss).filter((x): x is number => x !== null)),
    };
  }
  const top1 = mean(ok.map((r) => r.top1Hit));
  const top3 = mean(ok.map((r) => r.top3Hit));
  const perLeague = new Map<string, { n: number; top1: number; top3: number }>();
  for (const r of ok) {
    const c = perLeague.get(r.competition_key) || { n: 0, top1: 0, top3: 0 };
    c.n++; c.top1 += r.top1Hit; c.top3 += r.top3Hit;
    perLeague.set(r.competition_key, c);
  }
  return { n_fixtures: rows.length, n_ok: ok.length, n_skip: rows.length - ok.length, perMarket, top1, top3, perLeague };
}

function toCsv(rows: RowResult[]): string {
  const header = ["fixture_id", "match_date", "home", "away", "competition_key", "ok", "skip_reason", "actual_top1_ft", "pred_top1_ft", "top1_hit", "top3_hit",
    ...MARKETS.flatMap((m) => [`${m}_p`, `${m}_actual`, `${m}_brier`, `${m}_logloss`])];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [r.fixture_id, r.match_date, r.home, r.away, r.competition_key, r.ok ? "1" : "0", r.skip_reason || "",
      r.actualTop1FT, r.predTop1FT, String(r.top1Hit), String(r.top3Hit),
      ...MARKETS.flatMap((m) => [r.markets[m].p ?? "", r.markets[m].actual, r.markets[m].brier ?? "", r.markets[m].logloss ?? ""])];
    lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS cfi_backtest_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  n_fixtures INT NOT NULL,
  n_ok INT NOT NULL,
  n_skip INT NOT NULL,
  brier_3ht NUMERIC, brier_7ft NUMERIC, brier_other_ht NUMERIC, brier_other_ft NUMERIC,
  logloss_3ht NUMERIC, logloss_7ft NUMERIC, logloss_other_ht NUMERIC, logloss_other_ft NUMERIC,
  top1_hit_rate NUMERIC, top3_hit_rate NUMERIC,
  config JSONB
);`;

async function saveRun(agg: ReturnType<typeof aggregate>) {
  const row = {
    from_date: FROM, to_date: TO, n_fixtures: agg.n_fixtures, n_ok: agg.n_ok, n_skip: agg.n_skip,
    brier_3ht: agg.perMarket["3+ HT"].brier, brier_7ft: agg.perMarket["7+ FT"].brier,
    brier_other_ht: agg.perMarket["Other HT"].brier, brier_other_ft: agg.perMarket["Other FT"].brier,
    logloss_3ht: agg.perMarket["3+ HT"].logloss, logloss_7ft: agg.perMarket["7+ FT"].logloss,
    logloss_other_ht: agg.perMarket["Other HT"].logloss, logloss_other_ft: agg.perMarket["Other FT"].logloss,
    top1_hit_rate: agg.top1, top3_hit_rate: agg.top3,
    config: { from: FROM, to: TO, limit: LIMIT, concurrency: CONCURRENCY },
  };
  const { error } = await db.from("cfi_backtest_runs").insert(row);
  if (error) {
    console.warn("Không insert được cfi_backtest_runs (có thể bảng chưa tồn tại). Chạy SQL này 1 lần qua Supabase SQL Editor rồi retry:");
    console.warn(CREATE_TABLE_SQL);
    console.warn("Lỗi gốc:", error.message);
  } else {
    console.log("Đã lưu run vào cfi_backtest_runs.");
  }
}

async function main() {
  console.log(`Loading fixtures ${FROM} -> ${TO}, limit=${LIMIT}...`);
  const fixtures = await loadFixtures();
  console.log(`Tìm thấy ${fixtures.length} fixture đủ điểm số. Bắt đầu backtest (concurrency=${CONCURRENCY})...`);

  const rows = await pool(fixtures, CONCURRENCY, (f) => runFixture(f));
  const agg = aggregate(rows);

  console.log("\n=== SUMMARY ===");
  console.log(`n_fixtures=${agg.n_fixtures} n_ok=${agg.n_ok} n_skip=${agg.n_skip}`);
  for (const m of MARKETS) {
    console.log(`${m}: brier=${agg.perMarket[m].brier?.toFixed(4) ?? "—"} logloss=${agg.perMarket[m].logloss?.toFixed(4) ?? "—"}`);
  }
  console.log(`Top-1 FT hit rate: ${agg.top1 !== null ? (agg.top1 * 100).toFixed(1) + "%" : "—"}`);
  console.log(`Top-3 FT hit rate: ${agg.top3 !== null ? (agg.top3 * 100).toFixed(1) + "%" : "—"}`);
  console.log("\n=== PER LEAGUE ===");
  for (const [league, s] of agg.perLeague) {
    console.log(`${league}: n=${s.n} top1=${(s.top1 / s.n * 100).toFixed(1)}% top3=${(s.top3 / s.n * 100).toFixed(1)}%`);
  }

  const skipReasons = new Map<string, number>();
  for (const r of rows) if (!r.ok && r.skip_reason) skipReasons.set(r.skip_reason, (skipReasons.get(r.skip_reason) || 0) + 1);
  if (skipReasons.size) {
    console.log("\n=== SKIP REASONS ===");
    for (const [reason, n] of skipReasons) console.log(`${reason}: ${n}`);
  }

  await Deno.writeTextFile(OUTPUT_PATH, toCsv(rows));
  console.log(`\nĐã export CSV: ${OUTPUT_PATH}`);

  if (!DRY_RUN) await saveRun(agg);
  else console.log("--dry-run: không lưu vào cfi_backtest_runs.");
}

await main();
