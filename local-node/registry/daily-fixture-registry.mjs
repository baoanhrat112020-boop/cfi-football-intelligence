import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  mergeDailyFixtureRegistry,
  selectRollingFixtureWindow
} from '../../src/discovery/daily-fixture-registry.mjs';
import {
  buildRegistryCoverageMatrix,
  snapshotFreshness
} from '../../src/discovery/registry-source-adapters.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const HORIZON_MINUTES = Number(
  process.env.CFI_ROLLING_HORIZON_MINUTES ?? 90
);
const PUBLIC_TTL_MINUTES = Number(
  process.env.CFI_PUBLIC_DISCOVERY_TTL_MINUTES ?? 30
);
const WEB_TTL_MINUTES = Number(
  process.env.CFI_WEB_RESCUE_TTL_MINUTES ?? 30
);
const SKIP_PC_INPUT = process.env.CFI_REGISTRY_SKIP_PC_INPUT === '1';

const FILES = {
  canonical: resolve('local-node/cache/canonical/prospective-fixtures.json'),
  registry: resolve('local-node/cache/registry/daily-fixture-registry.json'),
  rolling: resolve('local-node/cache/registry/rolling-fixture-window.json'),
  audit: resolve('local-node/cache/registry/daily-fixture-registry-audit.json'),
  publicDiscovery: resolve(
    process.env.CFI_PUBLIC_DISCOVERY_OUTPUT ||
    'local-node/cache/registry/public-discovery.json'
  ),
  webRescue: resolve(
    process.env.CFI_WEB_RESCUE_OUTPUT_FILE ||
    'local-node/cache/registry/web-search-rescue.json'
  ),
  supplement: process.env.CFI_DISCOVERY_SUPPLEMENT_FILE
    ? resolve(process.env.CFI_DISCOVERY_SUPPLEMENT_FILE)
    : null
};

function clean(value) {
  return String(value ?? '').trim();
}

