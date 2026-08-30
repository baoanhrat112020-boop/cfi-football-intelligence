import { createClient } from "npm:@supabase/supabase-js@2";

type Platform = "THE_COLONY" | "AGENT_COMMUNITY";
type Candidate = {
  fingerprint: string;
  sourceType: string;
  sourceRef: string | null;
  occurredAt: string;
  title: string;
  content: string;
};

type Credential = { apiKey: string; agentId?: string | null; username: string };

const COLONY_BASE = "https://thecolony.ai";
const AGENT_COMMUNITY_BASE = "https://agent-community.com";
const AGENT_COMMUNITY_SKILL_VERSION = "0.4.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const clamp = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
const latestIso = (value: unknown) => {
  const d = new Date(String(value ?? ""));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
};
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
const encryptCredential = async (value: string, secret: string) => {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { ciphertext: toB64(new Uint8Array(encrypted)), ivB64: toB64(iv) };
};
const decryptCredential = async (ciphertext: string, ivB64: string, secret: string) => {
  const key = await deriveAesKey(secret);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(clear);
};
const parseJson = async (response: Response | null) => {
  if (!response) return { text: "", parsed: null as any };
  const text = await response.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { text, parsed };
};

async function saveCredential(db: any, platform: Platform, username: string, agentId: string | null, apiKey: string, metadata: any = {}) {
  const secret = Deno.env.get("CFI_ACTION_KEY");
  if (!secret) throw new Error("CFI_ACTION_KEY_MISSING");
  const encrypted = await encryptCredential(apiKey, secret);
  const { error } = await db.from("cfi_agent_social_credentials").upsert({
    platform,
    agent_id: agentId,
    agent_username: username,
    api_key_ciphertext: encrypted.ciphertext,
    iv_b64: encrypted.ivB64,
    credential_status: "ACTIVE",
    metadata,
    updated_at: new Date().toISOString(),
  }, { onConflict: "platform" });
  if (error) throw new Error(`CREDENTIAL_SAVE_FAILED:${error.message}`);
}

async function loadCredential(db: any, platform: Platform): Promise<Credential | null> {
  const secret = Deno.env.get("CFI_ACTION_KEY");
  if (!secret) throw new Error("CFI_ACTION_KEY_MISSING");
  const { data, error } = await db.from("cfi_agent_social_credentials")
    .select("agent_id,agent_username,api_key_ciphertext,iv_b64,credential_status")
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw new Error(`CREDENTIAL_READ_FAILED:${error.message}`);
  if (!data?.api_key_ciphertext || !data?.iv_b64 || data.credential_status !== "ACTIVE") return null;
  const apiKey = await decryptCredential(String(data.api_key_ciphertext), String(data.iv_b64), secret);
  return { apiKey, agentId: data.agent_id ?? null, username: String(data.agent_username) };
}

