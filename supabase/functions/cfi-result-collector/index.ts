import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const STOP = new Set(["fc", "cf", "sc", "afc", "fk", "club", "football", "de"]);
const num = (value: unknown) => {
  const x = Number(value);
  return Number.isFinite(x) && x >= 0 ? Math.trunc(x) : null;
};
const minute = (value: unknown) => {
  const match = String(value ?? "").match(/^(\d+)/);
  return match ? Number(match[1]) : null;
};

function norm(value: string) {
  return String(value ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\bsaint\b/g, "st")
    .replace(/\b(w|women's|womens)\b/g, "women")
    .replace(/\b\d{4}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(value: string) { return norm(value).split(/\s+/).filter((x) => x && !STOP.has(x)); }
function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b), sa = new Set(A), sb = new Set(B), union = new Set([...A, ...B]);
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection++;
  const jaccard = union.size ? intersection / union.size : 0;
  const ca = A.join(""), cb = B.join("");
  return Math.max(jaccard, ca && cb && (ca.includes(cb) || cb.includes(ca)) ? 0.9 : 0);
}
function parseKV(block: string) {
  const out: Record<string, string> = {};
  for (const part of block.split("¬")) {
    const at = part.indexOf("÷");
    if (at > 0) out[part.slice(0, at).replace(/^~/, "")] = part.slice(at + 1);
  }
  return out;
}

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; CFI-Football-Intelligence/5.1)",
      accept: "*/*",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`FETCH_${response.status}:${url}`);
  return response.text();
}
async function fetchJson(url: string) {
  return JSON.parse(await fetchText(url, { referer: "https://www.espn.com/", accept: "application/json,text/plain,*/*" }));
}
async function sofa(path: string) {
  let last = "";
  for (const base of ["https://api.sofascore.com/api/v1", "https://www.sofascore.com/api/v1"]) {
    try { return await fetchJson(`${base}${path}`); }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(last);
}
function sofaEvent(event: any) {
  return {
    source: "SOFASCORE", id: String(event?.id ?? ""), home: event?.homeTeam?.name ?? "", away: event?.awayTeam?.name ?? "",
    finished: event?.status?.type === "finished" || event?.status?.code === 100,
    hh: num(event?.homeScore?.period1), ha: num(event?.awayScore?.period1),
    fh: num(event?.homeScore?.normaltime ?? event?.homeScore?.current), fa: num(event?.awayScore?.normaltime ?? event?.awayScore?.current),
    htEvidence: "SCORE_OBJECT",
  };
}
function espnEvent(competition: any, id: unknown) {
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((x: any) => x.homeAway === "home"), away = competitors.find((x: any) => x.homeAway === "away");
  const half = (x: any) => {
    const period = (x?.linescores ?? []).find((z: any) => Number(z.period) === 1);
    return num(period?.value ?? period?.score ?? period?.displayValue);
  };
  return {
    source: "ESPN", id: String(id ?? competition?.id ?? ""), home: home?.team?.displayName ?? home?.team?.name ?? "", away: away?.team?.displayName ?? away?.team?.name ?? "",
    finished: Boolean(competition?.status?.type?.completed) || competition?.status?.type?.state === "post",
    hh: half(home), ha: half(away), fh: num(home?.score), fa: num(away?.score), htEvidence: "LINESCORE",
  };
}
function flashEvents(raw: string) {
  const events: any[] = [];
  for (const block of raw.split("~")) {
    if (!block.startsWith("AA÷")) continue;
    const x = parseKV(block);
    events.push({ source: "FLASHSCORE", id: x.AA ?? "", home: x.AE ?? x.CX ?? "", away: x.AF ?? "", finished: x.AB === "3", hh: num(x.BA), ha: num(x.BB), fh: num(x.AG), fa: num(x.AH), htEvidence: x.BA !== undefined && x.BB !== undefined ? "DATE_FEED_PERIOD" : "MISSING" });
  }
  return events;
}
function dayOffset(date: string) {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const target = new Date(date + "T00:00:00Z").getTime();
  return Math.round((today - target) / 86400000);
}
async function flashList(date: string) {
  const offset = dayOffset(date);
  if (offset < 0 || offset > 7) throw new Error(`FLASHSCORE_OFFSET_UNSUPPORTED:${offset}`);
  const raw = await fetchText(`https://2.flashscore.ninja/2/x/feed/f_1_${offset}_3_en_1`, { "x-fsign": "SW9D1eZo", referer: "https://www.flashscore.com/" });
  return flashEvents(raw);
}
async function listProviders(date: string) {
  const events: any[] = [], errors: string[] = [];
  try { const data = await sofa(`/sport/football/scheduled-events/${date}`); events.push(...(data?.events ?? []).map(sofaEvent)); }
  catch (error) { errors.push(`SOFA:${error instanceof Error ? error.message : String(error)}`); }
  try {
    const d = date.replaceAll("-", "");
    const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=1000&dates=${d}`);
    events.push(...(data?.events ?? []).flatMap((event: any) => event?.competitions?.[0] ? [espnEvent(event.competitions[0], event.id)] : []));
  } catch (error) { errors.push(`ESPN:${error instanceof Error ? error.message : String(error)}`); }
  try { events.push(...await flashList(date)); }
  catch (error) { errors.push(`FLASH:${error instanceof Error ? error.message : String(error)}`); }
  return { events, errors };
}
function flashDetailHT(raw: string, ftHome: number | null, ftAway: number | null) {
  let hh = 0, ha = 0, saw = false;
  for (const block of raw.split("~")) {
    if (!block.startsWith("III÷") && !block.startsWith("IIIX÷")) continue;
    const x = parseKV(block), m = minute(x.IB ?? x.IBX), h = num(x.INX), a = num(x.IOX);
    if (m !== null && m <= 45 && h !== null && a !== null) { hh = h; ha = a; saw = true; }
  }
  if (ftHome !== null && ftAway !== null && (hh > ftHome || ha > ftAway)) return null;
  return { hh, ha, evidence: saw ? "DETAIL_EVENT_STATE_AT_45" : "DETAIL_NO_FIRST_HALF_SCORE_STATE" };
}
async function detail(event: any) {
  if (event.source === "SOFASCORE") { const data = await sofa(`/event/${event.id}`); return sofaEvent(data?.event ?? data); }
  if (event.source === "ESPN") {
    const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${encodeURIComponent(event.id)}`);
    const competition = data?.header?.competitions?.[0];
    if (!competition) throw new Error("ESPN_SUMMARY_NO_COMPETITION");
    return espnEvent(competition, event.id);
  }
  const raw = await fetchText(`https://2.flashscore.ninja/2/x/feed/df_sui_1_${event.id}`, { "x-fsign": "SW9D1eZo", referer: "https://www.flashscore.com/" });
  if (!raw || raw.length < 5) throw new Error("FLASHSCORE_DETAIL_EMPTY");
  const ht = flashDetailHT(raw, event.fh, event.fa);
  if ((event.hh === null || event.ha === null) && !ht) throw new Error("FLASHSCORE_HT_DERIVATION_FAILED");
  const states = [...raw.matchAll(/INX÷(\d+)[^~]*?IOX÷(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (states.length && event.fh !== null && event.fa !== null) {
    const max = states.reduce((best, x) => x[0] + x[1] >= best[0] + best[1] ? x : best, [0, 0]);
    if (max[0] !== event.fh || max[1] !== event.fa) throw new Error(`FLASHSCORE_DETAIL_SCORE_MISMATCH:${max[0]}-${max[1]}`);
  }
  return { ...event, hh: event.hh ?? ht?.hh ?? null, ha: event.ha ?? ht?.ha ?? null, htEvidence: event.hh !== null && event.ha !== null ? event.htEvidence : ht?.evidence, detailVerified: true };
}
function validScores(event: any) {
  return [event.hh, event.ha, event.fh, event.fa].every((x) => Number.isInteger(x)) && event.hh <= event.fh && event.ha <= event.fa;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SERVER_SECRET_MISSING" }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await request.json().catch(() => ({}));
  const only = typeof body?.snapshotId === "string" ? body.snapshotId : null, verifyOnly = Boolean(body?.verifyOnly);
  let query = db.from("cfi_prediction_snapshots").select("snapshot_id,target_date,home_team,away_team,engine_version,created_at").order("target_date");
  query = only ? query.eq("snapshot_id", only) : query.lte("target_date", new Date().toISOString().slice(0, 10));
  const { data: snapshots, error: snapshotError } = await query.limit(200);
  if (snapshotError) return json({ error: "SNAPSHOT_READ_FAILED", message: snapshotError.message }, 500);
  const { data: settlements, error: settlementReadError } = await db.from("cfi_prediction_settlements").select("snapshot_id");
  if (settlementReadError) return json({ error: "SETTLEMENT_READ_FAILED", message: settlementReadError.message }, 500);
  const settled = new Set((settlements ?? []).map((x: any) => x.snapshot_id));
  const work = (snapshots ?? []).filter((snapshot: any) => only || !settled.has(snapshot.snapshot_id));
  const groups = new Map<string, any[]>();
  for (const snapshot of work) { if (!groups.has(snapshot.target_date)) groups.set(snapshot.target_date, []); groups.get(snapshot.target_date)!.push(snapshot); }

  const outcomes: any[] = [];
  let verified = 0, pending = 0, rejected = 0, conflict = 0, upserted = 0;
  for (const [date, items] of groups) {
    const listing = await listProviders(date);
    for (const snapshot of items) {
      const candidates = listing.events.map((event: any) => ({ event, home: similarity(snapshot.home_team, event.home), away: similarity(snapshot.away_team, event.away) }))
        .filter((x: any) => x.home >= 0.6 && x.away >= 0.6)
        .sort((a: any, b: any) => (b.home + b.away) - (a.home + a.away));
      if (!candidates.length) { pending++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "PENDING", reason: "NO_CONFIDENT_MATCH", providerErrors: listing.errors }); continue; }
      const best = candidates[0], second = candidates[1], confidence = (best.home + best.away) / 2;
      if (second && second.event.source === best.event.source && ((best.home + best.away) - (second.home + second.away)) < 0.15) { rejected++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "REJECTED", reason: "AMBIGUOUS_MATCH", provider: best.event.source, confidence }); continue; }
      if (!best.event.finished) { pending++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "PENDING", reason: "NOT_FINISHED", provider: best.event.source, eventId: best.event.id, externalHome: best.event.home, externalAway: best.event.away, confidence }); continue; }
      let resolved: any;
      try { resolved = await detail(best.event); }
      catch (error) { pending++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "PENDING", reason: "DETAIL_FETCH_FAILED", provider: best.event.source, eventId: best.event.id, message: error instanceof Error ? error.message : String(error) }); continue; }
      const homeConfidence = similarity(snapshot.home_team, resolved.home), awayConfidence = similarity(snapshot.away_team, resolved.away);
      if (homeConfidence < 0.6 || awayConfidence < 0.6 || !resolved.finished || !validScores(resolved)) { rejected++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "REJECTED", reason: "DETAIL_VERIFICATION_FAILED", provider: resolved.source, eventId: resolved.id }); continue; }
      if (verifyOnly) { verified++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "VERIFIED", verifyOnly: true, provider: resolved.source, eventId: resolved.id, ht: [resolved.hh, resolved.ha], ft: [resolved.fh, resolved.fa], htEvidence: resolved.htEvidence }); continue; }

      const { data: upsert, error: upsertError } = await db.rpc("cfi_upsert_fixture", {
        p_match_date: snapshot.target_date, p_home_team: snapshot.home_team, p_away_team: snapshot.away_team,
        p_ht_home: resolved.hh, p_ht_away: resolved.ha, p_ft_home: resolved.fh, p_ft_away: resolved.fa,
        p_source_type: "RESULT_COLLECTOR", p_source_label: `${resolved.source}_EVENT:${resolved.id}`, p_image_hash: null,
      });
      if (upsertError) { rejected++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "REJECTED", reason: "UPSERT_ERROR", message: upsertError.message }); continue; }
      const upsertStatus = String(upsert?.status ?? "");
      if (upsertStatus === "CONFLICT") { conflict++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "CONFLICT", provider: resolved.source, eventId: resolved.id, upsert }); continue; }
      if (!["NEW", "DUPLICATE_COMPATIBLE", "COMPLEMENTARY"].includes(upsertStatus)) { rejected++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "REJECTED", reason: "UPSERT_NOT_ACCEPTED", upsert }); continue; }
      upserted++;
      const verificationMethod = resolved.source === "ESPN" ? "ESPN_SCOREBOARD_PLUS_SUMMARY" : resolved.source === "FLASHSCORE" ? "FLASHSCORE_DATE_FEED_PLUS_DETAIL_EVENT_STATES" : "SOFASCORE_SCHEDULED_PLUS_EVENT_DETAIL";
      const { error: resolutionError } = await db.from("cfi_result_resolutions").upsert({
        snapshot_id: snapshot.snapshot_id, source: resolved.source, source_event_id: resolved.id, match_date: snapshot.target_date,
        home_team: snapshot.home_team, away_team: snapshot.away_team, external_home_team: resolved.home, external_away_team: resolved.away,
        name_confidence: (homeConfidence + awayConfidence) / 2, ht_home: resolved.hh, ht_away: resolved.ha, ft_home: resolved.fh, ft_away: resolved.fa,
        verification_method: verificationMethod, status: "VERIFIED", details: { engineVersion: snapshot.engine_version, upsertStatus, htEvidence: resolved.htEvidence },
      }, { onConflict: "snapshot_id,source,source_event_id" });
      if (resolutionError) { rejected++; outcomes.push({ snapshotId: snapshot.snapshot_id, status: "REJECTED", reason: "AUDIT_WRITE_FAILED", message: resolutionError.message }); continue; }
      verified++;
      outcomes.push({ snapshotId: snapshot.snapshot_id, status: "VERIFIED", provider: resolved.source, eventId: resolved.id, ht: [resolved.hh, resolved.ha], ft: [resolved.fh, resolved.fa], htEvidence: resolved.htEvidence, upsertStatus });
    }
  }

  let settlement: any = { status: "NOT_RUN", settled: 0 };
  if (!verifyOnly && verified > 0) {
    const { data, error } = await db.rpc("cfi_settle_prediction_snapshots");
    settlement = error ? { status: "ERROR", message: error.message } : data ?? { status: "OK", settled: 0 };
  }
  const summary = { status: "COMPLETED", mode: verifyOnly ? "VERIFY_ONLY" : "AUTO_RESULT_COLLECTOR", checked: work.length, verified, pending, rejected, conflict, upserted, settlement, outcomes };
  if (!verifyOnly) await db.from("cfi_result_collector_runs").insert({ checked: work.length, verified, pending, rejected, conflicts: conflict, upserted, settled: Number(settlement?.settled ?? 0), outcomes });
  console.log(JSON.stringify({ collectorSummary: summary }));
  return json(summary);
});
