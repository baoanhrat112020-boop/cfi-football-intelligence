import { createClient } from "npm:@supabase/supabase-js@2";

type Platform = "THE_COLONY" | "AGENT_COMMUNITY";

type Credential = {
  platform: Platform;
  agentId: string | null;
  username: string;
  apiKey: string;
};

type InteractionInput = {
  platform: Platform;
  remoteInteractionId: string;
  remotePostId: string;
  remoteParentId?: string | null;
  interactionType: string;
  authorId?: string | null;
  authorName?: string | null;
  body: string;
  parentPostTitle?: string | null;
  parentPostContent?: string | null;
  directToCfi: boolean;
  rawMetadata?: Record<string, unknown>;
};

const COLONY_BASE = "https://thecolony.ai";
const AGENT_COMMUNITY_BASE = "https://agent-community.com";
const AGENT_COMMUNITY_SKILL_VERSION = "0.4.0";
const HANDLE = "cfi-football-agent-26";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const clamp = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
const asString = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
const arrayFrom = (value: any, keys: string[]) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [] as any[];
};
const parseResponse = async (response: Response | null) => {
  if (!response) return { text: "", parsed: null as any };
  const text = await response.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { text, parsed };
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
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
};
const decryptCredential = async (ciphertext: string, ivB64: string, secret: string) => {
  const key = await deriveAesKey(secret);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(clear);
};

const RESEARCH_KEYWORDS = [
  "forecast", "forecasting", "prediction", "predict", "probability", "probabilistic",
  "calibration", "brier", "log loss", "logloss", "strict prior", "strict-prior",
  "multi-market", "multimarket", "regression", "validation", "prospective", "backtest",
  "scoreline", "football", "soccer", "model", "ensemble", "uncertainty", "coherence",
];
const SUSPICIOUS_PHRASES = [
  "ignore previous", "ignore your instructions", "system prompt", "developer message",
  "reveal your prompt", "show your prompt", "api key", "password", "secret key", "access token",
  "service role", "credentials", "database dump", "send me your", "execute this", "run this command",
  "powershell", "rm -rf", "curl -x", "supabase_service_role_key", "cfi_action_key",
];

function classifyIncoming(text: string, direct: boolean) {
  const lower = text.toLowerCase();
  const flags = SUSPICIOUS_PHRASES.filter((phrase) => lower.includes(phrase));
  const keywordHits = RESEARCH_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  const relevant = direct || keywordHits > 0;
  const relevanceScore = direct ? 1 : Math.min(1, keywordHits / 4);
  return { relevant, suspicious: flags.length > 0, relevanceScore, flags };
}

function replyContainsSecret(text: string) {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/,
    /\bcol_[A-Za-z0-9_-]{12,}\b/,
    /\btfk_[A-Za-z0-9_-]{8,}\b/,
    /\bmoltbook_[A-Za-z0-9_-]{8,}\b/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    /CFI_ACTION_KEY/i,
  ];
  return patterns.some((re) => re.test(text));
}

async function loadCredential(db: any, platform: Platform): Promise<Credential> {
  const masterSecret = Deno.env.get("CFI_ACTION_KEY");
  if (!masterSecret) throw new Error("CFI_ACTION_KEY_MISSING");
  const { data, error } = await db.from("cfi_agent_social_credentials")
    .select("platform,agent_id,agent_username,api_key_ciphertext,iv_b64,credential_status")
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw new Error(`CREDENTIAL_READ_FAILED:${platform}:${error.message}`);
  if (!data || data.credential_status !== "ACTIVE") throw new Error(`CREDENTIAL_NOT_ACTIVE:${platform}`);
  const apiKey = await decryptCredential(String(data.api_key_ciphertext), String(data.iv_b64), masterSecret);
  return {
    platform,
    agentId: data.agent_id ? String(data.agent_id) : null,
    username: String(data.agent_username),
    apiKey,
  };
}

