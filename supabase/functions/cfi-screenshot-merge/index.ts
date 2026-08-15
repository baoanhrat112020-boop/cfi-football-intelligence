import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cfi-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);

  const expectedKey = Deno.env.get("CFI_ACTION_KEY");
  if (!expectedKey || req.headers.get("x-cfi-key") !== expectedKey) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);

  try {
    const body = await req.json();
    const fixtures = Array.isArray(body?.fixtures)
      ? body.fixtures
      : body?.fixture
        ? [body.fixture]
        : [];

    if (!fixtures.length) return json({ error: "FIXTURES_REQUIRED" }, 400);
    if (fixtures.length > 500) return json({ error: "MAX_500_FIXTURES" }, 400);

    const client = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client.rpc("cfi_ingest_fixtures_v2_batch", {
      p_fixtures: fixtures,
    });

    if (error) {
      return json({ error: "SCREENSHOT_MERGE_FAILED", message: error.message }, 500);
    }

    return json({
      status: data?.status ?? "OK",
      received: fixtures.length,
      counters: data?.counters ?? null,
      contract: "CFI_V2_1_SCREENSHOT_MERGE",
    });
  } catch (error) {
    return json({
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
