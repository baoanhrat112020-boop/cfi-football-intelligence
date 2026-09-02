#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectAssociatedMergedPr(prs) {
  if (!Array.isArray(prs) || prs.length === 0) return null;
  const merged = prs.filter(pr => pr?.merged_at && pr?.number && /^[0-9a-f]{40}$/i.test(String(pr?.head?.sha ?? '')));
  if (merged.length) {
    return merged.sort((a,b)=>Date.parse(b.merged_at)-Date.parse(a.merged_at))[0];
  }
  return prs.find(pr => pr?.number && /^[0-9a-f]{40}$/i.test(String(pr?.head?.sha ?? ''))) ?? null;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  const commitSha = args['commit-sha'];
  const outputPath = args['github-output'] ?? process.env.GITHUB_OUTPUT;

  if (!token || !repo || !/^[0-9a-f]{40}$/i.test(String(commitSha ?? '')) || !outputPath) {
    console.error('CFI_ASSOCIATED_PR=ERROR CONFIGURATION_INVALID');
    process.exit(2);
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${commitSha}/pulls`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    console.error(`CFI_ASSOCIATED_PR=ERROR GITHUB_HTTP_${response.status}`);
    process.exit(2);
  }

  const pr = selectAssociatedMergedPr(await response.json());
  if (!pr) {
    console.error('CFI_ASSOCIATED_PR=ERROR ASSOCIATED_MERGED_PR_NOT_FOUND');
    process.exit(2);
  }

  fs.appendFileSync(outputPath, `pr_number=${pr.number}\npr_head_sha=${pr.head.sha}\n`);
  console.log(`CFI_ASSOCIATED_PR=${pr.number}`);
  console.log(`CFI_ASSOCIATED_PR_HEAD=${pr.head.sha}`);
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch(error => {
    console.error(`CFI_ASSOCIATED_PR=ERROR ${String(error?.message ?? error)}`);
    process.exit(2);
  });
}
