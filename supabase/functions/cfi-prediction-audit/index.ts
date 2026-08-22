import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function verifiedStrictPrior(prediction: any, targetDate: string) {
  const audit = prediction?.strictPriorAudit ?? prediction?.strictPrior;
  const evidence = audit?.evidence ?? prediction?.temporalEvidenceAudit ?? {};
  const auditTarget = String(audit?.targetDate ?? evidence?.targetDate ?? "").slice(0, 10);
  const future = Number(evidence?.futureEvidenceCount);
  const same = Number(evidence?.sameDateEvidenceCount);
  const maxEvidenceDate = evidence?.maxEvidenceDate ? String(evidence.maxEvidenceDate).slice(0, 10) : null;
  return audit?.verified === true &&
    auditTarget === targetDate &&
    Number.isFinite(future) && future === 0 &&
    Number.isFinite(same) && same === 0 &&
    typeof maxEvidenceDate === "string" && maxEvidenceDate < targetDate;
}

Deno.serve(async (request) => {
  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey || request.headers.get("x-cfi-key") !== expectedKey) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);

  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (request.method === "GET") {
    const { data, error } = await client.from("cfi_prediction_audit_summary").select("*").single();
    if (error) return json({ error: "AUDIT_SUMMARY_FAILED", message: error.message }, 500);
    return json({ status: "OK", summary: data });
  }

  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "SNAPSHOT").toUpperCase();

  if (action === "SETTLE") {
    const { data, error } = await client.rpc("cfi_settle_prediction_snapshots");
    if (error) return json({ error: "SETTLEMENT_FAILED", message: error.message }, 500);
    return json(data ?? { status: "OK", settled: 0 });
  }

  const prediction = body?.prediction;
  const target = prediction?.target ?? {};
  const targetDate = String(body?.target_date ?? target?.date ?? target?.targetDate ?? "").slice(0, 10);
  const home = String(body?.home ?? target?.home ?? "").trim();
  const away = String(body?.away ?? target?.away ?? "").trim();
  if (!prediction || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !home || !away) {
    return json({ error: "INVALID_SNAPSHOT", message: "prediction,target_date,home,away required" }, 400);
  }
  if (!verifiedStrictPrior(prediction, targetDate)) {
    return json({ error: "STRICT_PRIOR_NOT_VERIFIED", message: "Snapshot rejected before persistence because temporal provenance is not verified strict-prior." }, 422);
  }

  const predictionHash = await sha256Hex(prediction);
  const { data, error } = await client.rpc("cfi_record_prediction_snapshot", {
    p_target_date: targetDate,
    p_home_team: home,
    p_away_team: away,
    p_engine_version: String(prediction?.engine ?? body?.engine ?? "UNKNOWN"),
    p_language: String(prediction?.language ?? body?.language ?? "vi"),
    p_strict_prior: true,
    p_prediction: prediction,
    p_prediction_hash: predictionHash,
    p_source: String(body?.source ?? "GPT_ACTION"),
  });
  if (error) return json({ error: "SNAPSHOT_WRITE_FAILED", message: error.message }, 500);
  return json({ ...(data ?? {}), predictionHash });
});
