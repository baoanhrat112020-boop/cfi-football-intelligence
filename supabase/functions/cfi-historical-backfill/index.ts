import { createClient } from "npm:@supabase/supabase-js@2";

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { "content-type": "application/json" },
});

const EXPANSION_VERSION = "CFI_BIGDB_SOURCE_EXPANSION_V1";
const ADAPTER_VERSION = "CFI_BIGDB_SOURCE_ADAPTER_V2_OPENFOOTBALL";

function expansionSources() {
  const out: any[] = [];
  const seasons = Array.from({ length: 11 }, (_, i) => {
    const y = 2015 + i;
    return { season: `${y}-${String(y + 1).slice(-2)}`, path: `${String(y).slice(-2)}${String(y + 1).slice(-2)}` };
  });
  const defs = [
    { country: "England", league: "Conference / National League", division_code: "EC" },
    { country: "Scotland", league: "Championship", division_code: "SC1" },
    { country: "Scotland", league: "League One", division_code: "SC2" },
    { country: "Scotland", league: "League Two", division_code: "SC3" },
  ];
  for (const d of defs) {
    for (const s of seasons) {
      const slug = `${d.country.toLowerCase()}-${d.division_code.toLowerCase()}-${s.season}`;
      out.push({ source_id: slug, provider: "football-data.co.uk", country: d.country, league: d.league, division_code: d.division_code, season: s.season, csv_url: `https://www.football-data.co.uk/mmz4281/${s.path}/${d.division_code}.csv`, status: "PENDING", attempts: 0 });
    }
  }
  return out;
}

async function ensureExpansionSources(db: any) {
  const rows = expansionSources();
  const ids = rows.map((x) => x.source_id);
  const { data, error } = await db.from("cfi_backfill_sources").select("source_id").in("source_id", ids);
  if (error) throw new Error(`EXPANSION_CATALOG_READ_FAILED:${error.message}`);
  const have = new Set((data ?? []).map((x: any) => x.source_id));
  const missing = rows.filter((x) => !have.has(x.source_id));
  if (missing.length) {
    const { error: ie } = await db.from("cfi_backfill_sources").insert(missing);
    if (ie) throw new Error(`EXPANSION_CATALOG_INSERT_FAILED:${ie.message}`);
  }
  return { version: EXPANSION_VERSION, configured: rows.length, existing: rows.length - missing.length, inserted: missing.length };
}

async function resumeHistoricalLearning(db: any, su: string, anon: string | null) {
  if (!anon) return { status: "ANON_KEY_MISSING" };
  const { data: r, error } = await db.from("cfi_mm_historical_v2_runs").select("run_id,status,next_offset,corpus_count,updated_at,contract_version").eq("contract_version", "CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1").neq("status", "SUCCESS").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return { status: "READ_ERROR", message: error.message };
  if (!r) return { status: "NO_ACTIVE_RUN" };
  const stale = Date.now() - Date.parse(String(r.updated_at ?? 0)) > 90000;
  if (r.status === "RUNNING" && !stale) return { status: "RUNNING_HEALTHY", runId: r.run_id, nextOffset: r.next_offset };
  const limit = 100, offset = Math.max(0, Number(r.next_offset ?? 0));
  const { error: ue } = await db.from("cfi_mm_historical_v2_runs").update({ status: "RUNNING", error: null, chunk_size: limit, updated_at: new Date().toISOString() }).eq("run_id", r.run_id);
  if (ue) return { status: "UPDATE_ERROR", message: ue.message };
  try {
    const res = await fetch(`${su}/functions/v1/cfi-mm-historical-v2`, { method: "POST", headers: { Authorization: `Bearer ${anon}`, apikey: anon, "content-type": "application/json" }, body: JSON.stringify({ action: "CHUNK", runId: r.run_id, offset, limit }) });
    const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch {}
    return { status: res.ok ? "RESUMED" : "RESUME_FAILED", httpStatus: res.status, runId: r.run_id, offset, body };
  } catch (e) { return { status: "RESUME_FETCH_ERROR", runId: r.run_id, offset, message: e instanceof Error ? e.message : String(e) }; }
}

