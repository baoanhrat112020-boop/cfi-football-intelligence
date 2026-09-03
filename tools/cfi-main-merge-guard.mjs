#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIT_CONTEXT = 'CFI Independent AI Auditor V1';

function statusTime(status) {
  return Date.parse(status?.updated_at ?? status?.created_at ?? 0) || 0;
}

export function latestAuditStatus(statuses = []) {
  return [...statuses]
    .filter(status => status?.context === AUDIT_CONTEXT)
    .sort((a, b) => statusTime(b) - statusTime(a))[0] ?? null;
}

export function classifyAuditStatuses(statuses = []) {
  const status = latestAuditStatus(statuses);
  if (!status) return { outcome: 'WAIT', reason: 'AI_AUDIT_STATUS_MISSING', status: null };

  const state = String(status.state ?? '').trim().toLowerCase();
  if (state === 'success') return { outcome: 'PASS', reason: 'AI_AUDIT_STATUS_SUCCESS', status };
  if (state === 'pending') return { outcome: 'WAIT', reason: 'AI_AUDIT_STATUS_PENDING', status };
  return {
    outcome: 'FAIL',
    reason: `AI_AUDIT_STATUS_${state ? state.toUpperCase() : 'UNKNOWN'}`,
    status,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function githubJson(token, apiPath) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  return text ? JSON.parse(text) : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fail(reason, details = {}) {
  console.error(`CFI_MAIN_MERGE_GUARD=FAIL`);
  console.error(`REASON=${reason}`);
  for (const [key, value] of Object.entries(details)) {
    if (value !== null && value !== undefined) console.error(`${key}=${value}`);
  }
  process.exitCode = 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  const mergeSha = args['merge-sha'] ?? process.env.GITHUB_SHA;
  const attempts = Math.max(1, Number(args.attempts ?? 18));
  const intervalMs = Math.max(0, Number(args['interval-ms'] ?? 10_000));

  if (!token || !repo || !mergeSha || !Number.isFinite(attempts) || !Number.isFinite(intervalMs)) {
    fail('GUARD_CONFIGURATION_INVALID');
    return;
  }

  const associated = await githubJson(token, `/repos/${repo}/commits/${mergeSha}/pulls`);
  const merged = (Array.isArray(associated) ? associated : [])
    .filter(pr => pr?.merged_at || pr?.merge_commit_sha === mergeSha)
    .sort((a, b) => (Date.parse(b?.merged_at ?? 0) || 0) - (Date.parse(a?.merged_at ?? 0) || 0));

  if (!merged.length) {
    fail('NO_ASSOCIATED_MERGED_PR', { MERGE_SHA: mergeSha });
    return;
  }

  const pr = merged[0];
  const prNumber = pr?.number ?? null;
  const headSha = pr?.head?.sha ?? null;
  if (!prNumber || !headSha) {
    fail('ASSOCIATED_PR_IDENTITY_INCOMPLETE', { MERGE_SHA: mergeSha, PR: prNumber, PR_HEAD: headSha });
    return;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const combined = await githubJson(token, `/repos/${repo}/commits/${headSha}/status`);
    const verdict = classifyAuditStatuses(combined?.statuses ?? []);
    console.log(`CFI_MAIN_MERGE_GUARD_ATTEMPT=${attempt}/${attempts}`);
    console.log(`PR=${prNumber}`);
    console.log(`PR_HEAD=${headSha}`);
    console.log(`AI_STATUS_OUTCOME=${verdict.outcome}`);
    console.log(`AI_STATUS_REASON=${verdict.reason}`);

    if (verdict.outcome === 'PASS') {
      console.log('CFI_MAIN_MERGE_GUARD=PASS');
      process.exitCode = 0;
      return;
    }
    if (verdict.outcome === 'FAIL') {
      fail(verdict.reason, {
        PR: prNumber,
        PR_HEAD: headSha,
        TARGET_URL: verdict.status?.target_url ?? null,
      });
      return;
    }
    if (attempt < attempts) await sleep(intervalMs);
  }

  fail('AI_AUDIT_STATUS_NOT_SUCCESS_BEFORE_TIMEOUT', { PR: prNumber, PR_HEAD: headSha });
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch(error => {
    fail(`GUARD_RUNTIME_ERROR:${String(error?.message ?? error).replace(/[^A-Za-z0-9_:.-]/g, '_')}`);
  });
}
