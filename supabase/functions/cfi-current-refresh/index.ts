import { createClient } from "npm:@supabase/supabase-js@2";
import manifest from "../../../config/sources.json" with { type: "json" };
import { runBulkImport } from "../_shared/cfi-import-core.ts";
import { normalizeRefreshRequest } from "../_shared/cfi-current-refresh.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);

  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey || request.headers.get("x-cfi-key") !== expectedKey) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
  }

  const startedAt = new Date();
  const startedMs = Date.now();

  try {
    const payload = await request.json().catch(() => ({}));
    const { concurrency, filters } = normalizeRefreshRequest(payload);
    const client = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await runBulkImport(manifest, filters, {
      concurrency,
      batchSize: 500,
      fetchText: async (url) => {
        const response = await fetch(url, {
          headers: {
            "user-agent": "CFI-Football-Intelligence/2.0C",
            accept: "text/csv,text/plain",
          },
        });
        if (!response.ok) throw new Error(`CSV_FETCH_FAILED:${response.status}`);
        return response.text();
      },
      upsertBatch: async (fixtures) => {
        const { data, error } = await client.rpc("cfi_upsert_fixtures_batch", {
          p_fixtures: fixtures,
        });
        if (error) throw new Error(`BATCH_RPC_FAILED:${error.message}`);
        if (!data?.counters) throw new Error("INVALID_BATCH_RESPONSE");
        return data;
      },
    });

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
      failedSources: result.checkpoint.failedSourceIds.length,
      counters: result.counters,
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
