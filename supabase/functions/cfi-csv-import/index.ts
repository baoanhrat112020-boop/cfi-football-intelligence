import { createClient } from "npm:@supabase/supabase-js@2";
import { importSource } from "../_shared/cfi-import-core.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);
  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey || request.headers.get("x-cfi-key") !== expectedKey) return json({ error: "UNAUTHORIZED" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
  const { csvUrl } = await request.json().catch(() => ({}));
  if (!String(csvUrl ?? "").startsWith("https://")) return json({ error: "VALID_HTTPS_CSV_URL_REQUIRED" }, 400);
  const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await importSource({ id: "manual", url: csvUrl }, {
    batchSize: 500,
    fetchText: async (url) => {
      const response = await fetch(url, { headers: { "user-agent": "CFI-Football-Intelligence/2.0B", accept: "text/csv,text/plain" } });
      if (!response.ok) throw new Error(`CSV_FETCH_FAILED:${response.status}`);
      return response.text();
    },
    upsertBatch: async (fixtures) => {
      const { data, error } = await client.rpc("cfi_upsert_fixtures_batch", { p_fixtures: fixtures });
      if (error) throw new Error(`BATCH_RPC_FAILED:${error.message}`);
      return data;
    },
  });
  return json({ status: result.status === "COMPLETED" ? "OK" : "ERROR", csvUrl, parsedFixtures: result.acceptedRows, rejectedBeforeDb: result.counters.REJECTED, counters: result.counters }, result.status === "COMPLETED" ? 200 : 400);
});