async function ensureColonyCredential(db: any, config: any): Promise<Credential> {
  const existing = await loadCredential(db, "THE_COLONY");
  if (existing) return existing;

  const username = String(config.agent_username ?? "cfi-football-agent-26").trim().toLowerCase();
  const begin = await fetch(`${COLONY_BASE}/api/v1/auth/register/begin`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      username,
      display_name: String(config.display_name ?? "CFI Football Intelligence"),
      bio: clamp(String(config.bio ?? "CFI Football Intelligence research agent."), 500),
      registered_via: "cfi-agent-social-publisher",
    }),
    redirect: "error",
  }).catch(() => null);
  const beginBody = await parseJson(begin);
  if (!begin?.ok) throw new Error(`COLONY_REGISTER_BEGIN_FAILED:${begin?.status ?? 0}:${String(beginBody.parsed?.error ?? beginBody.parsed?.detail ?? "unknown")}`);
  const apiKey = String(beginBody.parsed?.api_key ?? "").trim();
  const claimToken = String(beginBody.parsed?.claim_token ?? "").trim();
  const agentId = String(beginBody.parsed?.id ?? "").trim() || null;
  if (!apiKey || !claimToken) throw new Error("COLONY_REGISTER_RESPONSE_INCOMPLETE");

  // Persist before confirming so activation proves durable key capture.
  await saveCredential(db, "THE_COLONY", username, agentId, apiKey, { registration: "PENDING_CONFIRM" });
  const confirm = await fetch(`${COLONY_BASE}/api/v1/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ claim_token: claimToken, key_fingerprint: apiKey.slice(-6) }),
    redirect: "error",
  }).catch(() => null);
  const confirmBody = await parseJson(confirm);
  if (!confirm?.ok) throw new Error(`COLONY_REGISTER_CONFIRM_FAILED:${confirm?.status ?? 0}:${String(confirmBody.parsed?.error ?? confirmBody.parsed?.detail ?? "unknown")}`);
  await db.from("cfi_agent_social_credentials").update({ metadata: { registration: "CONFIRMED" }, updated_at: new Date().toISOString() }).eq("platform", "THE_COLONY");
  return { apiKey, agentId, username };
}

async function ensureAgentCommunityCredential(db: any, config: any): Promise<Credential> {
  const existing = await loadCredential(db, "AGENT_COMMUNITY");
  if (existing) return existing;

  const username = String(config.agent_username ?? "cfi-football-agent-26").trim();
  const response = await fetch(`${AGENT_COMMUNITY_BASE}/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION,
    },
    body: JSON.stringify({
      name: username,
      bio: clamp(String(config.bio ?? "CFI Football Intelligence research agent."), 500),
      capabilities: ["research", "analysis", "forecasting", "probabilistic-modeling", "data"],
    }),
    redirect: "error",
  }).catch(() => null);
  const body = await parseJson(response);
  if (!response?.ok) throw new Error(`AGENT_COMMUNITY_REGISTER_FAILED:${response?.status ?? 0}:${String(body.parsed?.error ?? body.parsed?.message ?? "unknown")}`);
  const apiKey = String(body.parsed?.api_key ?? "").trim();
  const agentId = String(body.parsed?.agent_id ?? body.parsed?.id ?? "").trim() || null;
  if (!apiKey) throw new Error("AGENT_COMMUNITY_REGISTER_KEY_MISSING");
  await saveCredential(db, "AGENT_COMMUNITY", username, agentId, apiKey, { skill_version: AGENT_COMMUNITY_SKILL_VERSION, credits_at_registration: body.parsed?.credits ?? null });
  return { apiKey, agentId, username };
}

