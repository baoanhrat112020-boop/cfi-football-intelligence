#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUS_CONTEXT = 'CFI Independent AI Auditor V1';

function cleanDescription(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
}

export function statusPayloadFromReport(report, targetUrl = null) {
  const verdict = String(report?.verdict ?? 'MISSING').toUpperCase();
  const reason = String(report?.reason ?? 'AI_AUDIT_REPORT_MISSING');
  const state = verdict === 'PASS' ? 'success' : (verdict === 'MISSING' ? 'error' : 'failure');
  const description = cleanDescription(
    verdict === 'PASS'
      ? 'Independent AI audit PASS'
      : `Independent AI audit ${verdict}: ${reason}`,
  );
  return {
    state,
    context: STATUS_CONTEXT,
    description,
    ...(targetUrl ? { target_url: targetUrl } : {}),
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function readReport(reportPath) {
  try {
    if (!reportPath || !fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  const headSha = args['head-sha'];
  const reportPath = args.report ?? 'audit-reports/independent-ai/latest.json';
  const targetUrl = args['target-url'] ?? null;
  const report = readReport(reportPath);
  const payload = statusPayloadFromReport(report, targetUrl);

  if (!token || !repo || !/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) {
    console.error('CFI_AI_STATUS=ERROR CONFIGURATION_INVALID');
    process.exit(2);
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/statuses/${headSha}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error(`CFI_AI_STATUS=ERROR GITHUB_HTTP_${response.status}`);
    process.exit(2);
  }

  console.log(`CFI_AI_STATUS=${payload.state.toUpperCase()}`);
  console.log(`CFI_AI_STATUS_CONTEXT=${STATUS_CONTEXT}`);
  process.exit(payload.state === 'success' ? 0 : 1);
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch(error => {
    console.error(`CFI_AI_STATUS=ERROR ${String(error?.message ?? error)}`);
    process.exit(2);
  });
}
