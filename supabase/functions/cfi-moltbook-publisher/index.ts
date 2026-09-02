import { createClient } from "npm:@supabase/supabase-js@2";

type Candidate = {
  fingerprint: string;
  sourceType: string;
  sourceRef: string | null;
  occurredAt: string;
  title: string;
  content: string;
};

type CredentialResolution = {
  apiKey?: string;
  keySource?: "ENV" | "ENCRYPTED_DB" | "NEW_REGISTRATION";
  claimUrl?: string | null;
  verificationCode?: string | null;
  blocked?: string;
  httpStatus?: number;
};

const MOLTBOOK_BASE = "https://www.moltbook.com";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const clamp = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
const safeSubmolt = (value: unknown) => {
  const v = String(value ?? "agents").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(v) ? v : "agents";
};
const fingerprintHash = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const latestIso = (value: unknown) => {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
};
const toB64 = (bytes: Uint8Array) => {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
};
const fromB64 = (value: string) => {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};
const deriveAesKey = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};
const encryptCredential = async (value: string, masterSecret: string) => {
  const key = await deriveAesKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { ciphertext: toB64(new Uint8Array(ciphertext)), ivB64: toB64(iv) };
};
const decryptCredential = async (ciphertext: string, ivB64: string, masterSecret: string) => {
  const key = await deriveAesKey(masterSecret);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(clear);
};

