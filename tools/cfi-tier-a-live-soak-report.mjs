#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluateFixtureVerification } from '../src/discovery/fixture-verification.mjs';

const DISCOVERY = resolve(
  process.env.CFI_TIER_A_BROWSER_OUTPUT ||
  'local-node/cache/registry/tier-a-browser-discovery.json'
);
const DISCOVERY_AUDIT = resolve(
  process.env.CFI_TIER_A_BROWSER_AUDIT ||
  'local-node/cache/registry/tier-a-browser-discovery-audit.json'
);
const DATE_UNVERIFIED_PLAN = resolve(
  process.env.CFI_TIER_A_DATE_UNVERIFIED_PLAN ||
  'local-node/cache/registry/tier-a-date-unverified-web-plan.json'
);
const DATE_UNVERIFIED_RESOLUTION = resolve(
  process.env.CFI_TIER_A_DATE_UNVERIFIED_RESOLUTION ||
  'local-node/cache/registry/tier-a-date-unverified-resolution.json'
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

const [discovery, discoveryAudit, dateUnverifiedPlan, dateResolution, probeAudit] = await Promise.all([
  readJson(DISCOVERY),
  readJson(DISCOVERY_AUDIT),
  readJson(DATE_UNVERIFIED_PLAN),
  readJson(DATE_UNVERIFIED_RESOLUTION),
  readJson(PROBE_AUDIT)
]);

const rows = Array.isArray(discovery?.rows) ? discovery.rows : [];
const dateWebRows = Array.isArray(dateUnverifiedPlan?.rows) ? dateUnverifiedPlan.rows : [];
const recoveredDateRows = Array.isArray(dateResolution?.recoveredRows) ? dateResolution.recoveredRows : [];
const dateConflictRows = Array.isArray(dateResolution?.conflictHints) ? dateResolution.conflictHints : [];
const dateUnresolvedRows = Array.isArray(dateResolution?.unresolvedHints) ? dateResolution.unresolvedHints : [];
const dateOutsideRows = Array.isArray(dateResolution?.resolvedOutsideTargetDate)
  ? dateResolution.resolvedOutsideTargetDate
  : [];
const fixtureGroups = new Map();
const identityKickoffs = new Map();
const providerRows = {};

for (const row of rows) {
  const provider = clean(row?.provider).toUpperCase() || 'UNKNOWN';
  increment(providerRows, provider);

  const key = fixtureKey(row);
  const group = fixtureGroups.get(key) ?? {
    identity: identityKey(row),
    home: row?.home ?? null,
    away: row?.away ?? null,
    targetDate: row?.targetDate ?? discovery?.targetDate ?? null,
    kickoffIso: row?.kickoffIso ?? null,
    providers: new Set(),
    sourceObservations: [],
    observations: 0
  };
  group.providers.add(provider);
  group.sourceObservations.push({
    sourceClass: row?.sourceClass ?? 'TIER_A_BROWSER_DISCOVERY',
    provider,
    providerId: row?.providerId ?? null,
    sourceUrl: row?.sourceUrl ?? null,
    kickoffIso: row?.kickoffIso ?? null,
    status: row?.status ?? 'scheduled',
    observedAt: row?.observedAt ?? discovery?.generatedAt ?? null
  });
  group.observations += 1;
  fixtureGroups.set(key, group);

  const identity = identityKey(row);
  const kickoffs = identityKickoffs.get(identity) ?? new Set();
  if (clean(row?.kickoffIso)) kickoffs.add(clean(row.kickoffIso));
  identityKickoffs.set(identity, kickoffs);
}

const conflictIdentitySet = new Set(
  [...identityKickoffs.entries()]
    .filter(([, kickoffs]) => kickoffs.size >= 2)
    .map(([identity]) => identity)
);

const uniqueFixtures = [...fixtureGroups.values()].map(group => {
  const kickoffs = [...(identityKickoffs.get(group.identity) ?? new Set())].sort();
  const verification = evaluateFixtureVerification({
    identityKey: group.identity,
    canonicalHomeId: null,
    canonicalAwayId: null,
    sourceObservations: group.sourceObservations,
    kickoffCandidates: kickoffs.map(kickoffIso => ({ kickoffIso })),
    hasKickoffConflict: conflictIdentitySet.has(group.identity),
    hasTerminalObservation: false,
    hasUpstreamFailClosed: false,
    distinctProviderCount: group.providers.size
  });

  return {
    ...group,
    kickoffCandidates: kickoffs,
    verification
  };
});

const multiSourceFixtures = uniqueFixtures.filter(item => item.providers.size >= 2);
const singleSourceFixtures = uniqueFixtures.length - multiSourceFixtures.length;
const duplicateObservations = Math.max(0, rows.length - uniqueFixtures.length);
const kickoffConflictIdentities = [...identityKickoffs.entries()]
  .filter(([, kickoffs]) => kickoffs.size >= 2)
  .map(([identity, kickoffs]) => ({ identity, kickoffCandidates: [...kickoffs].sort() }));
const trustedRankingReadyFixtures = uniqueFixtures.filter(
  item => item.verification.rankingReady
);
const trustedFailClosedFixtures = uniqueFixtures.filter(
  item => item.verification.status.endsWith('FAIL_CLOSED')
);
const trustedDiscoveryOnlyFixtures = uniqueFixtures.filter(
  item => !item.verification.rankingReady &&
    !item.verification.status.endsWith('FAIL_CLOSED')
);

const verificationStatusCounts = {};
for (const fixture of uniqueFixtures) {
  increment(verificationStatusCounts, fixture.verification.status);
}

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
      dateUnverifiedHints: Number(item.dateUnverifiedHints ?? 0),
      reason: item.reason ?? null
    }))
  : [];

