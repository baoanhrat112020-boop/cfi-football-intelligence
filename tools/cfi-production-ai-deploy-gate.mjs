#!/usr/bin/env node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIT_CONTEXT = 'CFI Independent AI Auditor V1';
export const MAIN_REF = 'refs/heads/main';
export const ATTESTATION_RE = /^PASS base=([0-9a-f]{40}) diff=([0-9a-f]{64})$/i;

export function parseAuditAttestation(description) {
  const match = String(description ?? '').trim().match(ATTESTATION_RE);
  if (!match) return null;
  return { baseSha: match[1].toLowerCase(), diffSha256: match[2].toLowerCase() };
}

function statusTime(status) {
  return Date.parse(status?.created_at ?? status?.updated_at ?? 0) || 0;
}

export function selectValidPreMergeAuditStatus({ statuses = [], mergedAt, baseSha, diffSha256 }) {
  const mergedTime = Date.parse(mergedAt ?? 0) || 0;
  const expectedBase = String(baseSha ?? '').toLowerCase();
  const expectedDiff = String(diffSha256 ?? '').toLowerCase();
  if (!mergedTime || !/^[0-9a-f]{40}$/.test(expectedBase) || !/^[0-9a-f]{64}$/.test(expectedDiff)) {
    return { ok: false, reason: 'EXPECTED_ATTESTATION_INVALID', status: null };
  }

  const matchingContext = [...statuses]
    .filter(status => status?.context === AUDIT_CONTEXT)
    .sort((a, b) => statusTime(b) - statusTime(a));

  if (!matchingContext.length) return { ok: false, reason: 'AI_AUDIT_STATUS_MISSING', status: null };

  const preMerge = matchingContext.filter(status => {
    const created = statusTime(status);
    return created > 0 && created <= mergedTime;
  });
  if (!preMerge.length) return { ok: false, reason: 'AI_AUDIT_PREMERGE_STATUS_MISSING', status: null };

  for (const status of preMerge) {
    if (String(status?.state ?? '').toLowerCase() !== 'success') continue;
    const attestation = parseAuditAttestation(status?.description);
    if (!attestation) continue;
    if (attestation.baseSha !== expectedBase) continue;
    if (attestation.diffSha256 !== expectedDiff) continue;
    return { ok: true, reason: 'AI_AUDIT_PREMERGE_ATTESTATION_MATCH', status, attestation };
  }

  const newest = preMerge[0];
  const state = String(newest?.state ?? '').toLowerCase();
  if (state === 'failure' || state === 'error') {
    return { ok: false, reason: `AI_AUDIT_PREMERGE_${state.toUpperCase()}`, status: newest };
  }
  return { ok: false, reason: 'AI_AUDIT_PREMERGE_ATTESTATION_MISMATCH', status: newest };
}