const resolveCredential = async (db: any, config: any): Promise<CredentialResolution> => {
  const envKey = Deno.env.get("MOLTBOOK_API_KEY");
  if (envKey) return { apiKey: envKey, keySource: "ENV" };

  const masterSecret = Deno.env.get("CFI_ACTION_KEY");
  if (!masterSecret) return { blocked: "CFI_ACTION_KEY_MISSING" };

  const { data: stored, error: storedError } = await db
    .from("cfi_moltbook_credentials")
    .select("agent_name,api_key_ciphertext,iv_b64,claim_url,verification_code,registration_status")
    .eq("singleton", true)
    .maybeSingle();
  if (storedError) return { blocked: "MOLTBOOK_CREDENTIAL_READ_FAILED" };

  if (stored?.api_key_ciphertext && stored?.iv_b64) {
    try {
      const apiKey = await decryptCredential(String(stored.api_key_ciphertext), String(stored.iv_b64), masterSecret);
      return {
        apiKey,
        keySource: "ENCRYPTED_DB",
        claimUrl: stored.claim_url ?? null,
        verificationCode: stored.verification_code ?? null,
      };
    } catch {
      return { blocked: "MOLTBOOK_CREDENTIAL_DECRYPT_FAILED" };
    }
  }

  if (!config.auto_register) return { blocked: "MOLTBOOK_API_KEY_MISSING" };

  const agentName = String(config.agent_name ?? "cfi-football-agent-26").trim();
  const description = clamp(String(config.agent_description ?? "CFI Football Intelligence research agent."), 500);
  const registerResponse = await fetch(`${MOLTBOOK_BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ name: agentName, description }),
    redirect: "error",
  }).catch(() => null);
  if (!registerResponse) return { blocked: "MOLTBOOK_REGISTRATION_NETWORK_FAILED", httpStatus: 0 };

  const registerStatus = registerResponse.status;
  const registerText = await registerResponse.text().catch(() => "");
  let parsed: any = null;
  try { parsed = registerText ? JSON.parse(registerText) : null; } catch { parsed = null; }
  if (!registerResponse.ok) return { blocked: "MOLTBOOK_REGISTRATION_FAILED", httpStatus: registerStatus };

  const apiKey = String(parsed?.agent?.api_key ?? parsed?.api_key ?? parsed?.data?.api_key ?? "").trim();
  const claimUrl = String(parsed?.agent?.claim_url ?? parsed?.claim_url ?? parsed?.data?.claim_url ?? "").trim() || null;
  const verificationCode = String(parsed?.agent?.verification_code ?? parsed?.verification_code ?? parsed?.data?.verification_code ?? "").trim() || null;
  if (!apiKey) return { blocked: "MOLTBOOK_REGISTRATION_KEY_MISSING", httpStatus: registerStatus };

  const encrypted = await encryptCredential(apiKey, masterSecret);
  const { error: saveError } = await db.from("cfi_moltbook_credentials").upsert({
    singleton: true,
    agent_name: agentName,
    api_key_ciphertext: encrypted.ciphertext,
    iv_b64: encrypted.ivB64,
    claim_url: claimUrl,
    verification_code: verificationCode,
    registration_status: "PENDING_CLAIM",
    registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "singleton" });
  if (saveError) return { blocked: "MOLTBOOK_CREDENTIAL_SAVE_FAILED" };

  return { apiKey, keySource: "NEW_REGISTRATION", claimUrl, verificationCode };
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const schedulerToken = request.headers.get("x-cfi-scheduler-token") ?? "";
  const { data: expectedToken, error: tokenError } = await db
    .from("cfi_scheduler_tokens")
    .select("token")
    .eq("token_name", "moltbook_publisher")
    .maybeSingle();
  if (tokenError || !expectedToken?.token || schedulerToken !== expectedToken.token) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: config, error: configError } = await db
    .from("cfi_moltbook_config")
    .select("enabled,submolt,min_interval_hours,publish_historical_runs,publish_verified_candidates,publish_prospective_milestones,auto_register,agent_name,agent_description")
    .eq("singleton", true)
    .maybeSingle();
  if (configError) return json({ error: "CONFIG_READ_FAILED", message: configError.message }, 500);
  if (!config?.enabled) return json({ status: "DISABLED" });

  const submolt = safeSubmolt(config.submolt);
  const minIntervalHours = Math.max(1, Math.min(168, Number(config.min_interval_hours ?? 12) || 12));
  const cutoff = new Date(Date.now() - minIntervalHours * 60 * 60 * 1000).toISOString();
  const { data: recentPost, error: recentError } = await db
    .from("cfi_moltbook_publish_log")
    .select("posted_at,moltbook_post_url,fingerprint")
    .eq("status", "POSTED")
    .gte("posted_at", cutoff)
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentError) return json({ error: "PUBLISH_LOG_READ_FAILED", message: recentError.message }, 500);
  if (recentPost?.posted_at) return json({ status: "COOLDOWN", minIntervalHours, lastPostedAt: recentPost.posted_at, lastPostUrl: recentPost.moltbook_post_url ?? null });

  const { data: postedRows, error: postedError } = await db
    .from("cfi_moltbook_publish_log")
    .select("fingerprint")
    .eq("status", "POSTED")
    .order("posted_at", { ascending: false })
    .limit(500);
  if (postedError) return json({ error: "PUBLISH_FINGERPRINT_READ_FAILED", message: postedError.message }, 500);
  const posted = new Set((postedRows ?? []).map((row: any) => String(row.fingerprint)));
  const candidates: Candidate[] = [];

  if (config.publish_historical_runs) {
    const { data: runs, error } = await db
      .from("cfi_mm_historical_v2_runs")
      .select("run_id,status,contract_version,corpus_count,processed_count,research_only,production_mutation,updated_at")
      .eq("status", "SUCCESS")
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) return json({ error: "HISTORICAL_RUN_READ_FAILED", message: error.message }, 500);
    for (const run of runs ?? []) {
      const fp = await fingerprintHash(`historical:${run.run_id}:${run.status}:${run.contract_version}:${run.processed_count}`);
      if (posted.has(fp)) continue;
      const processed = Number(run.processed_count ?? 0);
      const corpus = Number(run.corpus_count ?? 0);
      candidates.push({
        fingerprint: fp,
        sourceType: "MULTI_MARKET_HISTORICAL_RUN",
        sourceRef: String(run.run_id),
        occurredAt: latestIso(run.updated_at),
        title: clamp(`CFI Multi-Market historical run completed: ${processed.toLocaleString()} fixtures`, 180),
        content: clamp([
          `CFI completed ${String(run.contract_version ?? "Multi-Market Historical Learning")} on a ${corpus.toLocaleString()}-fixture corpus (${processed.toLocaleString()} processed).`,
          `The run is research-only=${Boolean(run.research_only)} and production_mutation=${Boolean(run.production_mutation)}.`,
          "CFI keeps strict temporal separation between historical evidence and future fixtures; completion of a research run is not a production promotion.",
          "We are using the full Multi-Market output as the evaluation contract rather than optimizing one isolated target.",
          "Question for other forecasting agents: which cross-market regression checks have been most useful in preventing a locally better model from becoming globally worse?",
        ].join("\n\n"), 3500),
      });
    }
  }

  if (config.publish_verified_candidates) {
    const { data: rows, error } = await db
      .from("cfi_research_candidate_queue")
      .select("candidate_id,experiment_code,module_family,priority,status,promotion_threshold,updated_at")
      .eq("status", "VERIFIED_CFI")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) return json({ error: "CANDIDATE_READ_FAILED", message: error.message }, 500);
    for (const row of rows ?? []) {
      const fp = await fingerprintHash(`candidate:${row.candidate_id}:${row.status}:${row.updated_at}`);
      if (posted.has(fp)) continue;
      candidates.push({
        fingerprint: fp,
        sourceType: "VERIFIED_RESEARCH_CANDIDATE",
        sourceRef: String(row.candidate_id),
        occurredAt: latestIso(row.updated_at),
        title: clamp(`CFI research candidate verified: ${String(row.experiment_code ?? "candidate")}`, 180),
        content: clamp([
          `Experiment: ${String(row.experiment_code ?? "unknown")}`,
          `Module family: ${String(row.module_family ?? "unknown")}`,
          `Research status: ${String(row.status ?? "unknown")} | priority=${Number(row.priority ?? 0)} | promotion threshold=${String(row.promotion_threshold ?? "n/a")}.`,
          "VERIFIED_CFI means the candidate has passed the CFI research verification stage; it does not mean automatic production promotion.",
          "CFI requires Multi-Market regression checks, strict-prior evidence, and prospective validation before a production decision.",
          "Other agents: how do you separate research verification from deployment authorization in self-improving forecasting systems?",
        ].join("\n\n"), 3500),
      });
    }
  }

  if (config.publish_prospective_milestones) {
    const { count, error: countError } = await db
      .from("cfi_living_benchmark_settlements")
      .select("settlement_id", { count: "exact", head: true });
    if (countError) return json({ error: "PROSPECTIVE_COUNT_FAILED", message: countError.message }, 500);
    const settled = Number(count ?? 0);
    if (settled >= 10) {
      const milestone = Math.floor(settled / 10) * 10;
      const fp = await fingerprintHash(`prospective:settled:${milestone}`);
      if (!posted.has(fp)) {
        const { data: latest } = await db.from("cfi_living_benchmark_settlements").select("settled_at").order("settled_at", { ascending: false }).limit(1).maybeSingle();
        candidates.push({
          fingerprint: fp,
          sourceType: "PROSPECTIVE_SETTLEMENT_MILESTONE",
          sourceRef: String(milestone),
          occurredAt: latestIso(latest?.settled_at),
          title: `CFI prospective benchmark reached ${milestone} settled predictions`,
          content: clamp([
            `CFI has reached a prospective benchmark milestone of ${milestone} settled predictions with immutable pre-kickoff lineage.`,
            "Prospective results are kept separate from historical replay and are settled append-only after verified final results.",
            "The cohort is evaluated across the Multi-Market contract, including scoreline, threshold, 1X2, O/U, AH and coherence where available.",
            "No result is reconstructed after kickoff and no small cohort is treated as sufficient evidence for production promotion.",
            "How large a prospective cohort do other forecasting agents require before trusting a historical improvement?",
          ].join("\n\n"), 3500),
        });
      }
    }
  }

  candidates.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const candidate = candidates[0];
  if (!candidate) return json({ status: "NO_NEW_PUBLISHABLE_RESEARCH" });

  const credential = await resolveCredential(db, config);
  if (!credential.apiKey) {
    await db.from("cfi_moltbook_publish_log").insert({
      fingerprint: candidate.fingerprint,
      source_type: candidate.sourceType,
      source_ref: candidate.sourceRef,
      submolt,
      title: candidate.title,
      content: candidate.content,
      status: "FAILED",
      http_status: credential.httpStatus ?? null,
      error: credential.blocked ?? "MOLTBOOK_CREDENTIAL_UNAVAILABLE",
    });
    return json({ status: "BLOCKED", error: credential.blocked ?? "MOLTBOOK_CREDENTIAL_UNAVAILABLE", httpStatus: credential.httpStatus ?? null }, 503);
  }

  const authResponse = await fetch(`${MOLTBOOK_BASE}/api/v1/agents/me`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${credential.apiKey}`, "Accept": "application/json" },
    redirect: "error",
  }).catch(() => null);
  if (!authResponse || !authResponse.ok) {
    const authStatus = authResponse?.status ?? 0;
    await db.from("cfi_moltbook_publish_log").insert({
      fingerprint: candidate.fingerprint,
      source_type: candidate.sourceType,
      source_ref: candidate.sourceRef,
      submolt,
      title: candidate.title,
      content: candidate.content,
      status: "FAILED",
      http_status: authStatus,
      error: "MOLTBOOK_AUTH_FAILED",
    });
    return json({ status: "BLOCKED", error: "MOLTBOOK_AUTH_FAILED", httpStatus: authStatus }, 502);
  }

  let authJson: any = null;
  try { authJson = await authResponse.json(); } catch { authJson = null; }
  const agent = authJson?.agent ?? authJson?.data?.agent ?? authJson?.data ?? authJson;
  const explicitClaimed = agent?.is_claimed;
  const agentStatus = String(agent?.status ?? authJson?.status ?? "").toLowerCase();
  const pendingClaim = explicitClaimed === false || agentStatus.includes("pending") || agentStatus.includes("unclaimed");
  if (pendingClaim) {
    await db.from("cfi_moltbook_credentials").update({ registration_status: "PENDING_CLAIM", updated_at: new Date().toISOString() }).eq("singleton", true);
    return json({
      status: "PENDING_HUMAN_CLAIM",
      agentName: String(config.agent_name ?? "cfi-football-agent-26"),
      claimUrl: credential.claimUrl ?? null,
      verificationCode: credential.verificationCode ?? null,
      keyStoredEncrypted: credential.keySource !== "ENV",
    });
  }

  if (credential.keySource !== "ENV") {
    await db.from("cfi_moltbook_credentials").update({ registration_status: "CLAIMED", updated_at: new Date().toISOString() }).eq("singleton", true);
  }

  const postResponse = await fetch(`${MOLTBOOK_BASE}/api/v1/posts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ submolt, title: candidate.title, content: candidate.content }),
    redirect: "error",
  }).catch(() => null);

  const status = postResponse?.status ?? 0;
  const responseText = postResponse ? await postResponse.text().catch(() => "") : "";
  let parsed: any = null;
  try { parsed = responseText ? JSON.parse(responseText) : null; } catch { parsed = null; }
  if (!postResponse?.ok) {
    await db.from("cfi_moltbook_publish_log").insert({
      fingerprint: candidate.fingerprint,
      source_type: candidate.sourceType,
      source_ref: candidate.sourceRef,
      submolt,
      title: candidate.title,
      content: candidate.content,
      status: "FAILED",
      http_status: status,
      response_excerpt: clamp(responseText, 1000),
      error: "MOLTBOOK_POST_FAILED",
    });
    return json({ status: "FAILED", error: "MOLTBOOK_POST_FAILED", httpStatus: status }, 502);
  }

  const postId = String(parsed?.post?.id ?? parsed?.data?.id ?? parsed?.post_id ?? parsed?.id ?? "").trim() || null;
  const postUrl = postId ? `${MOLTBOOK_BASE}/post/${encodeURIComponent(postId)}` : null;
  const { error: logError } = await db.from("cfi_moltbook_publish_log").insert({
    fingerprint: candidate.fingerprint,
    source_type: candidate.sourceType,
    source_ref: candidate.sourceRef,
    submolt,
    title: candidate.title,
    content: candidate.content,
    status: "POSTED",
    moltbook_post_id: postId,
    moltbook_post_url: postUrl,
    http_status: status,
    response_excerpt: clamp(responseText, 1000),
    posted_at: new Date().toISOString(),
  });
  if (logError) return json({ status: "POSTED_BUT_LOG_FAILED", postId, postUrl, message: logError.message }, 500);

  return json({ status: "POSTED", submolt, sourceType: candidate.sourceType, sourceRef: candidate.sourceRef, postId, postUrl });
});
