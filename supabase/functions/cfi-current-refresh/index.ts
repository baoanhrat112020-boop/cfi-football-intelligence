import { createClient } from "npm:@supabase/supabase-js@2";
// manifest is bundled at deploy time; redeploy this function after editing config/sources.json.
import manifest from "../../../config/sources.json" with { type: "json" };
import { runBulkImport } from "../_shared/cfi-import-core.ts";
import { normalizeRefreshRequest } from "../_shared/cfi-current-refresh.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

async function callInternal(supabaseUrl: string, serviceRole: string, slug: string) {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${slug}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceRole}`,
          apikey: serviceRole,
          "content-type": "application/json",
        },
        body: "{}",
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 1000) }; }
      if (response.ok) return { status: "COMPLETED", attempt, httpStatus: response.status, body };
      lastError = `HTTP_${response.status}:${text.slice(0, 500)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return { status: "ERROR", error: lastError };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);

  const startedAt = new Date();
  const startedMs = Date.now();

  try {
    const payload = await request.json().catch(() => ({}));
    const { concurrency, filters } = normalizeRefreshRequest(payload);
    const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

    const result = await runBulkImport(manifest, filters, {
      concurrency,
      batchSize: 500,
      fetchText: async (url) => {
        const response = await fetch(url, { headers: { "user-agent": "CFI-Football-Intelligence/5.1", accept: "text/csv,text/plain" } });
        if ([300, 404].includes(response.status)) throw new Error(`SOURCE_NOT_AVAILABLE:${response.status}`);
        if (!response.ok) throw new Error(`CSV_FETCH_FAILED:${response.status}`);
        return response.text();
      },
      upsertBatch: async (fixtures) => {
        const { data, error } = await client.rpc("cfi_upsert_fixtures_batch", { p_fixtures: fixtures });
        if (error) throw new Error(`BATCH_RPC_FAILED:${error.message}`);
        if (!data?.counters) throw new Error("INVALID_BATCH_RESPONSE");
        return data;
      },
    });

    const resultCollector = await callInternal(supabaseUrl, serviceRole, "cfi-result-collector");
    const collectorSettled = Number((resultCollector as any)?.body?.settlement?.settled ?? 0);

    let settlement: any = { status: "NOT_RUN", settled: 0 };
    const { data: settlementData, error: settlementError } = await client.rpc("cfi_settle_prediction_snapshots");
    if (settlementError) settlement = { status: "ERROR", settled: 0, message: settlementError.message };
    else if (settlementData) settlement = settlementData;

    const totalNewSettlements = collectorSettled + Number(settlement?.settled ?? 0);
    const learning = !settlementError && totalNewSettlements > 0
      ? await callInternal(supabaseUrl, serviceRole, "cfi-calibration-learn")
      : { status: "SKIPPED", reason: settlementError ? "SETTLEMENT_ERROR" : "NO_NEW_SETTLEMENTS" };

    const finishedAt = new Date();
    return json({
      status: result.status,
      mode: "CURRENT_SEASON_REFRESH",
      runId: crypto.randomUUID(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: Date.now() - startedMs,
      selectedSources: result.sources.length,
      completedSources: result.checkpoint.completedSourceIds.length,
      unavailableSources: result.checkpoint.unavailableSourceIds?.length ?? 0,
      failedSources: result.checkpoint.failedSourceIds.length,
      counters: result.counters,
      resultCollector,
      settlement,
      totalNewSettlements,
      learning,
      checkpoint: result.checkpoint,
      sources: result.sources,
    }, result.status === "PARTIAL" ? 207 : 200);
  } catch (error) {
    return json({
      error: "CURRENT_REFRESH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedMs,
    }, 400);
  }
});
