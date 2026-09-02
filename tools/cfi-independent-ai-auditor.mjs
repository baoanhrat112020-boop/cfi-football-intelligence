#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'CFI_INDEPENDENT_AI_AUDITOR_V1';
export const REVIEW_MARKER = 'CFI_AI_AUDIT_V1';
export const REVIEW_END_MARKER = 'END_CFI_AI_AUDIT_V1';
export const COPILOT_REVIEWER = 'copilot-pull-request-reviewer[bot]';

const VERDICTS = new Set(['PASS', 'FIX_REQUIRED', 'BLOCK_PROMOTION']);
const SEVERITIES = new Set(['NONE', 'P3', 'P2', 'P1', 'P0']);
const CHECK_VALUES = new Set(['PASS', 'FAIL', 'UNKNOWN']);
const REQUIRED_CHECKS = [
  'STRICT_PRIOR',
  'SETTLEMENT_INTEGRITY',
  'SHADOW_ISOLATION',
  'MULTI_MARKET',
  'ARCHITECTURE',
  'TEST_EVIDENCE',
];
const HARD_BLOCK_CHECKS = new Set(['STRICT_PRIOR', 'SETTLEMENT_INTEGRITY', 'SHADOW_ISOLATION']);
const VERDICT_RANK = { PASS: 0, FIX_REQUIRED: 1, BLOCK_PROMOTION: 2 };

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function stricterVerdict(a, b) {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

export function parseStructuredAudit(text) {
  const source = String(text ?? '');
  const start = source.lastIndexOf(REVIEW_MARKER);
  if (start < 0) {
    return { valid: false, reason: 'STRUCTURED_VERDICT_MISSING', fields: {} };
  }

  const afterStart = source.slice(start + REVIEW_MARKER.length);
  const end = afterStart.indexOf(REVIEW_END_MARKER);
  if (end < 0) {
    return { valid: false, reason: 'STRUCTURED_VERDICT_UNTERMINATED', fields: {} };
  }

  const block = afterStart.slice(0, end);
  const fields = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([A-Z_]+)\s*:\s*(.+)$/i);
    if (!match) continue;
    fields[upper(match[1])] = upper(match[2]);
  }

  const missing = ['VERDICT', 'HIGHEST_SEVERITY', ...REQUIRED_CHECKS].filter(key => !fields[key]);
  if (missing.length) {
    return {
      valid: false,
      reason: `STRUCTURED_FIELDS_MISSING:${missing.join(',')}`,
      fields,
    };
  }

  if (!VERDICTS.has(fields.VERDICT)) {
    return { valid: false, reason: 'INVALID_VERDICT', fields };
  }
  if (!SEVERITIES.has(fields.HIGHEST_SEVERITY)) {
    return { valid: false, reason: 'INVALID_HIGHEST_SEVERITY', fields };
  }
  for (const key of REQUIRED_CHECKS) {
    if (!CHECK_VALUES.has(fields[key])) {
      return { valid: false, reason: `INVALID_CHECK_VALUE:${key}`, fields };
    }
  }

  return { valid: true, reason: null, fields };
}

export function normalizeAudit(parsed) {
  if (!parsed?.valid) {
    return {
      contract: CONTRACT,
      verdict: 'BLOCK_PROMOTION',
      highestSeverity: 'P0',
      promotionAllowed: false,
      decisionUse: false,
      productionMutationAllowed: false,
      reason: parsed?.reason ?? 'INVALID_AI_AUDIT',
      checks: {},
    };
  }

  const fields = parsed.fields;
  let verdict = fields.VERDICT;
  const reasons = [];

  if (fields.HIGHEST_SEVERITY === 'P0' || fields.HIGHEST_SEVERITY === 'P1') {
    verdict = stricterVerdict(verdict, 'BLOCK_PROMOTION');
    reasons.push(`HIGH_SEVERITY:${fields.HIGHEST_SEVERITY}`);
  } else if (fields.HIGHEST_SEVERITY === 'P2') {
    verdict = stricterVerdict(verdict, 'FIX_REQUIRED');
    reasons.push('P2_FIX_REQUIRED');
  }

  for (const key of REQUIRED_CHECKS) {
    const value = fields[key];
    if (HARD_BLOCK_CHECKS.has(key) && value !== 'PASS') {
      verdict = stricterVerdict(verdict, 'BLOCK_PROMOTION');
      reasons.push(`${key}:${value}`);
    } else if (!HARD_BLOCK_CHECKS.has(key) && value !== 'PASS') {
      verdict = stricterVerdict(verdict, 'FIX_REQUIRED');
      reasons.push(`${key}:${value}`);
    }
  }

  return {
    contract: CONTRACT,
    verdict,
    highestSeverity: fields.HIGHEST_SEVERITY,
    promotionAllowed: verdict === 'PASS',
    decisionUse: false,
    productionMutationAllowed: false,
    reason: reasons.length ? reasons.join('|') : 'AI_AUDIT_CLEAR',
    checks: Object.fromEntries(REQUIRED_CHECKS.map(key => [key, fields[key]])),
    declaredVerdict: fields.VERDICT,
  };
}