async function runSettlementEval(su: string, anon: string | null) {
  if (!anon) return { status: "ANON_KEY_MISSING" };
  try {
    const r = await fetch(`${su}/functions/v1/cfi-multimarket-settlement-eval`, { method: "POST", headers: { Authorization: `Bearer ${anon}`, apikey: anon, "content-type": "application/json" }, body: JSON.stringify({ limit: 500 }) });
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text); } catch {}
    return { status: r.ok ? "OK" : "ERROR", httpStatus: r.status, body };
  } catch (e) { return { status: "FETCH_ERROR", message: e instanceof Error ? e.message : String(e) }; }
}

function line(x: string) { const o: string[] = []; let f = "", q = false; for (let i = 0; i < x.length; i++) { const c = x[i]; if (c === '"') { if (q && x[i + 1] === '"') { f += '"'; i++; } else q = !q; } else if (c === "," && !q) { o.push(f); f = ""; } else f += c; } o.push(f); return o; }
function date(v: string) { const m = String(v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/); if (!m) return null; let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000; return `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`; }
function isoDate(v: unknown) { const s = String(v ?? "").trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function score(v: unknown) { const t = String(v ?? "").trim(); return /^\d+$/.test(t) ? Number(t) : null; }
function scorePair(v: unknown): [number, number] | null { if (!Array.isArray(v) || v.length < 2) return null; const a = Number(v[0]), b = Number(v[1]); return Number.isInteger(a) && a >= 0 && Number.isInteger(b) && b >= 0 ? [a, b] : null; }
function segment(src: any) { const l = String(src.league || "").toLowerCase(), d = String(src.division_code || "").toUpperCase(); if (/women|women's|wsl|femen|feminin|frauen/.test(l)) return "WOMEN"; if (/u\d{2}|youth|reserve|reserves|academy/.test(l)) return "YOUTH_RESERVE"; if (/amateur|non-league|regional|oberliga|national league|conference/.test(l)) return "AMATEUR_SEMIPRO"; const elite = new Set(["E0", "D1", "I1", "SP1", "F1", "N1", "B1", "P1", "T1", "G1", "SC0", "OF_EN1"]); if (elite.has(d)) return "ELITE_PRO"; return "MID_PRO"; }
function compKey(src: any) { return `${String(src.country || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${String(src.division_code || src.league || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }
function normalizeAlias(v: string) { return v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

function parseFootballData(csv: string, url: string, src: any) {
  const ls = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((x) => x.trim()); if (ls.length < 2) throw new Error("CSV_EMPTY");
  const h = line(ls[0]).map((x) => x.trim()), ix = Object.fromEntries(h.map((x, i) => [x, i]));
  for (const k of ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HTHG", "HTAG"]) if (!(k in ix)) throw new Error(`MISSING_COLUMN:${k}`);
  const fixtures: any[] = []; let rejected = 0; const competitionSegment = segment(src), competitionKey = compKey(src);
  for (const l of ls.slice(1)) { const c = line(l), d = date(c[ix.Date]), home = String(c[ix.HomeTeam] || "").trim(), away = String(c[ix.AwayTeam] || "").trim(); const fh = score(c[ix.FTHG]), fa = score(c[ix.FTAG]), hh = score(c[ix.HTHG]), ha = score(c[ix.HTAG]); if (!d || !home || !away || home.toLowerCase() === away.toLowerCase() || fh === null || fa === null || hh === null || ha === null || hh > fh || ha > fa) { rejected++; continue; } fixtures.push({ matchDate: d, homeTeam: home, awayTeam: away, ht: { home: hh, away: ha }, ft: { home: fh, away: fa }, sourceType: "CSV_BACKFILL", sourceLabel: url, imageHash: null, competitionKey, competitionName: src.league, country: src.country, season: src.season, competitionSegment }); }
  return { adapter: "FOOTBALL_DATA_CSV_V1", rows: ls.length - 1, fixtures, rejected, competitionKey, competitionSegment, identityRejected: 0 };
}

function parseOpenFootball(raw: string, url: string, src: any) {
  let doc: any; try { doc = JSON.parse(raw); } catch { throw new Error("OPENFOOTBALL_JSON_INVALID"); }
  if (!doc || !Array.isArray(doc.matches)) throw new Error("OPENFOOTBALL_MATCHES_REQUIRED");
  const fixtures: any[] = []; let rejected = 0; const competitionSegment = segment(src), competitionKey = compKey(src); const today = new Date().toISOString().slice(0, 10);
  for (const m of doc.matches) { const d = isoDate(m?.date), home = String(m?.team1 ?? "").trim(), away = String(m?.team2 ?? "").trim(); const ft = scorePair(m?.score?.ft), ht = scorePair(m?.score?.ht); if (!d || d > today || !home || !away || normalizeAlias(home) === normalizeAlias(away) || !ft || !ht || ht[0] > ft[0] || ht[1] > ft[1]) { rejected++; continue; } fixtures.push({ matchDate: d, homeTeam: home, awayTeam: away, ht: { home: ht[0], away: ht[1] }, ft: { home: ft[0], away: ft[1] }, sourceType: "OPENFOOTBALL_BACKFILL", sourceLabel: url, imageHash: null, competitionKey, competitionName: src.league, country: src.country, season: src.season, competitionSegment }); }
  return { adapter: "OPENFOOTBALL_JSON_V1", rows: doc.matches.length, fixtures, rejected, competitionKey, competitionSegment, identityRejected: 0 };
}

async function canonicalizeOpenFootball(db: any, parsed: any) {
  const names = [...new Set(parsed.fixtures.flatMap((f: any) => [f.homeTeam, f.awayTeam]))] as string[]; if (!names.length) return parsed;
  const norms = names.map(normalizeAlias); const { data: aliasRows, error: ae } = await db.from("team_aliases").select("alias_normalized,team_id").in("alias_normalized", norms); if (ae) throw new Error(`OPENFOOTBALL_ALIAS_READ_FAILED:${ae.message}`);
  const ids = [...new Set((aliasRows ?? []).map((x: any) => x.team_id))]; const idToCanonical = new Map<string, string>();
  if (ids.length) { const { data: teamRows, error: te } = await db.from("teams").select("team_id,canonical_name").in("team_id", ids); if (te) throw new Error(`OPENFOOTBALL_TEAM_READ_FAILED:${te.message}`); for (const t of teamRows ?? []) idToCanonical.set(String(t.team_id), String(t.canonical_name)); }
  const normToCanonical = new Map<string, string>(); for (const a of aliasRows ?? []) { const c = idToCanonical.get(String(a.team_id)); if (c) normToCanonical.set(String(a.alias_normalized), c); }
  const directCandidates = [...new Set(names.flatMap((n) => [n, n.replace(/\s+(?:FC|AFC|CF|SC|AC)$/i, "").trim()]))]; const { data: directRows, error: de } = await db.from("teams").select("canonical_name").in("canonical_name", directCandidates); if (de) throw new Error(`OPENFOOTBALL_DIRECT_TEAM_READ_FAILED:${de.message}`); for (const t of directRows ?? []) { const k = normalizeAlias(String(t.canonical_name)); if (!normToCanonical.has(k)) normToCanonical.set(k, String(t.canonical_name)); }
  for (const n of names) { const stripped = n.replace(/\s+(?:FC|AFC|CF|SC|AC)$/i, "").trim(); const direct = normToCanonical.get(normalizeAlias(n)) ?? normToCanonical.get(normalizeAlias(stripped)); if (direct) normToCanonical.set(normalizeAlias(n), direct); }
  const kept: any[] = []; let identityRejected = 0; for (const f of parsed.fixtures) { const home = normToCanonical.get(normalizeAlias(f.homeTeam)); const away = normToCanonical.get(normalizeAlias(f.awayTeam)); if (!home || !away) { identityRejected++; continue; } kept.push({ ...f, homeTeam: home, awayTeam: away }); }
  return { ...parsed, fixtures: kept, rejected: parsed.rejected + identityRejected, identityRejected };
}

function isOpenFootball(src: any) { const p = String(src.provider || "").toLowerCase(); const u = String(src.csv_url || "").toLowerCase(); return p === "openfootball" || p === "openfootball.org" || u.includes("raw.githubusercontent.com/openfootball/") || u.endsWith(".json"); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "POST_REQUIRED" }, 405);
  const su = Deno.env.get("SUPABASE_URL"), sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), anon = Deno.env.get("SUPABASE_ANON_KEY") ?? null; if (!su || !sr) return j({ error: "SERVER_SECRET_MISSING" }, 500);
  const db = createClient(su, sr, { auth: { persistSession: false, autoRefreshToken: false } }); let expansion: any, researchResume: any, settlementEval: any;
  try { expansion = await ensureExpansionSources(db); [researchResume, settlementEval] = await Promise.all([resumeHistoricalLearning(db, su, anon), runSettlementEval(su, anon)]); } catch (e) { return j({ error: "PREWORK_FAILED", message: e instanceof Error ? e.message : String(e) }, 500); }
  const { data: src, error: claimErr } = await db.rpc("cfi_claim_backfill_source"); if (claimErr) return j({ error: "CLAIM_FAILED", message: claimErr.message, expansion, researchResume, settlementEval }, 500); if (!src?.source_id) return j({ status: "IDLE", reason: "NO_PENDING_SOURCES", adapterVersion: ADAPTER_VERSION, expansion, researchResume, settlementEval });
  const { data: run, error: runErr } = await db.from("cfi_backfill_runs").insert({ source_id: src.source_id, status: "RUNNING" }).select("run_id").single(); if (runErr) return j({ error: "RUN_CREATE_FAILED", message: runErr.message }, 500);
  const finish = async (status: string, counters: any = {}, error: string | null = null, meta: any = {}) => { await db.from("cfi_backfill_runs").update({ status, finished_at: new Date().toISOString(), counters: { ...counters, ...meta }, error }).eq("run_id", run.run_id); await db.from("cfi_backfill_sources").update({ status, last_finished_at: new Date().toISOString(), last_error: error, rows_seen: Number(counters.rows ?? 0), new_count: Number(counters.NEW ?? 0), duplicate_count: Number(counters.DUPLICATE_COMPATIBLE ?? 0), complementary_count: Number(counters.COMPLEMENTARY ?? 0), conflict_count: Number(counters.CONFLICT ?? 0), rejected_count: Number(counters.REJECTED ?? 0), error_count: Number(counters.ERROR ?? 0), updated_at: new Date().toISOString() }).eq("source_id", src.source_id); return j({ status, source: src.source_id, provider: src.provider, country: src.country, league: src.league, season: src.season, counters, error, adapterVersion: ADAPTER_VERSION, expansion, researchResume, settlementEval, ...meta }); };
  try { const openFootball = isOpenFootball(src); const r = await fetch(src.csv_url, { headers: { "user-agent": "CFI-Football-Intelligence/5.2", accept: openFootball ? "application/json,text/plain" : "text/csv,text/plain" } }); if (r.status === 404 || r.status === 300) return await finish("NOT_AVAILABLE", { rows: 0, NEW: 0, DUPLICATE_COMPATIBLE: 0, COMPLEMENTARY: 0, CONFLICT: 0, REJECTED: 0, ERROR: 0 }, `HTTP_${r.status}`); if (!r.ok) throw new Error(`${openFootball ? "OPENFOOTBALL" : "CSV"}_FETCH_FAILED:${r.status}`); const raw = await r.text(); let p = openFootball ? parseOpenFootball(raw, src.csv_url, src) : parseFootballData(raw, src.csv_url, src); if (openFootball) p = await canonicalizeOpenFootball(db, p); const c: any = { rows: p.rows, NEW: 0, DUPLICATE_COMPATIBLE: 0, COMPLEMENTARY: 0, CONFLICT: 0, REJECTED: p.rejected, ERROR: 0 }; for (let i = 0; i < p.fixtures.length; i += 400) { const { data, error } = await db.rpc("cfi_upsert_fixtures_batch", { p_fixtures: p.fixtures.slice(i, i + 400) }); if (error) throw new Error(`BATCH_RPC_FAILED:${error.message}`); for (const k of ["NEW", "DUPLICATE_COMPATIBLE", "COMPLEMENTARY", "CONFLICT", "REJECTED", "ERROR"]) c[k] += Number(data?.counters?.[k] ?? 0); } await db.from("cfi_competition_profiles").upsert({ competition_key: p.competitionKey, competition_name: src.league, country: src.country, segment: p.competitionSegment, tier: null, gender: "M", age_class: "SENIOR", professional_level: p.competitionSegment, source: openFootball ? "OPENFOOTBALL_CLASSIFIER" : "BACKFILL_CLASSIFIER", confidence: 0.8, updated_at: new Date().toISOString() }, { onConflict: "competition_key" }); return await finish("COMPLETED", c, null, { adapter: p.adapter, identityRejected: p.identityRejected, competitionKey: p.competitionKey, competitionSegment: p.competitionSegment }); } catch (e) { const msg = e instanceof Error ? e.message : String(e); return await finish("FAILED", { rows: 0, NEW: 0, DUPLICATE_COMPATIBLE: 0, COMPLEMENTARY: 0, CONFLICT: 0, REJECTED: 0, ERROR: 1 }, msg); }
});