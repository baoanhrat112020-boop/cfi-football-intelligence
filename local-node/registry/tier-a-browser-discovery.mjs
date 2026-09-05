import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../src/discovery/cfi-discovery.ts';
import { buildDateUnverifiedWebPlan } from '../../src/discovery/date-unverified-rescue.mjs';
import { evaluateFixtureSourceCoverage } from '../../src/discovery/fixture-source-policy.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const OUTPUT = resolve(
  process.env.CFI_TIER_A_BROWSER_OUTPUT ||
  'local-node/cache/registry/tier-a-browser-discovery.json'
);
const AUDIT = resolve(
  process.env.CFI_TIER_A_BROWSER_AUDIT ||
  'local-node/cache/registry/tier-a-browser-discovery-audit.json'
);
const DATE_UNVERIFIED_PLAN = resolve(
  process.env.CFI_TIER_A_DATE_UNVERIFIED_PLAN ||
  'local-node/cache/registry/tier-a-date-unverified-web-plan.json'
);
const PROBE_AUDIT = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);

const PROVIDERS = [
  ['AISCORE', 'local-node/browser/fixture-collector/aiscore-adapter.mjs'],
  ['BONGDAWAP', 'local-node/browser/fixture-collector/bongdawap-adapter.mjs'],
  ['SOFASCORE', 'local-node/browser/fixture-collector/sofascore-daily-adapter.mjs'],
  ['FLASHSCORE', 'local-node/browser/fixture-collector/flashscore-adapter.mjs']
];

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function runNode(label, script, envPatch = {}) {
  return new Promise(resolvePromise => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...envPatch },
      stdio: 'inherit'
    });
    child.on('error', error => {
      resolvePromise({ label, ok: false, startedAt, completedAt: new Date().toISOString(), error: error.message });
    });
    child.on('exit', code => {
      resolvePromise({
        label,
        ok: code === 0,
        exitCode: code,
        startedAt,
        completedAt: new Date().toISOString(),
        error: code === 0 ? null : `${label}_FAILED_EXIT_${code}`
      });
    });
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const generatedAt = new Date().toISOString();
const targetDate = String(process.env.CFI_TARGET_DATE ?? '').trim() ||
  localDateNow(TIME_ZONE, Date.now());

const probe = await runNode(
  'TIER_A_BROWSER_PROBE',
  'local-node/browser/fixture-collector/probe.mjs',
  {
    CFI_BROWSER_PROBE_TIER: 'A',
    CFI_TIME_ZONE: TIME_ZONE,
    CFI_TARGET_DATE: targetDate
  }
);
const probeAudit = await readJson(PROBE_AUDIT);
const probeUsable = probe.ok &&
  probeAudit?.status !== 'FAIL' &&
  Number(probeAudit?.sourcesSuccessful ?? 0) > 0;

const adapterRuns = [];
if (probeUsable) {
  for (const [provider, script] of PROVIDERS) {
    adapterRuns.push([
      provider,
      await runNode(`TIER_A_${provider}_ADAPTER`, script, {
        CFI_TIME_ZONE: TIME_ZONE,
        CFI_TARGET_DATE: targetDate
      })
    ]);
  }
}

const rows = [];
const dateUnverified = [];
const providerAudits = [];
for (const [provider, run] of adapterRuns) {
  if (!run.ok) {
    providerAudits.push({ provider, run, status: 'ADAPTER_PROCESS_FAILED', candidates: 0, dateUnverifiedHints: 0 });
    continue;
  }
  const key = provider.toLowerCase();
  const manifest = await readJson(`local-node/browser/fixture-collector/input/${key}-candidates.json`);
  const adapterAudit = await readJson(`local-node/cache/browser/${key}-adapter-audit.json`);
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
  const providerDateUnverified = Array.isArray(manifest?.dateUnverified) ? manifest.dateUnverified : [];
  dateUnverified.push(...providerDateUnverified);
  for (const candidate of candidates) {
    rows.push({
      sourceClass: 'TIER_A_BROWSER_DISCOVERY',
      provider,
      providerId: candidate.provider_id ?? null,
      sourceUrl: candidate.source_url ?? null,
      sourceUrls: candidate.source_url ? [candidate.source_url] : [],
      home: candidate.home_team,
      away: candidate.away_team,
      competition: candidate.competition ?? null,
      country: candidate.country ?? null,
      kickoffIso: candidate.kickoff_utc,
      targetDate,
      status: 'scheduled',
      observedAt: generatedAt,
      parserEvidence: candidate.parser_evidence ?? null,
      decisionUse: false
    });
  }
  providerAudits.push({
    provider,
    run,
    status: adapterAudit?.status ?? 'UNKNOWN',
    candidates: candidates.length,
    rejectedSegments: adapterAudit?.rejectedSegments ?? 0,
    identityOnlySegments: adapterAudit?.identityOnlySegments ?? 0,
    dateUnverifiedHints: providerDateUnverified.length,
    reason: adapterAudit?.reason ?? null
  });
}