const degradedDateAdapters = adapterAudits.filter(item =>
  item.status === 'DATE_CONTEXT_UNVERIFIED' || item.dateUnverifiedHints > 0
);
const expectedDateHints = adapterAudits.reduce(
  (sum, item) => sum + Number(item.dateUnverifiedHints ?? 0),
  0
);
const resolutionMetrics = dateResolution?.metrics ?? {};
const resolutionWebRequired = Number(resolutionMetrics.webRequired ?? 0);
const invalidDateWebRows = dateWebRows.filter(row =>
  row?.kickoffIso != null ||
  row?.canEnterRegistry !== false ||
  row?.canEnterRanking !== false ||
  row?.autoCorrectKickoffAllowed !== false ||
  row?.predictionExecutionAllowed !== false ||
  row?.decisionUse !== false ||
  row?.bigDbWriteAllowed !== false ||
  row?.requiredEvidence?.sourcePageDateClaimCannotVerifyKickoff !== true
);
const invalidRecoveredRows = recoveredDateRows.filter(row =>
  !clean(row?.kickoffIso) ||
  row?.sourceClass !== 'TIER_A_DATE_RECOVERED' ||
  row?.dateRecoveryVerified !== true ||
  row?.rankingReady !== false ||
  row?.predictionExecutionAllowed !== false ||
  row?.decisionUse !== false ||
  row?.bigDbWriteAllowed !== false ||
  row?.parserEvidence?.date_basis !== 'EXACT_IDENTITY_PLUS_SAME_DISPLAYED_TIME_INDEPENDENT_TRUSTED_PROVIDER' ||
  row?.parserEvidence?.fuzzy_identity_used !== false ||
  row?.parserEvidence?.automatic_kickoff_correction_used !== false ||
  !Array.isArray(row?.parserEvidence?.independent_providers) ||
  row.parserEvidence.independent_providers.length === 0 ||
  row?.targetDate !== (discovery?.targetDate ?? discoveryAudit?.targetDate)
);
const recoveredMissingFromDiscovery = recoveredDateRows.filter(recovered =>
  !rows.some(row =>
    row?.sourceClass === 'TIER_A_DATE_RECOVERED' &&
    clean(row?.provider).toUpperCase() === clean(recovered?.provider).toUpperCase() &&
    normalize(row?.home) === normalize(recovered?.home) &&
    normalize(row?.away) === normalize(recovered?.away) &&
    clean(row?.kickoffIso) === clean(recovered?.kickoffIso)
  )
);
const conflictLeakedIntoRecovered = dateConflictRows.filter(conflict =>
  recoveredDateRows.some(recovered =>
    clean(recovered?.provider).toUpperCase() === clean(conflict?.provider).toUpperCase() &&
    normalize(recovered?.home) === normalize(conflict?.home_team ?? conflict?.home) &&
    normalize(recovered?.away) === normalize(conflict?.away_team ?? conflict?.away)
  )
);