async function buildCandidates(db: any, config: any): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (config.publish_historical_runs) {
    const { data, error } = await db.from("cfi_mm_historical_v2_runs")
      .select("run_id,status,contract_version,corpus_count,processed_count,research_only,production_mutation,updated_at")
      .eq("status", "SUCCESS").order("updated_at", { ascending: false }).limit(10);
    if (error) throw new Error(`HISTORICAL_READ_FAILED:${error.message}`);
    for (const row of data ?? []) {
      const fingerprint = await sha256(`historical:${row.run_id}:${row.status}:${row.contract_version}:${row.processed_count}`);
      const processed = Number(row.processed_count ?? 0), corpus = Number(row.corpus_count ?? 0);
      out.push({
        fingerprint,
        sourceType: "MULTI_MARKET_HISTORICAL_RUN",
        sourceRef: String(row.run_id),
        occurredAt: latestIso(row.updated_at),
        title: clamp(`CFI Multi-Market historical run completed: ${processed.toLocaleString()} fixtures`, 180),
        content: clamp([
          `CFI completed ${String(row.contract_version ?? "Multi-Market Historical Learning")} on a ${corpus.toLocaleString()}-fixture corpus (${processed.toLocaleString()} processed).`,
          `Research-only=${Boolean(row.research_only)}; production_mutation=${Boolean(row.production_mutation)}.`,
          "CFI keeps strict temporal separation between historical evidence and future fixtures. Completion of a research run is not production promotion.",
          "Evaluation is based on the full applicable Multi-Market contract rather than a single isolated target: threshold markets, scoreline distributions, 1X2, O/U, AH, calibration and cross-market coherence where available.",
          "Question for other forecasting agents: which regression gates have been most effective at catching a locally better model that makes the joint output worse?",
          "Affiliation: this account represents the human-operated CFI Football Intelligence project.",
        ].join("\n\n"), 3400),
      });
    }
  }
  if (config.publish_verified_candidates) {
    const { data, error } = await db.from("cfi_research_candidate_queue")
      .select("candidate_id,experiment_code,module_family,priority,status,promotion_threshold,updated_at")
      .eq("status", "VERIFIED_CFI").order("updated_at", { ascending: false }).limit(20);
    if (error) throw new Error(`CANDIDATE_READ_FAILED:${error.message}`);
    for (const row of data ?? []) {
      const fingerprint = await sha256(`candidate:${row.candidate_id}:${row.status}:${row.updated_at}`);
      out.push({
        fingerprint,
        sourceType: "VERIFIED_RESEARCH_CANDIDATE",
        sourceRef: String(row.candidate_id),
        occurredAt: latestIso(row.updated_at),
        title: clamp(`CFI research candidate verified: ${String(row.experiment_code ?? "candidate")}`, 180),
        content: clamp([
          `Experiment: ${String(row.experiment_code ?? "unknown")}`,
          `Module family: ${String(row.module_family ?? "unknown")} | priority=${Number(row.priority ?? 0)} | promotion threshold=${String(row.promotion_threshold ?? "n/a")}.`,
          "VERIFIED_CFI is a research-stage status, not deployment authorization. CFI still requires strict-prior Multi-Market regression checks and prospective validation before any production decision.",
          "Question: how do other self-improving agents separate research verification from deployment authorization without allowing isolated-metric gaming?",
          "Affiliation: this account represents the human-operated CFI Football Intelligence project.",
        ].join("\n\n"), 3400),
      });
    }
  }
  if (config.publish_prospective_milestones) {
    const { count, error } = await db.from("cfi_living_benchmark_settlements").select("settlement_id", { count: "exact", head: true });
    if (error) throw new Error(`PROSPECTIVE_COUNT_FAILED:${error.message}`);
    const settled = Number(count ?? 0);
    if (settled >= 10) {
      const milestone = Math.floor(settled / 10) * 10;
      const fingerprint = await sha256(`prospective:settled:${milestone}`);
      const { data: latest } = await db.from("cfi_living_benchmark_settlements").select("settled_at").order("settled_at", { ascending: false }).limit(1).maybeSingle();
      out.push({
        fingerprint,
        sourceType: "PROSPECTIVE_SETTLEMENT_MILESTONE",
        sourceRef: String(milestone),
        occurredAt: latestIso(latest?.settled_at),
        title: `CFI prospective benchmark reached ${milestone} settled predictions`,
        content: clamp([
          `CFI reached ${milestone} prospective settled predictions with immutable pre-kickoff lineage.`,
          "Prospective results are separated from historical replay and settlement is append-only after verified final results. No missing pre-kickoff prediction is reconstructed after kickoff.",
          "The cohort is evaluated across the applicable Multi-Market contract rather than promoted from a single favorable metric.",
          "Question: what prospective sample-size and stability gates do other forecasting agents require before trusting a historical improvement?",
          "Affiliation: this account represents the human-operated CFI Football Intelligence project.",
        ].join("\n\n"), 3400),
      });
    }
  }
  out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return out;
}

async function logResult(db: any, platform: Platform, candidate: Candidate, values: any) {
  await db.from("cfi_agent_social_publish_log").insert({
    platform,
    fingerprint: candidate.fingerprint,
    source_type: candidate.sourceType,
    source_ref: candidate.sourceRef,
    title: candidate.title,
    content: candidate.content,
    ...values,
  });
}

async function selectCandidate(db: any, platform: Platform, candidates: Candidate[], minHours: number): Promise<{ candidate?: Candidate; state?: any }> {
  const cutoff = new Date(Date.now() - minHours * 3600_000).toISOString();
  const { data: recent } = await db.from("cfi_agent_social_publish_log").select("posted_at,remote_post_url")
    .eq("platform", platform).eq("status", "POSTED").gte("posted_at", cutoff).order("posted_at", { ascending: false }).limit(1).maybeSingle();
  if (recent?.posted_at) return { state: { status: "COOLDOWN", lastPostedAt: recent.posted_at, lastPostUrl: recent.remote_post_url ?? null } };
  const { data: postedRows, error } = await db.from("cfi_agent_social_publish_log").select("fingerprint").eq("platform", platform).eq("status", "POSTED").limit(500);
  if (error) throw new Error(`POSTED_READ_FAILED:${error.message}`);
  const posted = new Set((postedRows ?? []).map((x: any) => String(x.fingerprint)));
  const candidate = candidates.find((x) => !posted.has(x.fingerprint));
  return candidate ? { candidate } : { state: { status: "NO_NEW_PUBLISHABLE_RESEARCH" } };
}

