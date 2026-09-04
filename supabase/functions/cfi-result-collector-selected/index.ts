import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION = "CFI_RESULT_COLLECTOR_SELECTED_DISPATCH_R3_20M_ROTATION";
const json = (body: unknown, status = 200) => new Response(JSON.stringify({version: VERSION, ...(body as any)}), {status, headers: {"content-type": "application/json"}});

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) || 0, minute: Number(get("minute")) || 0};
}
function addDays(ymd: string, delta: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({status: "ERROR", error: "POST_REQUIRED"}, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({status: "ERROR", error: "SERVER_SECRET_MISSING"}, 500);

  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(6, Number(body?.limit ?? 6) || 6));
  const maxAgeDays = Math.max(1, Math.min(14, Number(body?.maxAgeDays ?? 4) || 4));
  const dryRun = body?.dryRun === true;
  const targetDate = typeof body?.targetDate === "string" ? body.targetDate.slice(0, 10) : null;
  const home = typeof body?.home === "string" ? body.home.trim() : null;
  const away = typeof body?.away === "string" ? body.away.trim() : null;
  const {ymd: today, hour: localHour, minute: localMinute} = localParts();
  const floorDate = addDays(today, -maxAgeDays);
  const rotationSlot = localHour * 3 + Math.floor(localMinute / 20);
  const db = createClient(supabaseUrl, serviceRole, {auth: {persistSession: false, autoRefreshToken: false}});
  const cols = "snapshot_id,target_date,home_team,away_team,created_at,settlement_status,selected_for_match_audit";

  const applyFilters = (q: any) => {
    if (targetDate) q = q.eq("target_date", targetDate);
    if (home) q = q.eq("home_team", home);
    if (away) q = q.eq("away_team", away);
    return q;
  };

  let priority: any[] = [];
  if (!targetDate || targetDate === today) {
    let priorityQ = db.from("cfi_prediction_history").select(cols)
      .eq("selected_for_match_audit", true).eq("settlement_status", "PENDING")
      .eq("target_date", today).order("created_at", {ascending: true}).limit(Math.min(2, limit));
    priorityQ = applyFilters(priorityQ);
    const {data: priorityData, error: priorityError} = await priorityQ;
    if (priorityError) return json({status: "ERROR", error: "PRIORITY_READ_FAILED", message: priorityError.message}, 500);
    priority = priorityData ?? [];
  }

  const backlogSlots = Math.max(0, limit - priority.length);
  let backlog: any[] = [];
  let backlogCount = 0;
  let backlogOffset = 0;
  if (backlogSlots > 0) {
    let countQ = db.from("cfi_prediction_history").select("snapshot_id", {count: "exact", head: true})
      .eq("selected_for_match_audit", true).eq("settlement_status", "PENDING")
      .gte("target_date", floorDate).lt("target_date", targetDate && targetDate < today ? addDays(targetDate, 1) : today);
    if (targetDate) countQ = countQ.eq("target_date", targetDate);
    if (home) countQ = countQ.eq("home_team", home);
    if (away) countQ = countQ.eq("away_team", away);
    const {count, error: countError} = await countQ;
    if (countError) return json({status: "ERROR", error: "BACKLOG_COUNT_FAILED", message: countError.message}, 500);
    backlogCount = count ?? 0;
    if (backlogCount > 0) {
      backlogOffset = Number.isInteger(Number(body?.offset))
        ? Math.max(0, Number(body.offset)) % backlogCount
        : (rotationSlot * backlogSlots) % backlogCount;
      let backlogQ = db.from("cfi_prediction_history").select(cols)
        .eq("selected_for_match_audit", true).eq("settlement_status", "PENDING")
        .gte("target_date", floorDate).lt("target_date", targetDate && targetDate < today ? addDays(targetDate, 1) : today)
        .order("target_date", {ascending: false}).order("created_at", {ascending: true})
        .range(backlogOffset, Math.min(backlogCount - 1, backlogOffset + backlogSlots - 1));
      if (targetDate) backlogQ = backlogQ.eq("target_date", targetDate);
      if (home) backlogQ = backlogQ.eq("home_team", home);
      if (away) backlogQ = backlogQ.eq("away_team", away);
      const {data: backlogData, error: backlogError} = await backlogQ;
      if (backlogError) return json({status: "ERROR", error: "BACKLOG_READ_FAILED", message: backlogError.message}, 500);
      backlog = backlogData ?? [];
      if (backlog.length < backlogSlots && backlogOffset > 0) {
        const remain = backlogSlots - backlog.length;
        let wrapQ = db.from("cfi_prediction_history").select(cols)
          .eq("selected_for_match_audit", true).eq("settlement_status", "PENDING")
          .gte("target_date", floorDate).lt("target_date", targetDate && targetDate < today ? addDays(targetDate, 1) : today)
          .order("target_date", {ascending: false}).order("created_at", {ascending: true})
          .range(0, remain - 1);
        if (targetDate) wrapQ = wrapQ.eq("target_date", targetDate);
        if (home) wrapQ = wrapQ.eq("home_team", home);
        if (away) wrapQ = wrapQ.eq("away_team", away);
        const {data: wrapData, error: wrapError} = await wrapQ;
        if (wrapError) return json({status: "ERROR", error: "BACKLOG_WRAP_FAILED", message: wrapError.message}, 500);
        backlog.push(...(wrapData ?? []));
      }
    }
  }

  const seen = new Set<string>();
  const candidates = [...priority, ...backlog].filter((c: any) => c?.snapshot_id && !seen.has(c.snapshot_id) && seen.add(c.snapshot_id));
  if (dryRun) return json({status: "OK", mode: "DRY_RUN", today, floorDate, localHour, localMinute, rotationSlot, backlogCount, backlogOffset, count: candidates.length, candidates});

  const runs: any[] = [];
  for (const c of candidates) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/cfi-result-collector`, {
        method: "POST",
        headers: {"content-type": "application/json", "authorization": `Bearer ${serviceRole}`, "apikey": serviceRole},
        body: JSON.stringify({snapshotId: c.snapshot_id})
      });
      const text = await res.text();
      let result: any = text;
      try { result = JSON.parse(text); } catch {}
      runs.push({snapshotId: c.snapshot_id, targetDate: c.target_date, home: c.home_team, away: c.away_team, httpStatus: res.status, ok: res.ok, checked: result?.checked ?? null, verified: result?.verified ?? null, pending: result?.pending ?? null, rejected: result?.rejected ?? null, conflict: result?.conflict ?? null, settled: result?.settlement?.settled ?? null, outcome: Array.isArray(result?.outcomes) ? result.outcomes[0]?.status ?? null : null, reason: Array.isArray(result?.outcomes) ? result.outcomes[0]?.reason ?? null : null});
    } catch (e) {
      runs.push({snapshotId: c.snapshot_id, targetDate: c.target_date, home: c.home_team, away: c.away_team, httpStatus: null, ok: false, error: e instanceof Error ? e.message : String(e)});
    }
  }
  return json({status: "OK", mode: "SELECTED_CANONICAL_DISPATCH", today, floorDate, localHour, localMinute, rotationSlot, backlogCount, backlogOffset, count: candidates.length, success: runs.filter(r => r.ok).length, runs});
});