if (!dateResolution || dateResolution.__readError) {
  throw new Error('DATE_UNVERIFIED_RESOLUTION_MISSING');
}
if (Number(resolutionMetrics.hints ?? -1) !== expectedDateHints) {
  throw new Error(`DATE_UNVERIFIED_HINT_ACCOUNTING_MISMATCH:${expectedDateHints}:${resolutionMetrics.hints}`);
}
if (Number(resolutionMetrics.recovered ?? -1) !== recoveredDateRows.length) {
  throw new Error('DATE_UNVERIFIED_RECOVERED_ACCOUNTING_MISMATCH');
}
if (Number(resolutionMetrics.conflicts ?? -1) !== dateConflictRows.length) {
  throw new Error('DATE_UNVERIFIED_CONFLICT_ACCOUNTING_MISMATCH');
}
if (Number(resolutionMetrics.unresolved ?? -1) !== dateUnresolvedRows.length) {
  throw new Error('DATE_UNVERIFIED_UNRESOLVED_ACCOUNTING_MISMATCH');
}
if (Number(resolutionMetrics.resolvedOutsideTargetDate ?? -1) !== dateOutsideRows.length) {
  throw new Error('DATE_UNVERIFIED_OUTSIDE_DATE_ACCOUNTING_MISMATCH');
}
if (resolutionWebRequired !== dateWebRows.length) {
  throw new Error(`DATE_UNVERIFIED_WEB_ACCOUNTING_MISMATCH:${resolutionWebRequired}:${dateWebRows.length}`);
}
if (invalidDateWebRows.length > 0) {
  throw new Error(`DATE_UNVERIFIED_WEB_SAFETY_VIOLATION:${invalidDateWebRows.length}`);
}
if (invalidRecoveredRows.length > 0) {
  throw new Error(`DATE_UNVERIFIED_RECOVERY_SAFETY_VIOLATION:${invalidRecoveredRows.length}`);
}
if (recoveredMissingFromDiscovery.length > 0) {
  throw new Error(`DATE_UNVERIFIED_RECOVERY_NOT_MATERIALIZED:${recoveredMissingFromDiscovery.length}`);
}
if (conflictLeakedIntoRecovered.length > 0) {
  throw new Error(`DATE_UNVERIFIED_CONFLICT_LEAKED_TO_REGISTRY:${conflictLeakedIntoRecovered.length}`);
}
if (dateResolution?.policy?.exactHomeAwayIdentityOnly !== true ||
    dateResolution?.policy?.fuzzyIdentityAllowed !== false ||
    dateResolution?.policy?.independentProviderRequired !== true ||
    dateResolution?.policy?.trustedTierABProviderRequired !== true ||
    dateResolution?.policy?.displayedTimeMustMatch !== true ||
    dateResolution?.policy?.oneDistinctKickoffRequired !== true ||
    dateResolution?.policy?.recoveredKickoffLocalDateMustEqualTargetDate !== true ||
    dateResolution?.policy?.conflictingKickoffAutoCorrectionAllowed !== false ||
    dateResolution?.policy?.recoveredObservationMaySelfSetRankingReady !== false) {
  throw new Error('DATE_UNVERIFIED_RESOLUTION_POLICY_WEAKENED');
}
if (dateWebRows.length > 0) {
  if (dateUnverifiedPlan?.policy?.sourcePageDateClaimTrustedAsKickoffDate !== false) {
    throw new Error('DATE_UNVERIFIED_SOURCE_PAGE_DATE_TRUST_ENABLED');
  }
  if (dateUnverifiedPlan?.policy?.canEnterRegistryBeforeVerification !== false) {
    throw new Error('DATE_UNVERIFIED_REGISTRY_ENTRY_ENABLED');
  }
  if (dateUnverifiedPlan?.policy?.canEnterRankingBeforeVerification !== false) {
    throw new Error('DATE_UNVERIFIED_RANKING_ENTRY_ENABLED');
  }
  if (dateUnverifiedPlan?.policy?.explicitKickoffRequired !== true) {
    throw new Error('DATE_UNVERIFIED_EXPLICIT_KICKOFF_NOT_REQUIRED');
  }
}

