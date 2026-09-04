#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DISCOVERY = resolve(
  process.env.CFI_TIER_A_BROWSER_OUTPUT ||
  'local-node/cache/registry/tier-a-browser-discovery.json'
);
const DISCOVERY_AUDIT = resolve(
  process.env.CFI_TIER_A_BROWSER_AUDIT ||
  'local-node/cache/registry/tier-a-browser-discovery-audit.json'
);
const PROBE_AUDIT = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);
const OUTPUT_JSON = resolve('audit-reports/cfi-tier-a-live-soak.json');
const OUTPUT_MD = resolve('audit-reports/cfi-tier-a-live-soak.md');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { __readError: error instanceof Error ? error.message : String(error) };
  }
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fixtureKey(row) {
  return [normalize(row?.home), normalize(row?.away), clean(row?.kickoffIso)].join('|');
}

function identityKey(row) {
  return [normalize(row?.home), normalize(row?.away), clean(row?.targetDate)].join('|');
}

function increment(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

const [discovery, discoveryAudit, probeAudit] = await Promise.all([
  readJson(DISCOVERY),
  readJson(DISCOVERY_AUDIT),
  readJson(PROBE_AUDIT)
]);

const rows = Array.isArray(discovery?.rows) ? discovery.rows : [];
const fixtureGroups = new Map();
const identityKickoffs = new Map();
const providerRows = {};

for (const row of rows) {
  const provider = clean(row?.provider).toUpperCase() || 'UNKNOWN';
  increment(providerRows, provider);

  const key = fixtureKey(row);
  const group = fixtureGroups.get(key) ?? {
    home: row?.home ?? null,
    away: row?.away ?? null,
    kickoffIso: row?.kickoffIso ?? null,
    providers: new Set(),
    observations: 0
  };
  group.providers.add(provider);
  group.observations += 1;
  fixtureGroups.set(key, group);

  const identity = identityKey(row);
  const kickoffs = identityKickoffs.get(identity) ?? new Set();
  if (clean(row?.kickoffIso)) kickoffs.add(clean(row.kickoffIso));
  identityKickoffs.set(identity, kickoffs);
}

const uniqueFixtures = [...fixtureGroups.values()];
const multiSourceFixtures = uniqueFixtures.filter(item => item.providers.size >= 2);
const singleSourceFixtures = uniqueFixtures.length - multiSourceFixtures.length;
const duplicateObservations = Math.max(0, rows.length - uniqueFixtures.length);
const kickoffConflictIdentities = [...identityKickoffs.entries()]
  .filter(([, kickoffs]) => kickoffs.size >= 2)
  .map(([identity, kickoffs]) => ({ identity, kickoffCandidates: [...kickoffs].sort() }));

const probeRows = Array.isArray(probeAudit?.results) ? probeAudit.results : [];
const sourceProbe = probeRows.map(row => ({
  provider: clean(row?.provider).toUpperCase() || 'UNKNOWN',
  sourceId: row?.source_id ?? null,
  httpStatus: row?.http_status ?? null,
  blocked: row?.blocked === true,
  blockMarker: row?.blockMarker ?? null,
  errored: row?.status === 'ERROR',
  error: row?.error ?? null,
  bodyTextLength: Number(row?.bodyTextLength ?? 0),
  snapshotChars: Number(row?.snapshotChars ?? 0),
  snapshotTruncated: row?.snapshotTruncated === true,
  renderTimezone: row?.render_timezone ?? null
}));

const blockedSources = sourceProbe.filter(row => row.blocked);
const erroredSources = sourceProbe.filter(row => row.errored);
const truncatedSources = sourceProbe.filter(row => row.snapshotTruncated);
const successfulProbeSources = sourceProbe.filter(row =>
  typeof row.httpStatus === 'number' &&
  row.httpStatus >= 200 && row.httpStatus < 400 &&
  !row.blocked && !row.errored
);

const adapterAudits = Array.isArray(discoveryAudit?.providerAudits)
  ? discoveryAudit.providerAudits.map(item => ({
      provider: item.provider,
      status: item.status,
      candidates: Number(item.candidates ?? 0),
      rejectedSegments: Number(item.rejectedSegments ?? 0),
      identityOnlySegments: Number(item.identityOnlySegments ?? 0),
      reason: item.reason ?? null
    }))
  : [];

const status = discoveryAudit?.status?.startsWith('FAIL_')
  ? 'DEGRADED_SOURCE_FAILURE'
  : successfulProbeSources.length === 0
    ? 'DEGRADED_NO_USABLE_TIER_A_SOURCE'
    : uniqueFixtures.length === 0
      ? 'PASS_EMPTY'
      : 'PASS';

const generatedAt = new Date().toISOString();
const report = {
  contract: 'CFI_TIER_A_LIVE_SOAK_REPORT_V1',
  generatedAt,
  status,
  targetDate: discovery?.targetDate ?? discoveryAudit?.targetDate ?? null,
  timeZone: discovery?.timeZone ?? discoveryAudit?.timeZone ?? 'Asia/Ho_Chi_Minh',
  discoveryStatus: discoveryAudit?.status ?? null,
  sourceHealth: discovery?.sourceHealth ?? discoveryAudit?.sourceHealth ?? null,
  metrics: {
    rawRows: rows.length,
    uniqueFixtures: uniqueFixtures.length,
    singleSourceFixtures,
    multiSourceFixtures: multiSourceFixtures.length,
    duplicateObservations,
    kickoffConflictIdentities: kickoffConflictIdentities.length,
    successfulProbeSources: successfulProbeSources.length,
    blockedSources: blockedSources.length,
    erroredSources: erroredSources.length,
    truncatedSources: truncatedSources.length
  },
  providerRows,
  adapters: adapterAudits,
  probe: sourceProbe,
  multiSourceEvidence: multiSourceFixtures.map(item => ({
    home: item.home,
    away: item.away,
    kickoffIso: item.kickoffIso,
    providers: [...item.providers].sort(),
    observations: item.observations
  })),
  kickoffConflicts: kickoffConflictIdentities,
  safety: {
    shadowOnly: true,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false,
    productionScheduleActivated: false,
    automaticBetting: false,
    globalRecallClaimAllowed: false
  }
};

const providerLines = Object.entries(providerRows)
  .sort((a, b) => b[1] - a[1])
  .map(([provider, count]) => `- ${provider}: ${count}`)
  .join('\n') || '- none';

const md = `# CFI Tier A Live Soak\n\n` +
  `- Status: ${report.status}\n` +
  `- Target date: ${report.targetDate ?? 'N/A'}\n` +
  `- Raw rows: ${report.metrics.rawRows}\n` +
  `- Unique fixtures: ${report.metrics.uniqueFixtures}\n` +
  `- Multi-source fixtures: ${report.metrics.multiSourceFixtures}\n` +
  `- Duplicate observations: ${report.metrics.duplicateObservations}\n` +
  `- Kickoff-conflict identities: ${report.metrics.kickoffConflictIdentities}\n` +
  `- Successful Tier A probes: ${report.metrics.successfulProbeSources}\n` +
  `- Blocked sources: ${report.metrics.blockedSources}\n` +
  `- Errored sources: ${report.metrics.erroredSources}\n` +
  `- Truncated snapshots: ${report.metrics.truncatedSources}\n\n` +
  `## Rows by provider\n${providerLines}\n\n` +
  `This is shadow coverage telemetry only. It does not claim global fixture recall and cannot activate prediction or betting decisions.\n`;

await mkdir(dirname(OUTPUT_JSON), { recursive: true });
await Promise.all([
  writeFile(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8'),
  writeFile(OUTPUT_MD, md, 'utf8')
]);

console.log(JSON.stringify({
  contract: report.contract,
  status: report.status,
  targetDate: report.targetDate,
  ...report.metrics,
  providerRows,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
