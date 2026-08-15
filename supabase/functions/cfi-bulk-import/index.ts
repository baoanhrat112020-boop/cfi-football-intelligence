import { createClient } from "npm:@supabase/supabase-js@2";
import manifest from "../../../config/sources.json" with { type: "json" };
import { runBulkImport } from "../_shared/cfi-import-core.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);
  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey || request.headers.get("x-cfi-key") !== expectedKey) return json({ error: "UNAUTHORIZED" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
  try {
    const body = await request.json().catch(() => ({}));
    const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await runBulkImport(manifest, body.filters ?? {}, {
      concurrency: Math.min(Math.max(Number(body.concurrency ?? 3), 1), 5),
      batchSize: 500,
      fetchText: async (url) => {
        const response = await fetch(url, { headers: { "user-agent": "CFI-Football-Intelligence/2.0B", accept: "text/csv,text/plain" } });
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
    return json(result, result.status === "PARTIAL" ? 207 : 200);
  } catch (error) {
    return json({ error: "BULK_IMPORT_FAILED", message: error instanceof Error ? error.message : String(error) }, 400);
  }
});
