import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  mergeDailyFixtureRegistry,
  selectRollingFixtureWindow
} from '../../src/discovery/daily-fixture-registry.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const HORIZON_MINUTES = Number(process.env.CFI_ROLLING_HORIZON_MINUTES ?? 90);

const FILES = {
  canonical: resolve('local-node/cache/canonical/prospective-fixtures.json'),
  registry: resolve('local-node/cache/registry/daily-fixture-registry.json'),
  rolling: resolve('local-node/cache/registry/rolling-fixture-window.json'),
  audit: resolve('local-node/cache/registry/daily-fixture-registry-audit.json'),
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
          source_url: null
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
        kickoffIso: fixture?.kickoff_utc,
        status:
          fixture?.verification_status === 'CONFLICT_FAIL_CLOSED'
            ? 'scheduled'
            : 'scheduled',
        observedAt
      });
    }
  }

  return out;
}

function supplementObservations(supplement, observedAt) {
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
      'CFI_SUPPLEMENT',
    observedAt:
      clean(row?.observedAt) ||
      clean(row?.discoveredAt) ||
      observedAt
  }));
}

const nowMs = Date.now();
const observedAt = new Date(nowMs).toISOString();
const targetDate = clean(process.env.CFI_TARGET_DATE) || localDate(nowMs, TIME_ZONE);

if (!Number.isFinite(HORIZON_MINUTES) || HORIZON_MINUTES <= 0) {
  throw new Error('CFI_ROLLING_HORIZON_MINUTES_INVALID');
}

const [canonical, previousRegistry, supplement] = await Promise.all([
  readJson(FILES.canonical),
  readJson(FILES.registry),
  readJson(FILES.supplement)
]);

if (!canonical || !Array.isArray(canonical?.fixtures)) {
  throw new Error('CANONICAL_PROSPECTIVE_FIXTURES_REQUIRED');
}

const pcRows = canonicalObservations(canonical, observedAt);
const supplementalRows = supplementObservations(supplement, observedAt);
const allRows = [...pcRows, ...supplementalRows];

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

const audit = {
  contract: 'CFI_DAILY_FIXTURE_REGISTRY_AUDIT_V1',
  generatedAt: observedAt,
  status:
    registry.coverage.kickoffConflicts > 0 ||
    registry.coverage.terminalObserved > 0
      ? 'PASS_WITH_FAIL_CLOSED_ITEMS'
      : 'PASS',
  targetDate,
  timeZone: TIME_ZONE,
  horizonMinutes: HORIZON_MINUTES,
  input: {
    canonicalFixtures: canonical.fixtures.length,
    pcNodeObservations: pcRows.length,
    supplementalObservations: supplementalRows.length,
    supplementConfigured: Boolean(FILES.supplement)
  },
  coverage: registry.coverage,
  rolling: rolling.metrics,
  safety: {
    pcNodeIsGatekeeper: false,
    sourceFailureDeletesFixture: false,
    conflictPolicy: 'FAIL_CLOSED',
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

console.log(
  JSON.stringify({
    status: audit.status,
    contract: audit.contract,
    targetDate,
    registryFixtures: registry.coverage.registryFixtures,
    seenInCurrentCycle: registry.coverage.seenInCurrentCycle,
    rescuedWithoutPcNode: registry.coverage.rescuedWithoutPcNode,
    rollingSelected: rolling.metrics.selected,
    conflictsExcluded: rolling.metrics.conflictsExcluded,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  })
);
