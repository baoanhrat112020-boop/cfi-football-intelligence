import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cfi-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey) return json({ error: "SERVER_KEY_NOT_CONFIGURED" }, 500);
  if (req.headers.get("x-cfi-key") !== expectedKey) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SERVER_SECRET_MISSING" }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = String(body?.action || url.searchParams.get("action") || "HISTORY").toUpperCase();
  const targetDate = String(body?.target_date || url.searchParams.get("target_date") || "").slice(0, 10) || null;
  const home = String(body?.home || url.searchParams.get("home") || "").trim() || null;
  const away = String(body?.away || url.searchParams.get("away") || "").trim() || null;
  const settlementStatus = String(body?.settlement_status || url.searchParams.get("settlement_status") || "").toUpperCase() || null;
  const selectedOnly = body?.selected_only !== false && url.searchParams.get("selected_only") !== "false";

  async function history() {
    const { data, error } = await db.rpc("cfi_get_prediction_history", {
      p_target_date: targetDate,
      p_home_team: home,
      p_away_team: away,
      p_selected_only: selectedOnly,
    });
    if (error) throw error;
    let rows = data ?? [];
    if (settlementStatus) rows = rows.filter((r: any) => String(r.settlement_status).toUpperCase() === settlementStatus);
    return rows;
  }

  try {
    if (action === "HISTORY" || action === "RESULTS") {
      const rows = await history();
      return json({ status: "OK", action, count: rows.length, rows });
    }

    if (action === "COLLECT" || action === "SETTLE") {
      const collectorPayload: Record<string, unknown> = {};
      if (body?.snapshot_id) collectorPayload.snapshotId = String(body.snapshot_id);
      const res = await fetch(`${supabaseUrl}/functions/v1/cfi-result-collector`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${serviceRole}`,
          "apikey": serviceRole,
        },
        body: JSON.stringify(collectorPayload),
      });
      const text = await res.text();
      let collector: any = text;
      try { collector = JSON.parse(text); } catch {}
      if (!res.ok) return json({ status: "COLLECTOR_ERROR", httpStatus: res.status, collector }, 502);
      const rows = await history();
      return json({ status: "OK", action: "COLLECT", collector, count: rows.length, rows });
    }

    return json({ error: "INVALID_ACTION", allowed: ["HISTORY", "RESULTS", "COLLECT", "SETTLE"] }, 400);
  } catch (error) {
    return json({ error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});