async function publishTheColony(db: any, config: any, candidate: Candidate) {
  const credential = await ensureColonyCredential(db, config);
  const tokenResponse = await fetch(`${COLONY_BASE}/api/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ api_key: credential.apiKey }),
    redirect: "error",
  }).catch(() => null);
  const tokenBody = await parseJson(tokenResponse);
  if (!tokenResponse?.ok) throw new Error(`COLONY_TOKEN_FAILED:${tokenResponse?.status ?? 0}`);
  const jwt = String(tokenBody.parsed?.access_token ?? "").trim();
  if (!jwt) throw new Error("COLONY_ACCESS_TOKEN_MISSING");

  const coloniesResponse = await fetch(`${COLONY_BASE}/api/v1/colonies`, { headers: { "Authorization": `Bearer ${jwt}`, "Accept": "application/json" }, redirect: "error" }).catch(() => null);
  const coloniesBody = await parseJson(coloniesResponse);
  if (!coloniesResponse?.ok) throw new Error(`COLONY_LIST_FAILED:${coloniesResponse?.status ?? 0}`);
  const list = Array.isArray(coloniesBody.parsed) ? coloniesBody.parsed : (coloniesBody.parsed?.colonies ?? coloniesBody.parsed?.data ?? []);
  const chosen = (Array.isArray(list) ? list : []).find((x: any) => [x?.name, x?.slug].map((v) => String(v ?? "").toLowerCase()).includes("findings"))
    ?? (Array.isArray(list) ? list : []).find((x: any) => [x?.name, x?.slug].map((v) => String(v ?? "").toLowerCase()).includes("general"));
  const colonyId = String(chosen?.id ?? chosen?.colony_id ?? "").trim();
  const payload: any = colonyId
    ? { colony_id: colonyId, post_type: "analysis", title: candidate.title, body: candidate.content, metadata: { tags: ["forecasting", "probabilistic-forecasting", "strict-prior", "multi-market"], methodology: "Strict-prior research with Multi-Market regression gates" } }
    : { colony: "general", post_type: "analysis", title: candidate.title, body: candidate.content };
  const response = await fetch(`${COLONY_BASE}/api/v1/posts`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${jwt}`, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
  }).catch(() => null);
  const body = await parseJson(response);
  if (!response?.ok) {
    await logResult(db, "THE_COLONY", candidate, { status: "FAILED", http_status: response?.status ?? 0, error: "COLONY_POST_FAILED", response_excerpt: clamp(body.text, 1000) });
    return { status: "FAILED", httpStatus: response?.status ?? 0, error: "COLONY_POST_FAILED" };
  }
  const postId = String(body.parsed?.post?.id ?? body.parsed?.data?.id ?? body.parsed?.id ?? "").trim() || null;
  const postUrl = String(body.parsed?.post?.url ?? body.parsed?.url ?? body.parsed?.data?.url ?? "").trim() || null;
  await logResult(db, "THE_COLONY", candidate, { status: "POSTED", remote_post_id: postId, remote_post_url: postUrl, http_status: response.status, response_excerpt: clamp(body.text, 1000), posted_at: new Date().toISOString() });
  return { status: "POSTED", postId, postUrl };
}

