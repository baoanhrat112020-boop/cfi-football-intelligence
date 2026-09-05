import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildBigDbIdentityGapAudit } from '../../src/discovery/bigdb-identity-gap-audit.mjs';

const INPUT = resolve(
  process.env.CFI_SHADOW_EVIDENCE_RECEIPTS_FILE ||
  'local-node/cache/registry/shadow-evidence-receipts.json'
);
const OUTPUT = resolve(
  process.env.CFI_BIGDB_IDENTITY_GAP_AUDIT_FILE ||
  'local-node/cache/registry/bigdb-identity-gap-audit.json'
);
const CYCLE_ID = String(process.env.CFI_ORCHESTRATOR_CYCLE_ID ?? '').trim() || null;

const document = JSON.parse(await readFile(INPUT, 'utf8'));
const audit = buildBigDbIdentityGapAudit(document, {
  generatedAt: new Date().toISOString(),
  sourceCycleId: CYCLE_ID
});

if (audit.rows.some(row => row.autoAliasAllowed !== false)) {
  throw new Error('IDENTITY_GAP_AUTO_ALIAS_FORBIDDEN');
}
if (audit.rows.some(row => row.canonicalTeamCreateAllowed !== false)) {
  throw new Error('IDENTITY_GAP_CANONICAL_TEAM_CREATE_FORBIDDEN');
}
if (audit.policy.rawFixtureUpsertForIdentityRescueAllowed !== false) {
  throw new Error('RAW_FIXTURE_UPSERT_IDENTITY_RESCUE_FORBIDDEN');
}
if (audit.policy.bigDbWriteAllowed !== false) {
  throw new Error('IDENTITY_GAP_BIGDB_WRITE_FORBIDDEN');
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(audit, null, 2), 'utf8');

console.log(JSON.stringify({
  contract: audit.contract,
  status: audit.status,
  sourceCycleId: audit.sourceCycleId,
  ...audit.metrics,
  autoAliasAllowed: false,
  canonicalTeamCreateAllowed: false,
  rawFixtureUpsertForIdentityRescueAllowed: false,
  predictionExecutionAllowed: false,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