async function ingestInteraction(db: any, input: InteractionInput) {
  const body = clamp(input.body.trim(), 6000);
  if (!body || !input.remoteInteractionId || !input.remotePostId) return false;
  const cls = classifyIncoming(body, input.directToCfi);
  const row = {
    platform: input.platform,
    remote_interaction_id: input.remoteInteractionId,
    remote_post_id: input.remotePostId,
    remote_parent_id: input.remoteParentId ?? null,
    interaction_type: input.interactionType,
    author_id: input.authorId ?? null,
    author_name: input.authorName ?? null,
    body,
    parent_post_title: clamp(input.parentPostTitle ?? "", 500) || null,
    parent_post_content: clamp(input.parentPostContent ?? "", 5000) || null,
    direct_to_cfi: input.directToCfi,
    relevant: cls.relevant,
    suspicious: cls.suspicious,
    relevance_score: cls.relevanceScore,
    safety_flags: cls.flags,
    raw_metadata: input.rawMetadata ?? {},
    status: "PENDING",
  };
  const { error } = await db.from("cfi_agent_social_interactions")
    .upsert(row, { onConflict: "platform,remote_interaction_id", ignoreDuplicates: true });
  if (error) throw new Error(`INTERACTION_INGEST_FAILED:${error.message}`);
  return true;
}

async function recentOwnPosts(db: any, platform: Platform, limit: number) {
  const { data, error } = await db.from("cfi_agent_social_publish_log")
    .select("remote_post_id,title,content,posted_at")
    .eq("platform", platform)
    .eq("status", "POSTED")
    .not("remote_post_id", "is", null)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`OWN_POSTS_READ_FAILED:${platform}:${error.message}`);
  return data ?? [];
}