const datePlan = buildDateUnverifiedWebPlan(dateUnverified, {
  generatedAt,
  targetDate,
  timeZone: TIME_ZONE
});
const sourceHealth = evaluateFixtureSourceCoverage(rows);
const unavailableProviders = providerAudits.filter(item =>
  ['SOURCE_UNAVAILABLE', 'NO_SNAPSHOT', 'ADAPTER_PROCESS_FAILED'].includes(item.status)
);
const dateContextDegradedProviders = providerAudits.filter(item =>
  item.status === 'DATE_CONTEXT_UNVERIFIED'
);
const status = !probe.ok
  ? 'FAIL_PROBE_PROCESS'
  : !probeUsable
    ? 'FAIL_ALL_TIER_A_SOURCES'
    : rows.length === 0 && datePlan.count === 0
      ? 'PASS_EMPTY'
      : unavailableProviders.length > 0 || dateContextDegradedProviders.length > 0
        ? 'PASS_WITH_SOURCE_FAILURES'
        : 'PASS';

const supplement = {
  contract: 'CFI_TIER_A_BROWSER_DISCOVERY_V1',
  generatedAt,
  targetDate,
  timeZone: TIME_ZONE,
  sourceClass: 'TIER_A_BROWSER_DISCOVERY',
  rows,
  dateUnverifiedHints: datePlan.count,
  dateUnverifiedPlan: DATE_UNVERIFIED_PLAN,
  sourceHealth,
  decisionUse: false,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

const audit = {
  contract: 'CFI_TIER_A_BROWSER_DISCOVERY_AUDIT_V1',
  generatedAt,
  status,
  targetDate,
  timeZone: TIME_ZONE,
  probe,
  probeAudit: probeAudit
    ? {
        status: probeAudit.status,
        sourcesConfigured: probeAudit.sourcesConfigured,
        sourcesSuccessful: probeAudit.sourcesSuccessful,
        sourcesBlocked: probeAudit.sourcesBlocked,
        sourcesErrored: probeAudit.sourcesErrored,
        snapshotsTruncated: probeAudit.snapshotsTruncated
      }
    : null,
  providersConfigured: PROVIDERS.map(([provider]) => provider),
  providerAudits,
  rows: rows.length,
  dateUnverifiedHints: datePlan.count,
  dateUnverifiedPlan: DATE_UNVERIFIED_PLAN,
  unavailableProviders: unavailableProviders.map(item => item.provider),
  dateContextDegradedProviders: dateContextDegradedProviders.map(item => item.provider),
  sourceHealth,
  safeguards: {
    isolatedFromPcNode: true,
    pcNodeIsGatekeeper: false,
    successfulProbeRequired: true,
    atLeastOneUsableTierASourceRequired: true,
    blockedPagesRejected: true,
    explicitKickoffTimeRequired: true,
    missingKickoffFabrication: false,
    sourceFailureDeletesFixture: false,
    dateUnverifiedHintCanEnterRegistry: false,
    dateUnverifiedHintCanEnterRanking: false,
    dateUnverifiedHintRequiresIndependentKickoffVerification: true,
    sourcePageDateClaimCanVerifyKickoff: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  }
};

await Promise.all([
  saveJson(OUTPUT, supplement),
  saveJson(AUDIT, audit),
  saveJson(DATE_UNVERIFIED_PLAN, datePlan)
]);

console.log(JSON.stringify({
  contract: audit.contract,
  status,
  targetDate,
  rows: rows.length,
  dateUnverifiedHints: datePlan.count,
  dateContextDegradedProviders: audit.dateContextDegradedProviders,
  sourceHealth: sourceHealth.status,
  coverageReadyForRanking: sourceHealth.coverageReadyForRanking,
  unavailableProviders: audit.unavailableProviders,
  decisionUse: false,
  bigDbWriteAllowed: false
}));

if (!probeUsable) process.exitCode = 1;