const status = discoveryAudit?.status?.startsWith('FAIL_')
  ? 'DEGRADED_SOURCE_FAILURE'
  : successfulProbeSources.length === 0
    ? 'DEGRADED_NO_USABLE_TIER_A_SOURCE'
    : uniqueFixtures.length === 0 && expectedDateHints === 0
      ? 'PASS_EMPTY'
      : 'PASS';

const generatedAt = new Date().toISOString();
const report = {
  contract: 'CFI_TIER_A_LIVE_SOAK_REPORT_V4',
  generatedAt,
  status,
  targetDate: discovery?.targetDate ?? discoveryAudit?.targetDate ?? null,
  timeZone: discovery?.timeZone ?? discoveryAudit?.timeZone ?? 'Asia/Ho_Chi_Minh',
  discoveryStatus: discoveryAudit?.status ?? null,
  globalSourceHealth: discovery?.sourceHealth ?? discoveryAudit?.sourceHealth ?? null,
  dateUnverifiedRescue: {
    planContract: dateUnverifiedPlan?.contract ?? null,
    resolutionContract: dateResolution?.contract ?? null,
    resolutionPresent: Boolean(dateResolution),
    rawHints: expectedDateHints,
    recovered: recoveredDateRows.length,
    conflicts: dateConflictRows.length,
    unresolved: dateUnresolvedRows.length,
    resolvedOutsideTargetDate: dateOutsideRows.length,
    webRequired: dateWebRows.length,
    degradedProviders: degradedDateAdapters.map(item => item.provider),
    candidateOutput: dateUnverifiedPlan?.policy?.candidateOutput ?? null,
    resolutionPolicy: dateResolution?.policy ?? null,
    webPolicy: dateUnverifiedPlan?.policy ?? null,
    safetyVerified:
      invalidDateWebRows.length === 0 &&
      invalidRecoveredRows.length === 0 &&
      recoveredMissingFromDiscovery.length === 0 &&
      conflictLeakedIntoRecovered.length === 0
  },
  perFixtureVerification: {
    rankingReadyFixtures: trustedRankingReadyFixtures.length,
    discoveryOnlyFixtures: trustedDiscoveryOnlyFixtures.length,
    failClosedFixtures: trustedFailClosedFixtures.length,
    statusCounts: verificationStatusCounts,
    policy: {
      globalSourceCoverageDoesNotVerifyIndividualFixture: true,
      twoTrustedTierABProvidersSameFixtureKickoffRequired: true,
      singleSourceHighConfidenceRankingAllowed: false,
      kickoffConflictFailClosed: true
    }
  },
  metrics: {
    rawRows: rows.length,
    uniqueFixtures: uniqueFixtures.length,
    singleSourceFixtures,
    multiSourceFixtures: multiSourceFixtures.length,
    trustedRankingReadyFixtures: trustedRankingReadyFixtures.length,
    trustedDiscoveryOnlyFixtures: trustedDiscoveryOnlyFixtures.length,
    trustedFailClosedFixtures: trustedFailClosedFixtures.length,
    duplicateObservations,
    kickoffConflictIdentities: kickoffConflictIdentities.length,
    successfulProbeSources: successfulProbeSources.length,
    blockedSources: blockedSources.length,
    erroredSources: erroredSources.length,
    truncatedSources: truncatedSources.length,
    dateUnverifiedHints: expectedDateHints,
    dateUnverifiedRecovered: recoveredDateRows.length,
    dateUnverifiedConflicts: dateConflictRows.length,
    dateUnverifiedUnresolved: dateUnresolvedRows.length,
    dateUnverifiedOutsideTargetDate: dateOutsideRows.length,
    dateUnverifiedWebRequired: dateWebRows.length,
    dateContextDegradedProviders: degradedDateAdapters.length
  },
  providerRows,
  adapters: adapterAudits,
  probe: sourceProbe,
  multiSourceEvidence: multiSourceFixtures.map(item => ({
    home: item.home,
    away: item.away,
    kickoffIso: item.kickoffIso,
    providers: [...item.providers].sort(),
    observations: item.observations,
    verificationStatus: item.verification.status,
    rankingReady: item.verification.rankingReady
  })),
  rankingReadyEvidence: trustedRankingReadyFixtures.map(item => ({
    home: item.home,
    away: item.away,
    kickoffIso: item.kickoffIso,
    providers: [...item.providers].sort(),
    verificationStatus: item.verification.status
  })),
  kickoffConflicts: kickoffConflictIdentities,
  safety: {
    shadowOnly: true,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false,
    productionScheduleActivated: false,
    automaticBetting: false,
    globalRecallClaimAllowed: false,
    globalSourceCoverageDoesNotVerifyIndividualFixture: true,
    rawDateUnverifiedCanEnterRegistry: false,
    rawDateUnverifiedCanEnterRanking: false,
    recoveredDateObservationRequiresExactCrossSourceVerification: true,
    recoveredDateObservationCanSelfSetRankingReady: false,
    kickoffConflictAutoCorrectionAllowed: false,
    sourcePageDateClaimCanVerifyKickoff: false
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
  `- Per-fixture ranking ready: ${report.metrics.trustedRankingReadyFixtures}\n` +
  `- Discovery-only fixtures: ${report.metrics.trustedDiscoveryOnlyFixtures}\n` +
  `- Fail-closed fixtures: ${report.metrics.trustedFailClosedFixtures}\n` +
  `- Date-unverified raw hints: ${report.metrics.dateUnverifiedHints}\n` +
  `- Date-unverified exact recovered: ${report.metrics.dateUnverifiedRecovered}\n` +
  `- Date-unverified kickoff conflicts: ${report.metrics.dateUnverifiedConflicts}\n` +
  `- Date-unverified unresolved: ${report.metrics.dateUnverifiedUnresolved}\n` +
  `- Date-unverified outside target date: ${report.metrics.dateUnverifiedOutsideTargetDate}\n` +
  `- Date-unverified remaining for web: ${report.metrics.dateUnverifiedWebRequired}\n` +
  `- Date-context degraded providers: ${report.metrics.dateContextDegradedProviders}\n` +
  `- Duplicate observations: ${report.metrics.duplicateObservations}\n` +
  `- Kickoff-conflict identities: ${report.metrics.kickoffConflictIdentities}\n` +
  `- Successful Tier A probes: ${report.metrics.successfulProbeSources}\n` +
  `- Blocked sources: ${report.metrics.blockedSources}\n` +
  `- Errored sources: ${report.metrics.erroredSources}\n` +
  `- Truncated snapshots: ${report.metrics.truncatedSources}\n\n` +
  `## Rows by provider\n${providerLines}\n\n` +
  `Raw date-unverified hints never receive a kickoff. A recovered observation exists only when an independent trusted Tier A/B source matches exact home/away, the displayed time agrees, exactly one kickoff remains, and its local date equals the target date. Conflicts stay fail-closed and unresolved hints remain web-required. Recovery cannot self-promote ranking readiness. This is shadow telemetry only and cannot activate betting decisions.\n`;

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
  dateUnverifiedRescue: report.dateUnverifiedRescue,
  globalSourceHealth: report.globalSourceHealth?.status ?? null,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
