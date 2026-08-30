import { createClient } from "npm:@supabase/supabase-js@2";

const MOLTBOOK_BASE = "https://www.moltbook.com";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const fromB64 = (value: string) => {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const deriveAesKey = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
};

const decryptCredential = async (ciphertext: string, ivB64: string, masterSecret: string) => {
  const key = await deriveAesKey(masterSecret);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ciphertext),
  );
  return new TextDecoder().decode(clear);
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const masterSecret = Deno.env.get("CFI_ACTION_KEY");
  if (!supabaseUrl || !serviceRole || !masterSecret) return json({ error: "SERVER_SECRET_MISSING" }, 500);

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const schedulerToken = request.headers.get("x-cfi-scheduler-token") ?? "";
  const { data: expectedToken, error: tokenError } = await db
    .from("cfi_scheduler_tokens")
    .select("token")
    .eq("token_name", "moltbook_publisher")
    .maybeSingle();
  if (tokenError || !expectedToken?.token || schedulerToken !== expectedToken.token) return json({ error: "UNAUTHORIZED" }, 401);

  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "VALID_EMAIL_REQUIRED" }, 422);

  const { data: stored, error: storedError } = await db
    .from("cfi_moltbook_credentials")
    .select("agent_name,api_key_ciphertext,iv_b64")
    .eq("singleton", true)
    .maybeSingle();
  if (storedError) return json({ error: "CREDENTIAL_READ_FAILED" }, 500);
  if (!stored?.api_key_ciphertext || !stored?.iv_b64) return json({ error: "MOLTBOOK_CREDENTIAL_MISSING" }, 409);

  let apiKey = "";
  try {
    apiKey = await decryptCredential(String(stored.api_key_ciphertext), String(stored.iv_b64), masterSecret);
  } catch {
    return json({ error: "MOLTBOOK_CREDENTIAL_DECRYPT_FAILED" }, 500);
  }

  const response = await fetch(`${MOLTBOOK_BASE}/api/v1/agents/me/setup-owner-email`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ email }),
    redirect: "error",
  }).catch(() => null);

  if (!response) return json({ error: "MOLTBOOK_NETWORK_FAILED" }, 502);
  const text = await response.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

  if (!response.ok) {
    return json({
      status: "FAILED",
      error: "MOLTBOOK_SETUP_OWNER_EMAIL_FAILED",
      httpStatus: response.status,
      message: parsed?.message ?? parsed?.error ?? null,
    }, 502);
  }

  await db.from("cfi_moltbook_credentials").update({
    registration_status: "OWNER_EMAIL_SENT",
    updated_at: new Date().toISOString(),
  }).eq("singleton", true);

  return json({
    status: "OWNER_EMAIL_SENT",
    agentName: stored.agent_name,
    email,
    moltbook: parsed ?? { success: true },
  });
});
