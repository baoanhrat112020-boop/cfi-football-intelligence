import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type Env = {
  CFI_DB_BASE_URL?: string;
  CFI_DB_KEY?: string;
};

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

async function callCFI(env: Env, path: string, init?: RequestInit) {
  if (!env.CFI_DB_BASE_URL) {
    return { status: "CONFIG_REQUIRED", message: "CFI_DB_BASE_URL is not configured on the Worker yet." };
  }
  const headers = new Headers(init?.headers || {});
  headers.set("accept", "application/json");
  if (env.CFI_DB_KEY) headers.set("x-cfi-key", env.CFI_DB_KEY);
  const res = await fetch(`${env.CFI_DB_BASE_URL.replace(/\/$/, "")}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { httpStatus: res.status, ok: res.ok, body };
}

function createServer(env: Env) {
  const server = new McpServer({ name: "CFI Football Intelligence", version: "4.0.0" });

  server.registerTool("cfi_db_status", {
    description: "Read the live Persistent CFI database status.",
    inputSchema: {}
  }, async () => jsonText(await callCFI(env, "/status")));

  server.registerTool("cfi_team_history", {
    description: "Read canonical history for one exact football team from Persistent CFI DB.",
    inputSchema: { team: z.string().min(1) }
  }, async ({ team }) => jsonText(await callCFI(env, `/team-history?team=${encodeURIComponent(team)}`)));

  server.registerTool("cfi_h2h", {
    description: "Read canonical head-to-head history for two exact football teams.",
    inputSchema: { home: z.string().min(1), away: z.string().min(1) }
  }, async ({ home, away }) => jsonText(await callCFI(env, `/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`)));

  server.registerTool("cfi_predict_match", {
    description: "Request the CFI prediction pipeline for the four frozen markets. Manual team metrics are not accepted; CFI must derive evidence from its database and verified context.",
    inputSchema: {
      home: z.string().min(1),
      away: z.string().min(1),
      matchDate: z.string().optional(),
      language: z.string().default("vi")
    }
  }, async (input) => {
    const result = await callCFI(env, "/predict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return jsonText(result);
  });

  server.registerTool("cfi_live_event", {
    description: "Send a verified live match event such as a red card to CFI live intelligence for contextual escalation analysis.",
    inputSchema: {
      home: z.string().min(1),
      away: z.string().min(1),
      minute: z.number().min(0).max(130),
      eventType: z.enum(["RED_CARD", "GOAL", "SCORE_UPDATE"]),
      team: z.enum(["HOME", "AWAY"]).optional(),
      score: z.string().optional()
    }
  }, async (input) => {
    const result = await callCFI(env, "/live-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return jsonText(result);
  });

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({ status: "OK", service: "CFI Football Intelligence MCP", version: "4.0.0", mcp: "/mcp" });
    }
    return createMcpHandler(() => createServer(env), { route: "/mcp" })(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
