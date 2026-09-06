import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildFixtureSourceScanPlan } from '../../src/discovery/fixture-source-policy.mjs';

const OUTPUT = resolve(
  process.env.CFI_SOURCE_SCAN_PLAN_OUTPUT ||
  'local-node/cache/registry/source-scan-plan.json'
);

const generatedAt = new Date().toISOString();
const sources = buildFixtureSourceScanPlan({ includeFallback: true });

const body = {
  contract: 'CFI_FIXTURE_SOURCE_SCAN_PLAN_V1',
  generatedAt,
  strategy: 'PRIMARY_FIRST_MULTI_SOURCE',
  rules: {
    stopAfterRowQuota: false,
    pcNodeIsGatekeeper: false,
    espnCanSatisfyCoverageReadiness: false,
    theSportsDbCanSatisfyCoverageReadiness: false,
    globalRecallClaimAllowed: false,
    requirePrimaryTierBeforeRankingReadiness: true,
    continueRescueWhenPrimaryCoverageMissing: true
  },
  sources,
  primaryOrder: sources.filter(source => source.tier === 'A').map(source => source.key),
  secondaryOrder: sources.filter(source => source.tier === 'B').map(source => source.key),
  fallbackOrder: sources.filter(source => ['C', 'D'].includes(source.tier)).map(source => source.key),
  decisionUse: false,
  bigDbWriteAllowed: false
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(body, null, 2), 'utf8');

console.log(JSON.stringify({
  contract: body.contract,
  primaryOrder: body.primaryOrder,
  secondaryOrder: body.secondaryOrder,
  fallbackOrder: body.fallbackOrder,
  espnCanSatisfyCoverageReadiness: false,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