export function evaluateDeploymentGate({ ref, mergeSha, pr, diffSha256, statuses }) {
  if (ref !== MAIN_REF) return { ok: false, reason: 'PRODUCTION_DEPLOY_REF_NOT_MAIN' };
  if (!/^[0-9a-f]{40}$/i.test(String(mergeSha ?? ''))) return { ok: false, reason: 'MERGE_SHA_INVALID' };
  if (!pr?.merged_at) return { ok: false, reason: 'ASSOCIATED_PR_NOT_MERGED' };
  if (String(pr?.merge_commit_sha ?? '').toLowerCase() !== String(mergeSha).toLowerCase()) {
    return { ok: false, reason: 'MERGE_COMMIT_SHA_MISMATCH' };
  }
  const headSha = String(pr?.head?.sha ?? '').toLowerCase();
  const baseSha = String(pr?.base?.sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha) || !/^[0-9a-f]{40}$/.test(baseSha)) {
    return { ok: false, reason: 'ASSOCIATED_PR_IDENTITY_INCOMPLETE' };
  }
  const selected = selectValidPreMergeAuditStatus({
    statuses,
    mergedAt: pr.merged_at,
    baseSha,
    diffSha256,
  });
  return {
    ...selected,
    prNumber: pr.number ?? null,
    headSha,
    baseSha,
    diffSha256,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

async function githubRequest(token, apiPath, { accept = 'application/vnd.github+json' } = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  return { response, text };
}

function fail(reason, details = {}) {
  console.error('CFI_PRODUCTION_AI_DEPLOY_GATE=FAIL');
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
  const mergeSha = String(args['merge-sha'] ?? process.env.GITHUB_SHA ?? '').toLowerCase();
  const ref = args.ref ?? process.env.GITHUB_REF;

  if (!token || !repo || !mergeSha || !ref) {
    fail('GATE_CONFIGURATION_INVALID');
    return;
  }
  if (ref !== MAIN_REF) {
    fail('PRODUCTION_DEPLOY_REF_NOT_MAIN', { REF: ref });
    return;
  }

  const associatedRaw = await githubRequest(token, `/repos/${repo}/commits/${mergeSha}/pulls`);
  const associated = JSON.parse(associatedRaw.text);
  const exact = (Array.isArray(associated) ? associated : []).filter(pr =>
    pr?.merged_at && String(pr?.merge_commit_sha ?? '').toLowerCase() === mergeSha
  );
  if (exact.length !== 1) {
    fail(exact.length ? 'ASSOCIATED_MERGED_PR_AMBIGUOUS' : 'ASSOCIATED_MERGED_PR_MISSING', {
      MERGE_SHA: mergeSha,
      MATCHES: exact.length,
    });
    return;
  }

  const prNumber = exact[0].number;
  const prRaw = await githubRequest(token, `/repos/${repo}/pulls/${prNumber}`);
  const pr = JSON.parse(prRaw.text);
  if (String(pr?.merge_commit_sha ?? '').toLowerCase() !== mergeSha || !pr?.merged_at) {
    fail('ASSOCIATED_PR_MERGE_IDENTITY_MISMATCH', { PR: prNumber, MERGE_SHA: mergeSha });
    return;
  }

  const diffRaw = await githubRequest(token, `/repos/${repo}/pulls/${prNumber}`, {
    accept: 'application/vnd.github.v3.diff',
  });
  const diffSha256 = crypto.createHash('sha256').update(diffRaw.text).digest('hex');
  const headSha = String(pr?.head?.sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    fail('ASSOCIATED_PR_HEAD_SHA_INVALID', { PR: prNumber });
    return;
  }

  const statusesRaw = await githubRequest(token, `/repos/${repo}/commits/${headSha}/statuses?per_page=100`);
  const statuses = JSON.parse(statusesRaw.text);
  const result = evaluateDeploymentGate({ ref, mergeSha, pr, diffSha256, statuses });

  console.log(`PR=${result.prNumber ?? prNumber}`);
  console.log(`PR_HEAD=${result.headSha ?? headSha}`);
  console.log(`PR_BASE=${result.baseSha ?? pr?.base?.sha ?? 'UNKNOWN'}`);
  console.log(`DIFF_SHA256=${diffSha256}`);
  console.log(`MERGED_AT=${pr.merged_at}`);
  console.log(`AI_GATE_REASON=${result.reason}`);

  if (!result.ok) {
    fail(result.reason, {
      PR: prNumber,
      PR_HEAD: headSha,
      TARGET_URL: result.status?.target_url ?? null,
      STATUS_CREATED_AT: result.status?.created_at ?? null,
    });
    return;
  }

  console.log('CFI_PRODUCTION_AI_DEPLOY_GATE=PASS');
  console.log(`ATTESTED_STATUS_CREATED_AT=${result.status?.created_at ?? 'UNKNOWN'}`);
  process.exitCode = 0;
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch(error => {
    fail(`GATE_RUNTIME_ERROR:${String(error?.message ?? error).replace(/[^A-Za-z0-9_:.-]/g, '_')}`);
  });
}