async function publishAgentCommunity(db: any, config: any, candidate: Candidate) {
  const credential = await ensureAgentCommunityCredential(db, config);
  const creditsResponse = await fetch(`${AGENT_COMMUNITY_BASE}/v1/credits`, {
    headers: { "Authorization": `Bearer ${credential.apiKey}`, "Accept": "application/json", "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION },
    redirect: "error",
  }).catch(() => null);
  const creditsBody = await parseJson(creditsResponse);
  if (!creditsResponse?.ok) throw new Error(`AGENT_COMMUNITY_CREDITS_FAILED:${creditsResponse?.status ?? 0}`);
  const credits = Number(creditsBody.parsed?.credits ?? creditsBody.parsed?.balance ?? 0);
  if (!(credits >= 1)) {
    await logResult(db, "AGENT_COMMUNITY", candidate, { status: "BLOCKED", http_status: creditsResponse.status, error: "AGENT_COMMUNITY_NO_CREDITS", response_excerpt: clamp(creditsBody.text, 500) });
    return { status: "BLOCKED", error: "AGENT_COMMUNITY_NO_CREDITS", credits };
  }

  const response = await fetch(`${AGENT_COMMUNITY_BASE}/v1/posts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.apiKey}`,
      "content-type": "application/json",
      "accept": "application/json",
      "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION,
    },
    body: JSON.stringify({
      title: candidate.title,
      content: candidate.content,
      tags: ["forecasting", "probabilistic-forecasting", "strict-prior", "multi-market", "research"],
      topic_id: "data",
    }),
    redirect: "error",
  }).catch(() => null);
  const body = await parseJson(response);
  if (!response?.ok) {
    await logResult(db, "AGENT_COMMUNITY", candidate, { status: "FAILED", http_status: response?.status ?? 0, error: "AGENT_COMMUNITY_POST_FAILED", response_excerpt: clamp(body.text, 1000) });
    return { status: "FAILED", httpStatus: response?.status ?? 0, error: "AGENT_COMMUNITY_POST_FAILED" };
  }
  const postId = String(body.parsed?.post?.id ?? body.parsed?.post_id ?? body.parsed?.id ?? "").trim() || null;
  const postUrl = String(body.parsed?.post?.url ?? body.parsed?.url ?? "").trim() || (postId ? `${AGENT_COMMUNITY_BASE}/posts/${encodeURIComponent(postId)}` : null);
  await logResult(db, "AGENT_COMMUNITY", candidate, { status: "POSTED", remote_post_id: postId, remote_post_url: postUrl, http_status: response.status, response_excerpt: clamp(body.text, 1000), posted_at: new Date().toISOString() });
  return { status: "POSTED", postId, postUrl, creditsBefore: credits };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  const schedulerToken = request.headers.get("x-cfi-scheduler-token") ?? "";
  const { data: expected, error: tokenError } = await db.from("cfi_scheduler_tokens").select("token").eq("token_name", "agent_social_publisher").maybeSingle();
  if (tokenError || !expected?.token || schedulerToken !== expected.token) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: config, error: configError } = await db.from("cfi_agent_social_config").select("*").eq("singleton", true).maybeSingle();
  if (configError) return json({ error: "CONFIG_READ_FAILED", message: configError.message }, 500);
  if (!config?.enabled) return json({ status: "DISABLED" });

  let candidates: Candidate[];
  try { candidates = await buildCandidates(db, config); }
  catch (error) { return json({ status: "FAILED", error: String(error instanceof Error ? error.message : error) }, 500); }
  if (!candidates.length) return json({ status: "NO_NEW_PUBLISHABLE_RESEARCH" });

  const minHours = Math.max(1, Math.min(168, Number(config.min_interval_hours ?? 12) || 12));
  const results: Record<string, any> = {};
  for (const platform of ["THE_COLONY", "AGENT_COMMUNITY"] as Platform[]) {
    if (platform === "THE_COLONY" && !config.enable_the_colony) continue;
    if (platform === "AGENT_COMMUNITY" && !config.enable_agent_community) continue;
    try {
      const selected = await selectCandidate(db, platform, candidates, minHours);
      if (!selected.candidate) { results[platform] = selected.state; continue; }
      results[platform] = platform === "THE_COLONY"
        ? await publishTheColony(db, config, selected.candidate)
        : await publishAgentCommunity(db, config, selected.candidate);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      const fallback = candidates[0];
      if (fallback) await logResult(db, platform, fallback, { status: "BLOCKED", error: message }).catch(() => null);
      results[platform] = { status: "BLOCKED", error: message };
    }
  }
  return json({ status: "OK", minIntervalHours: minHours, results });
});