async function readJson(file, fallback = null) {
  if (!file) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

function localDate(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));

  const get = type =>
    parts.find(part => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function canonicalObservations(canonical, observedAt) {
  const out = [];

  for (const fixture of Array.isArray(canonical?.fixtures)
    ? canonical.fixtures
    : []) {
    const provenance = Array.isArray(fixture?.provenance)
      ? fixture.provenance
      : [];

    const sources = provenance.length
      ? provenance
      : [{
          source_id: 'LOCAL_CANONICAL',
          provider_id: fixture?.canonical_fixture_id ?? null,
          source_url: null,
          kickoff_utc: fixture?.kickoff_utc
        }];

    for (const source of sources) {
      out.push({
        sourceClass: 'PC_NODE',
        provider:
          clean(source?.source_id) ||
          clean(source?.origin) ||
          'LOCAL_CANONICAL',
        providerId:
          clean(source?.provider_id) ||
          clean(fixture?.canonical_fixture_id) ||
          null,
        sourceUrl: clean(source?.source_url) || null,
        home: fixture?.home_team,
        away: fixture?.away_team,
        canonicalHomeId: fixture?.canonical_home_key,
        canonicalAwayId: fixture?.canonical_away_key,
        competition: fixture?.competition ?? null,
        country: fixture?.country ?? null,
        kickoffIso:
          clean(source?.kickoff_utc) ||
          clean(source?.kickoffIso) ||
          fixture?.kickoff_utc,
        status: 'scheduled',
        upstreamVerificationStatus:
          fixture?.verification_status ?? null,
        observedAt
      });
    }
  }

  return out;
}

function supplementObservations(supplement, observedAt, fallbackSourceClass) {
  const rows = Array.isArray(supplement)
    ? supplement
    : Array.isArray(supplement?.rows)
      ? supplement.rows
      : Array.isArray(supplement?.fixtures)
        ? supplement.fixtures
        : [];

  return rows.map(row => ({
    ...row,
    sourceClass:
      clean(row?.sourceClass) ||
      clean(row?.source_class) ||
      clean(supplement?.sourceClass) ||
      fallbackSourceClass,
    observedAt:
      clean(row?.observedAt) ||
      clean(row?.discoveredAt) ||
      observedAt
  }));
}

function freshRows(snapshot, freshness, observedAt, fallbackSourceClass) {
  if (!snapshot || freshness?.fresh !== true) return [];
  return supplementObservations(snapshot, observedAt, fallbackSourceClass);
}

const nowMs = Date.now();
const observedAt = new Date(nowMs).toISOString();
const targetDate =
  clean(process.env.CFI_TARGET_DATE) ||
  localDate(nowMs, TIME_ZONE);

if (!Number.isFinite(HORIZON_MINUTES) || HORIZON_MINUTES <= 0) {
  throw new Error('CFI_ROLLING_HORIZON_MINUTES_INVALID');
}
if (!Number.isFinite(PUBLIC_TTL_MINUTES) || PUBLIC_TTL_MINUTES <= 0) {
  throw new Error('CFI_PUBLIC_DISCOVERY_TTL_MINUTES_INVALID');
}
if (!Number.isFinite(WEB_TTL_MINUTES) || WEB_TTL_MINUTES <= 0) {
  throw new Error('CFI_WEB_RESCUE_TTL_MINUTES_INVALID');
}

const [
  canonical,
  previousRegistry,
  publicDiscovery,
  webRescue,
  supplement
] = await Promise.all([
  SKIP_PC_INPUT ? Promise.resolve(null) : readJson(FILES.canonical),
  readJson(FILES.registry),
  readJson(FILES.publicDiscovery),
  readJson(FILES.webRescue),
  readJson(FILES.supplement)
]);

if (
  !SKIP_PC_INPUT &&
  (!canonical || !Array.isArray(canonical?.fixtures))
) {
  throw new Error('CANONICAL_PROSPECTIVE_FIXTURES_REQUIRED');
}

const publicFreshness = publicDiscovery
  ? snapshotFreshness(publicDiscovery, {
      nowMs,
      ttlMinutes: PUBLIC_TTL_MINUTES
    })
  : { fresh: false, reason: 'SNAPSHOT_MISSING', ageMinutes: null };

const webFreshness = webRescue
  ? snapshotFreshness(webRescue, {
      nowMs,
      ttlMinutes: WEB_TTL_MINUTES
    })
  : { fresh: false, reason: 'SNAPSHOT_MISSING', ageMinutes: null };

const pcRows = SKIP_PC_INPUT
  ? []
  : canonicalObservations(canonical, observedAt);
const publicRows = freshRows(
  publicDiscovery,
  publicFreshness,
  observedAt,
  'PUBLIC_DISCOVERY'
);
const webRows = freshRows(
  webRescue,
  webFreshness,
  observedAt,
  'WEB_SEARCH_RESCUE'
);
const supplementalRows = supplementObservations(
  supplement,
  observedAt,
  'CFI_SUPPLEMENT'
);
const allRows = [
  ...pcRows,
  ...publicRows,
  ...webRows,
  ...supplementalRows
];

const registry = mergeDailyFixtureRegistry(
  previousRegistry,
  allRows,
  {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs,
    pcSourceClass: 'PC_NODE'
  }
);

const rolling = selectRollingFixtureWindow(registry, {
  nowMs,
  horizonMinutes: HORIZON_MINUTES
});

const coverageMatrix = buildRegistryCoverageMatrix(registry);
const degradedInputs = [];
if (publicDiscovery && !publicFreshness.fresh) {
  degradedInputs.push({
    sourceClass: 'PUBLIC_DISCOVERY',
    reason: publicFreshness.reason,
    ageMinutes: publicFreshness.ageMinutes
  });
}
if (webRescue && !webFreshness.fresh) {
  degradedInputs.push({
    sourceClass: 'WEB_SEARCH_RESCUE',
    reason: webFreshness.reason,
    ageMinutes: webFreshness.ageMinutes
  });
}

const hasFailClosed =
  registry.coverage.kickoffConflicts > 0 ||
  registry.coverage.upstreamFailClosed > 0 ||
  registry.coverage.terminalObserved > 0;

const audit = {
  contract: 'CFI_DAILY_FIXTURE_REGISTRY_AUDIT_V2',
  generatedAt: observedAt,
  status: hasFailClosed
    ? 'PASS_WITH_FAIL_CLOSED_ITEMS'
    : SKIP_PC_INPUT || degradedInputs.length > 0
      ? 'PASS_WITH_DEGRADED_INPUTS'
      : 'PASS',
  targetDate,
  timeZone: TIME_ZONE,
  horizonMinutes: HORIZON_MINUTES,
  input: {
    pcNodeSkipped: SKIP_PC_INPUT,
    canonicalFixtures: Array.isArray(canonical?.fixtures)
      ? canonical.fixtures.length
      : 0,
    pcNodeObservations: pcRows.length,
    publicDiscoveryObservations: publicRows.length,
    webSearchRescueObservations: webRows.length,
    supplementalObservations: supplementalRows.length,
    publicDiscoverySnapshot: {
      configured: true,
      present: Boolean(publicDiscovery),
      ...publicFreshness
    },
    webSearchRescueSnapshot: {
      configured: true,
      present: Boolean(webRescue),
      ...webFreshness
    },
    supplementConfigured: Boolean(FILES.supplement),
    degradedInputs
  },
  coverage: registry.coverage,
  coverageMatrix,
  rolling: rolling.metrics,
  safety: {
    pcNodeIsGatekeeper: false,
    registryRunsWithoutPcNode: true,
    publicDiscoveryIsAdditive: true,
    webSearchRescueIsAdditive: true,
    staleSnapshotsAreNotReingested: true,
    sourceFailureDeletesFixture: false,
    conflictPolicy: 'FAIL_CLOSED',
    upstreamFailClosedPropagates: true,
    automaticKickoffCorrection: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  }
};

await Promise.all([
  saveJson(FILES.registry, registry),
  saveJson(FILES.rolling, rolling),
  saveJson(FILES.audit, audit)
]);

console.log(JSON.stringify({
  status: audit.status,
  contract: audit.contract,
  targetDate,
  pcNodeSkipped: SKIP_PC_INPUT,
  registryFixtures: registry.coverage.registryFixtures,
  seenInCurrentCycle: registry.coverage.seenInCurrentCycle,
  pcNodeFixtures: coverageMatrix.pcNodeFixtures,
  publicDiscoveryFixtures: coverageMatrix.publicDiscoveryFixtures,
  webSearchRescueFixtures: coverageMatrix.webSearchRescueFixtures,
  rescuedWithoutPcNode: coverageMatrix.rescuedWithoutPcNode,
  rescuedByPublicDiscovery: coverageMatrix.rescuedByPublicDiscovery,
  rescuedByWebSearch: coverageMatrix.rescuedByWebSearch,
  upstreamFailClosed: registry.coverage.upstreamFailClosed,
  rollingSelected: rolling.metrics.selected,
  conflictsExcluded: rolling.metrics.conflictsExcluded,
  upstreamFailClosedExcluded: rolling.metrics.upstreamFailClosedExcluded,
  decisionUse: false,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
}));