export function evaluateReviewCorpus(items = []) {
  const ordered = [...items].sort((a, b) => {
    const at = Date.parse(a?.createdAt ?? a?.submittedAt ?? 0) || 0;
    const bt = Date.parse(b?.createdAt ?? b?.submittedAt ?? 0) || 0;
    return bt - at;
  });

  for (const item of ordered) {
    const parsed = parseStructuredAudit(item?.body ?? '');
    if (!parsed.valid) continue;
    return {
      ...normalizeAudit(parsed),
      evidence: {
        source: item?.source ?? 'UNKNOWN',
        id: item?.id ?? null,
        url: item?.url ?? null,
        createdAt: item?.createdAt ?? item?.submittedAt ?? null,
      },
    };
  }

  return {
    ...normalizeAudit({ valid: false, reason: 'STRUCTURED_VERDICT_MISSING' }),
    evidence: null,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
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

async function githubRequest(token, apiPath, init = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: response.ok, status: response.status, body };
}

function isCopilot(login) {
  return String(login ?? '').toLowerCase().startsWith('copilot-pull-request-reviewer');
}

function sameHead(item, headSha) {
  const sha = item?.commit_id ?? item?.original_commit_id ?? null;
  return !sha || !headSha || sha === headSha;
}

async function fetchCopilotEvidence(token, repo, prNumber, headSha) {
  const [reviewsRes, commentsRes] = await Promise.all([
    githubRequest(token, `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`),
    githubRequest(token, `/repos/${repo}/pulls/${prNumber}/comments?per_page=100`),
  ]);

  if (!reviewsRes.ok) throw new Error(`REVIEWS_API_${reviewsRes.status}`);
  if (!commentsRes.ok) throw new Error(`COMMENTS_API_${commentsRes.status}`);

  const items = [];
  for (const review of reviewsRes.body ?? []) {
    if (!isCopilot(review?.user?.login) || !sameHead(review, headSha)) continue;
    items.push({
      source: 'COPILOT_REVIEW',
      id: review.id,
      body: review.body ?? '',
      url: review.html_url ?? null,
      createdAt: review.submitted_at ?? null,
    });
  }
  for (const comment of commentsRes.body ?? []) {
    if (!isCopilot(comment?.user?.login) || !sameHead(comment, headSha)) continue;
    items.push({
      source: 'COPILOT_INLINE_COMMENT',
      id: comment.id,
      body: comment.body ?? '',
      url: comment.html_url ?? null,
      createdAt: comment.created_at ?? null,
    });
  }
  return items;
}

function writeReport(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'latest.json');
  const mdPath = path.join(outputDir, 'latest.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const checks = Object.entries(report.checks ?? {})
    .map(([name, value]) => `| ${name} | ${value} |`)
    .join('\n');
  const md = `# CFI Independent AI Auditor V1\n\n` +
    `- Contract: \`${report.contract}\`\n` +
    `- Provider: \`${report.provider}\`\n` +
    `- Verdict: **${report.verdict}**\n` +
    `- Highest severity: \`${report.highestSeverity}\`\n` +
    `- Promotion allowed: \`${report.promotionAllowed}\`\n` +
    `- Head SHA: \`${report.headSha ?? '-'}\`\n` +
    `- Reason: \`${report.reason}\`\n\n` +
    `## Checks\n\n| Check | Result |\n|---|---|\n${checks || '| - | - |'}\n\n` +
    `## Evidence\n\n${report.evidence?.url ? `[Copilot review evidence](${report.evidence.url})` : 'No valid structured AI review evidence.'}\n`;
  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}

function exitCodeFor(verdict) {
  if (verdict === 'PASS') return 0;
  if (verdict === 'FIX_REQUIRED') return 1;
  return 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  const prNumber = Number(args.pr ?? process.env.CFI_PR_NUMBER);
  const outputDir = args['output-dir'] ?? 'audit-reports/independent-ai';
  const waitSeconds = Math.max(0, Number(args['wait-seconds'] ?? 600));
  const pollSeconds = Math.max(5, Number(args['poll-seconds'] ?? 20));

  if (!token || !repo || !Number.isInteger(prNumber) || prNumber < 1) {
    const report = {
      contract: CONTRACT,
      provider: 'GITHUB_COPILOT_CODE_REVIEW',
      verdict: 'BLOCK_PROMOTION',
      highestSeverity: 'P0',
      promotionAllowed: false,
      decisionUse: false,
      productionMutationAllowed: false,
      headSha: args['head-sha'] ?? null,
      reason: 'AUDITOR_CONFIGURATION_INVALID',
      checks: {},
      evidence: null,
      finishedAt: new Date().toISOString(),
    };
    writeReport(outputDir, report);
    console.error('CFI_AI_AUDIT=BLOCK_PROMOTION AUDITOR_CONFIGURATION_INVALID');
    process.exit(2);
  }

  const prRes = await githubRequest(token, `/repos/${repo}/pulls/${prNumber}`);
  if (!prRes.ok) throw new Error(`PR_API_${prRes.status}`);
  const headSha = args['head-sha'] || prRes.body?.head?.sha || null;

  let requestResult = await githubRequest(token, `/repos/${repo}/pulls/${prNumber}/requested_reviewers`, {
    method: 'POST',
    body: JSON.stringify({ reviewers: [COPILOT_REVIEWER] }),
  });

  const startedAt = new Date().toISOString();
  const deadline = Date.now() + waitSeconds * 1000;
  let evaluation = null;
  let items = [];

  do {
    try {
      items = await fetchCopilotEvidence(token, repo, prNumber, headSha);
      evaluation = evaluateReviewCorpus(items);
      if (evaluation.evidence) break;
    } catch (error) {
      evaluation = {
        ...normalizeAudit({ valid: false, reason: `AI_EVIDENCE_FETCH_FAILED:${error.message}` }),
        evidence: null,
      };
      break;
    }

    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000));
  } while (true);

  if (!evaluation?.evidence) {
    const requestReason = requestResult.ok
      ? 'AI_REVIEW_TIMEOUT_OR_STRUCTURED_VERDICT_MISSING'
      : `AI_REVIEW_REQUEST_FAILED:${requestResult.status}`;
    evaluation = {
      ...normalizeAudit({ valid: false, reason: requestReason }),
      evidence: null,
    };
  }

  const report = {
    contract: CONTRACT,
    provider: 'GITHUB_COPILOT_CODE_REVIEW',
    independentFromCfiRuntime: true,
    prNumber,
    repo,
    headSha,
    requestedReviewer: COPILOT_REVIEWER,
    requestStatus: requestResult.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    reviewEvidenceCount: items.length,
    ...evaluation,
  };

  writeReport(outputDir, report);
  console.log(`CFI_AI_AUDIT=${report.verdict}`);
  console.log(`PROMOTION_ALLOWED=${report.promotionAllowed}`);
  console.log(`REASON=${report.reason}`);
  process.exit(exitCodeFor(report.verdict));
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch(error => {
    const outputDir = parseArgs(process.argv.slice(2))['output-dir'] ?? 'audit-reports/independent-ai';
    const report = {
      contract: CONTRACT,
      provider: 'GITHUB_COPILOT_CODE_REVIEW',
      verdict: 'BLOCK_PROMOTION',
      highestSeverity: 'P0',
      promotionAllowed: false,
      decisionUse: false,
      productionMutationAllowed: false,
      reason: `AUDITOR_RUNTIME_ERROR:${error.message}`,
      checks: {},
      evidence: null,
      finishedAt: new Date().toISOString(),
    };
    writeReport(outputDir, report);
    console.error(error);
    process.exit(2);
  });
}