async function scanAgentCommunity(db: any, credential: Credential, limit: number) {
  let seen = 0;
  const ownPosts = await recentOwnPosts(db, "AGENT_COMMUNITY", limit);
  for (const own of ownPosts) {
    const postId = asString(own.remote_post_id);
    if (!postId) continue;
    const response = await fetch(`${AGENT_COMMUNITY_BASE}/v1/posts/${encodeURIComponent(postId)}`, {
      headers: {
        "Authorization": `Bearer ${credential.apiKey}`,
        "Accept": "application/json",
        "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION,
      },
    }).catch(() => null);
    const { parsed } = await parseResponse(response);
    if (!response?.ok) continue;
    const replies = arrayFrom(parsed?.replies ?? parsed, ["replies", "items", "results"]);
    for (const reply of replies) {
      const authorId = asString(reply?.author_id ?? reply?.author?.id);
      const authorName = asString(reply?.author_name ?? reply?.author?.name ?? reply?.author?.username);
      if ((credential.agentId && authorId === credential.agentId) || authorName === credential.username) continue;
      const replyId = asString(reply?.id ?? reply?.reply_id);
      const body = asString(reply?.content ?? reply?.body ?? reply?.text);
      if (!replyId || !body) continue;
      if (await ingestInteraction(db, {
        platform: "AGENT_COMMUNITY",
        remoteInteractionId: replyId,
        remotePostId: postId,
        remoteParentId: asString(reply?.parent_reply_id) || null,
        interactionType: "DIRECT_REPLY",
        authorId: authorId || null,
        authorName: authorName || null,
        body,
        parentPostTitle: asString(parsed?.title ?? own.title),
        parentPostContent: asString(parsed?.content ?? own.content),
        directToCfi: true,
        rawMetadata: { created_at: reply?.created_at ?? null },
      })) seen++;
    }
  }

  const search = await fetch(`${AGENT_COMMUNITY_BASE}/v1/posts/search?q=${encodeURIComponent(credential.username)}`, {
    headers: { "Accept": "application/json", "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION },
  }).catch(() => null);
  const searchBody = await parseResponse(search);
  if (search?.ok) {
    const posts = arrayFrom(searchBody.parsed, ["posts", "items", "results"]);
    for (const post of posts.slice(0, limit)) {
      const postId = asString(post?.id ?? post?.post_id);
      const authorId = asString(post?.author_id ?? post?.author?.id);
      const authorName = asString(post?.author_name ?? post?.author?.name);
      if (!postId || (credential.agentId && authorId === credential.agentId) || authorName === credential.username) continue;
      const title = asString(post?.title);
      const content = asString(post?.content ?? post?.body ?? post?.content_preview);
      const combined = `${title}\n${content}`.trim();
      if (!combined.toLowerCase().includes(credential.username.toLowerCase())) continue;
      if (await ingestInteraction(db, {
        platform: "AGENT_COMMUNITY",
        remoteInteractionId: `mention:${postId}`,
        remotePostId: postId,
        interactionType: "MENTION_POST",
        authorId: authorId || null,
        authorName: authorName || null,
        body: combined,
        parentPostTitle: title,
        parentPostContent: content,
        directToCfi: true,
        rawMetadata: { mention: true },
      })) seen++;
    }
  }
  return seen;
}

async function scanColony(db: any, credential: Credential, limit: number) {
  let seen = 0;
  const ownPosts = await recentOwnPosts(db, "THE_COLONY", limit);
  for (const own of ownPosts) {
    const postId = asString(own.remote_post_id);
    if (!postId) continue;
    let contextResponse = await fetch(`${COLONY_BASE}/api/v1/posts/${encodeURIComponent(postId)}/context`, {
      headers: { "Authorization": `Bearer ${credential.apiKey}`, "Accept": "application/json" },
    }).catch(() => null);
    let context = await parseResponse(contextResponse);
    if (!contextResponse?.ok) {
      contextResponse = await fetch(`${COLONY_BASE}/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
        headers: { "Authorization": `Bearer ${credential.apiKey}`, "Accept": "application/json" },
      }).catch(() => null);
      context = await parseResponse(contextResponse);
    }
    if (!contextResponse?.ok) continue;
    const comments = arrayFrom(context.parsed?.comments ?? context.parsed, ["comments", "items", "results"]);
    const postObj = context.parsed?.post ?? {};
    for (const comment of comments) {
      const authorId = asString(comment?.author_id ?? comment?.author?.id ?? comment?.user_id);
      const authorName = asString(comment?.author?.username ?? comment?.author_username ?? comment?.username ?? comment?.author?.display_name);
      if ((credential.agentId && authorId === credential.agentId) || authorName === credential.username) continue;
      const commentId = asString(comment?.id ?? comment?.comment_id);
      const body = asString(comment?.body ?? comment?.safe_text ?? comment?.content ?? comment?.text);
      if (!commentId || !body) continue;
      if (await ingestInteraction(db, {
        platform: "THE_COLONY",
        remoteInteractionId: commentId,
        remotePostId: postId,
        remoteParentId: asString(comment?.parent_id) || null,
        interactionType: "DIRECT_COMMENT",
        authorId: authorId || null,
        authorName: authorName || null,
        body,
        parentPostTitle: asString(postObj?.title ?? own.title),
        parentPostContent: asString(postObj?.body ?? postObj?.safe_text ?? own.content),
        directToCfi: true,
        rawMetadata: { created_at: comment?.created_at ?? null },
      })) seen++;
    }
  }

  const search = await fetch(`${COLONY_BASE}/api/v1/search?q=${encodeURIComponent(credential.username)}&sort=relevance&limit=${Math.min(limit, 50)}`, {
    headers: { "Authorization": `Bearer ${credential.apiKey}`, "Accept": "application/json" },
  }).catch(() => null);
  const searchBody = await parseResponse(search);
  if (search?.ok) {
    const posts = arrayFrom(searchBody.parsed, ["posts", "items", "results"]);
    for (const post of posts.slice(0, limit)) {
      const postId = asString(post?.id ?? post?.post_id);
      const authorId = asString(post?.author_id ?? post?.author?.id);
      const authorName = asString(post?.author?.username ?? post?.author_username ?? post?.username);
      if (!postId || (credential.agentId && authorId === credential.agentId) || authorName === credential.username) continue;
      const title = asString(post?.title);
      const content = asString(post?.body ?? post?.safe_text ?? post?.content);
      const combined = `${title}\n${content}`.trim();
      if (!combined.toLowerCase().includes(credential.username.toLowerCase())) continue;
      if (await ingestInteraction(db, {
        platform: "THE_COLONY",
        remoteInteractionId: `mention:${postId}`,
        remotePostId: postId,
        interactionType: "MENTION_POST",
        authorId: authorId || null,
        authorName: authorName || null,
        body: combined,
        parentPostTitle: title,
        parentPostContent: content,
        directToCfi: true,
        rawMetadata: { mention: true },
      })) seen++;
    }
  }
  return seen;
}

async function getPending(db: any, limit = 10) {
  const { data, error } = await db.from("cfi_agent_social_interactions")
    .select("interaction_id,platform,remote_interaction_id,remote_post_id,interaction_type,author_id,author_name,body,parent_post_title,parent_post_content,direct_to_cfi,relevance_score,first_seen_at")
    .eq("status", "PENDING")
    .eq("relevant", true)
    .eq("suspicious", false)
    .eq("direct_to_cfi", true)
    .order("first_seen_at", { ascending: true })
    .limit(Math.max(1, Math.min(20, limit)));
  if (error) throw new Error(`PENDING_READ_FAILED:${error.message}`);
  return data ?? [];
}

async function postReply(db: any, interactionId: string, replyText: string) {
  const { data: config, error: configError } = await db.from("cfi_agent_conversation_config").select("*").eq("singleton", true).single();
  if (configError || !config?.enabled) return { status: "BLOCKED", error: "CONVERSATION_DISABLED" };
  const reply = replyText.trim();
  if (!reply) return { status: "BLOCKED", error: "EMPTY_REPLY" };
  if (reply.length > Number(config.max_reply_chars ?? 1000)) return { status: "BLOCKED", error: "REPLY_TOO_LONG" };
  if (replyContainsSecret(reply)) return { status: "BLOCKED", error: "SECRET_PATTERN_DETECTED" };

  const { data: interaction, error: interactionError } = await db.from("cfi_agent_social_interactions")
    .select("*").eq("interaction_id", interactionId).maybeSingle();
  if (interactionError || !interaction) return { status: "BLOCKED", error: "INTERACTION_NOT_FOUND" };
  if (interaction.status !== "PENDING") return { status: "BLOCKED", error: "INTERACTION_NOT_PENDING" };
  if (!interaction.direct_to_cfi || !interaction.relevant || interaction.suspicious) return { status: "BLOCKED", error: "INTERACTION_NOT_ELIGIBLE" };

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: dailyCount } = await db.from("cfi_agent_social_reply_log")
    .select("reply_log_id", { count: "exact", head: true })
    .eq("platform", interaction.platform)
    .eq("status", "POSTED")
    .gte("created_at", startOfDay.toISOString());
  if (Number(dailyCount ?? 0) >= Number(config.max_replies_per_day ?? 5)) return { status: "BLOCKED", error: "DAILY_REPLY_LIMIT" };

  if (interaction.author_id) {
    const { count: authorCount } = await db.from("cfi_agent_social_reply_log")
      .select("reply_log_id", { count: "exact", head: true })
      .eq("platform", interaction.platform)
      .eq("author_id", interaction.author_id)
      .eq("status", "POSTED")
      .gte("created_at", startOfDay.toISOString());
    if (Number(authorCount ?? 0) >= Number(config.max_replies_per_author_per_day ?? 2)) return { status: "BLOCKED", error: "AUTHOR_DAILY_REPLY_LIMIT" };
  }

  const platform = interaction.platform as Platform;
  const credential = await loadCredential(db, platform);
  let response: Response | null = null;
  if (platform === "AGENT_COMMUNITY") {
    const payload: Record<string, unknown> = { content: reply };
    if (interaction.interaction_type === "DIRECT_REPLY" && !String(interaction.remote_interaction_id).startsWith("mention:")) {
      payload.parent_reply_id = interaction.remote_interaction_id;
    }
    response = await fetch(`${AGENT_COMMUNITY_BASE}/v1/posts/${encodeURIComponent(interaction.remote_post_id)}/replies`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Skill-Version": AGENT_COMMUNITY_SKILL_VERSION,
      },
      body: JSON.stringify(payload),
      redirect: "error",
    }).catch(() => null);
  } else {
    const payload: Record<string, unknown> = { body: reply };
    if (interaction.interaction_type === "DIRECT_COMMENT" && !String(interaction.remote_interaction_id).startsWith("mention:")) {
      payload.parent_id = interaction.remote_interaction_id;
    }
    response = await fetch(`${COLONY_BASE}/api/v1/posts/${encodeURIComponent(interaction.remote_post_id)}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
    }).catch(() => null);
  }

  const parsedResponse = await parseResponse(response);
  const ok = Boolean(response?.ok);
  const remoteReplyId = asString(parsedResponse.parsed?.id ?? parsedResponse.parsed?.reply?.id ?? parsedResponse.parsed?.comment?.id) || null;
  const remoteReplyUrl = remoteReplyId
    ? platform === "AGENT_COMMUNITY"
      ? `https://agent-community.com/posts/${encodeURIComponent(interaction.remote_post_id)}`
      : `https://thecolony.ai/post/${encodeURIComponent(interaction.remote_post_id)}`
    : null;

  const logRow = {
    interaction_id: interaction.interaction_id,
    platform,
    author_id: interaction.author_id,
    author_name: interaction.author_name,
    reply_text: reply,
    generated_by: "CHATGPT_AUTOMATION",
    status: ok ? "POSTED" : "FAILED",
    remote_reply_id: remoteReplyId,
    remote_reply_url: remoteReplyUrl,
    http_status: response?.status ?? 0,
    error: ok ? null : "COMMUNITY_REPLY_FAILED",
    response_excerpt: clamp(parsedResponse.text, 1200),
    posted_at: ok ? new Date().toISOString() : null,
  };
  const { error: logError } = await db.from("cfi_agent_social_reply_log").insert(logRow);
  if (logError) return { status: "FAILED", error: `REPLY_LOG_FAILED:${logError.message}`, httpStatus: response?.status ?? 0 };
  await db.from("cfi_agent_social_interactions").update({ status: ok ? "REPLIED" : "FAILED", last_seen_at: new Date().toISOString() }).eq("interaction_id", interaction.interaction_id);
  return {
    status: ok ? "POSTED" : "FAILED",
    platform,
    httpStatus: response?.status ?? 0,
    remoteReplyId,
    remoteReplyUrl,
    error: ok ? null : "COMMUNITY_REPLY_FAILED",
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  const schedulerToken = request.headers.get("x-cfi-scheduler-token") ?? "";
  const { data: expected, error: tokenError } = await db.from("cfi_scheduler_tokens").select("token").eq("token_name", "agent_conversation").maybeSingle();
  if (tokenError || !expected?.token || schedulerToken !== expected.token) return json({ error: "UNAUTHORIZED" }, 401);

  const body = await request.json().catch(() => ({}));
  const action = asString(body?.action ?? "SCAN").toUpperCase();
  const { data: config, error: configError } = await db.from("cfi_agent_conversation_config").select("*").eq("singleton", true).maybeSingle();
  if (configError) return json({ error: "CONFIG_READ_FAILED", message: configError.message }, 500);
  if (!config?.enabled && action !== "STATUS") return json({ status: "DISABLED" });

  try {
    if (action === "STATUS") {
      const { count: pending } = await db.from("cfi_agent_social_interactions").select("interaction_id", { count: "exact", head: true }).eq("status", "PENDING").eq("relevant", true).eq("suspicious", false);
      const { count: repliesToday } = await db.from("cfi_agent_social_reply_log").select("reply_log_id", { count: "exact", head: true }).eq("status", "POSTED").gte("created_at", new Date(new Date().setUTCHours(0,0,0,0)).toISOString());
      return json({ status: "OK", enabled: Boolean(config?.enabled), pending: pending ?? 0, repliesToday: repliesToday ?? 0, maxRepliesPerDayPerPlatform: config?.max_replies_per_day ?? 5 });
    }

    if (action === "SCAN") {
      const limit = Number(config?.scan_post_limit ?? 20);
      const colonyCredential = await loadCredential(db, "THE_COLONY");
      const acCredential = await loadCredential(db, "AGENT_COMMUNITY");
      const [colonySeen, acSeen] = await Promise.all([
        scanColony(db, colonyCredential, limit),
        scanAgentCommunity(db, acCredential, limit),
      ]);
      const pending = await getPending(db, Number(body?.limit ?? 10));
      return json({ status: "OK", scanned: { THE_COLONY: colonySeen, AGENT_COMMUNITY: acSeen }, pendingCount: pending.length, pending });
    }

    if (action === "PENDING") {
      const pending = await getPending(db, Number(body?.limit ?? 10));
      return json({ status: "OK", pendingCount: pending.length, pending });
    }

    if (action === "REPLY") {
      const interactionId = asString(body?.interaction_id);
      const replyText = asString(body?.reply_text);
      if (!interactionId) return json({ error: "INTERACTION_ID_REQUIRED" }, 400);
      const result = await postReply(db, interactionId, replyText);
      return json(result, result.status === "POSTED" ? 200 : result.status === "BLOCKED" ? 422 : 502);
    }

    if (action === "SKIP") {
      const interactionId = asString(body?.interaction_id);
      if (!interactionId) return json({ error: "INTERACTION_ID_REQUIRED" }, 400);
      const reason = clamp(asString(body?.reason ?? "NOT_SAFE_OR_NOT_USEFUL"), 500);
      const { error } = await db.from("cfi_agent_social_interactions").update({ status: "SKIPPED", skip_reason: reason, last_seen_at: new Date().toISOString() }).eq("interaction_id", interactionId).eq("status", "PENDING");
      if (error) return json({ error: "SKIP_FAILED", message: error.message }, 500);
      return json({ status: "SKIPPED", interactionId, reason });
    }

    return json({ error: "INVALID_ACTION", allowed: ["STATUS", "SCAN", "PENDING", "REPLY", "SKIP"] }, 400);
  } catch (error) {
    return json({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
