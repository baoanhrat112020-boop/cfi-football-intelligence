// CFI backtest — chạy server-side trong Supabase (không bị sandbox chặn egress).
// GIẢ ĐỊNH: schema fixtures dùng ft_home/ft_away/ht_home/ht_away, competition_key là cột text
// (không có FK league riêng) — đã verify qua information_schema ở bước trước.
// POST { from, to, limit, concurrency } -> JSON summary + lưu vào cfi_backtest_runs.

import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

const MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;
type Market = typeof MARKETS[number];

const clip = (p: number) => Math.min(1 - 1e-15, Math.max(1e-15, p));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function actualOutcomes(f: any): Record<Market, number> {
  return {
    "3+ HT": (f.ht_home + f.ht_away) >= 3 ? 1 : 0,
    "7+ FT": (f.ft_home + f.ft_away) >= 7 ? 1 : 0,
    "Other HT": Math.max(f.ht_home, f.ht_away) >= 4 ? 1 : 0,
    "Other FT": Math.max(f.ft_home, f.ft_away) >= 5 ? 1 : 0,
  };
}

// retry với exponential backoff; KHÔNG retry khi 422 (fail-closed hợp lệ)
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

async function runFixture(f: any, cfiApiBase: string) {
  const home = f.home?.canonical_name || "", away = f.away?.canonical_name || "";
  const comp = f.competition_key || f.competition_name || "UNKNOWN";
  const base: any = {
    fixture_id: f.fixture_id, match_date: f.match_date, home, away, competition_key: comp,
    ok: false, skip_reason: null, actualTop1FT: `${f.ft_home}-${f.ft_away}`, predTop1FT: "",
    top1Hit: 0, top3Hit: 0,
    markets: Object.fromEntries(MARKETS.map((m) => [m, { p: null, actual: 0, brier: null, logloss: null }])),
  };
  if (!home || !away) { base.skip_reason = "missing_team_name"; return base; }

  let res: Response;
  try {
    res = await fetchWithRetry(`${cfiApiBase}/api/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ home, away, target_date: f.match_date, language: "vi", input_mode: "SINGLE_MATCH", response_mode: "full" }),
    });
  } catch (e) { base.skip_reason = `network_error:${String((e as Error)?.message || e)}`; return base; }

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

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

function aggregate(rows: any[]) {
  const ok = rows.filter((r) => r.ok);
  const perMarket: Record<Market, { brier: number | null; logloss: number | null }> = {} as any;
  for (const m of MARKETS) {
    perMarket[m] = {
      brier: mean(ok.map((r) => r.markets[m].brier).filter((x: any) => x !== null)),
      logloss: mean(ok.map((r) => r.markets[m].logloss).filter((x: any) => x !== null)),
    };
  }
  const top1 = mean(ok.map((r) => r.top1Hit));
  const top3 = mean(ok.map((r) => r.top3Hit));
  const perCompetition: Record<string, { n: number; top1: number; top3: number }> = {};
  for (const r of ok) {
    const c = perCompetition[r.competition_key] || { n: 0, top1: 0, top3: 0 };
    c.n++; c.top1 += r.top1Hit; c.top3 += r.top3Hit;
    perCompetition[r.competition_key] = c;
  }
  return { n_fixtures: rows.length, n_ok: ok.length, n_skip: rows.length - ok.length, perMarket, top1, top3, perCompetition };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "INVALID_REQUEST", error: "METHOD_NOT_ALLOWED" }, 405);
  let input: any;
  try { input = await req.json(); } catch { return json({ status: "INVALID_REQUEST", error: "INVALID_JSON" }, 400); }

  const from = String(input?.from || ""), to = String(input?.to || "");
  const limit = Math.max(1, Math.min(2000, Number(input?.limit) || 100));
  const concurrency = Math.max(1, Math.min(20, Number(input?.concurrency) || 5));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ status: "INVALID_REQUEST", error: "FROM_TO_REQUIRED_YYYY_MM_DD" }, 400);
  }

  // SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-inject trong Edge Function, không hardcode.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const CFI_API_BASE = Deno.env.get("CFI_API_BASE") || "https://cfi-football-intelligence.baoanhrat112020.workers.dev";
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ status: "CONFIG_REQUIRED", error: "SERVICE_ROLE_UNAVAILABLE" }, 503);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: fixtures, error } = await db.from("fixtures")
    .select("fixture_id,match_date,ft_home,ft_away,ht_home,ht_away,competition_key,competition_name,home:teams!fixtures_home_team_id_fkey(canonical_name),away:teams!fixtures_away_team_id_fkey(canonical_name)")
    .gte("match_date", from).lte("match_date", to)
    .not("ft_home", "is", null).not("ft_away", "is", null)
    .not("ht_home", "is", null).not("ht_away", "is", null)
    .order("match_date", { ascending: true })
    .limit(limit);
  if (error) return json({ status: "UPSTREAM_ERROR", error: "FIXTURES_QUERY_FAILED", message: error.message }, 502);

  // fail-closed per-fixture: chạy theo chunk (Promise.all), lỗi 1 fixture chỉ skip fixture đó
  const rows: any[] = [];
  const list = fixtures || [];
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((f: any) => runFixture(f, CFI_API_BASE)));
    rows.push(...chunkResults);
  }

  const agg = aggregate(rows);
  const skipReasons: Record<string, number> = {};
  for (const r of rows) if (!r.ok && r.skip_reason) skipReasons[r.skip_reason] = (skipReasons[r.skip_reason] || 0) + 1;

  const runRow = {
    from_date: from, to_date: to, n_fixtures: agg.n_fixtures, n_ok: agg.n_ok, n_skip: agg.n_skip,
    brier_3ht: agg.perMarket["3+ HT"].brier, brier_7ft: agg.perMarket["7+ FT"].brier,
    brier_other_ht: agg.perMarket["Other HT"].brier, brier_other_ft: agg.perMarket["Other FT"].brier,
    logloss_3ht: agg.perMarket["3+ HT"].logloss, logloss_7ft: agg.perMarket["7+ FT"].logloss,
    logloss_other_ht: agg.perMarket["Other HT"].logloss, logloss_other_ft: agg.perMarket["Other FT"].logloss,
    top1_hit_rate: agg.top1, top3_hit_rate: agg.top3,
    config: { from, to, limit, concurrency },
  };
  const { data: inserted, error: insertErr } = await db.from("cfi_backtest_runs").insert(runRow).select("id").single();

  return json({
    status: "OK",
    run_id: inserted?.id ?? null,
    saved: !insertErr,
    saveError: insertErr?.message ?? null,
    summary: {
      n_fixtures: agg.n_fixtures, n_ok: agg.n_ok, n_skip: agg.n_skip,
      perMarket: agg.perMarket, top1_hit_rate: agg.top1, top3_hit_rate: agg.top3,
      perCompetition: agg.perCompetition, skipReasons,
    },
    rows: rows.map((r) => ({ fixture_id: r.fixture_id, match_date: r.match_date, home: r.home, away: r.away, competition_key: r.competition_key, ok: r.ok, skip_reason: r.skip_reason, top1Hit: r.top1Hit, top3Hit: r.top3Hit })),
  });
});
