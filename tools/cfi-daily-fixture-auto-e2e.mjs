#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  mergeDailyFixtureRegistry,
  selectRollingFixtureWindow
} from '../src/discovery/daily-fixture-registry.mjs';
import {
  buildRegistryCoverageMatrix,
  publicDiscoveryToSupplement,
  webSearchCandidatesToSupplement
} from '../src/discovery/registry-source-adapters.mjs';
import {
  discoverFixtures,
  localDateNow
} from '../src/discovery/cfi-discovery.ts';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const REPORT_DIR = resolve('audit-reports');
const REPORT_JSON = resolve(REPORT_DIR, 'cfi-daily-fixture-auto-e2e.json');
const REPORT_MD = resolve(REPORT_DIR, 'cfi-daily-fixture-auto-e2e.md');

function must(condition, code, detail = null) {
  if (!condition) {
    const error = new Error(code);
    error.detail = detail;
    throw error;
  }
}

function isoLocal(targetDate, hhmm) {
  return new Date(`${targetDate}T${hhmm}:00+07:00`).toISOString();
}

function row({
  sourceClass,
  provider,
  providerId,
  home,
  away,
  kickoffIso,
  observedAt,
  sourceUrl = null,
  status = 'scheduled'
}) {
  return {
    sourceClass,
    provider,
    providerId,
    sourceUrl,
    home,
    away,
    competition: 'CFI E2E Shadow League',
    country: 'E2E',
    kickoffIso,
    status,
    observedAt
  };
}

async function runDeterministicResilience(targetDate) {
  const nowMs = Date.parse(`${targetDate}T12:00:00+07:00`);
  const observedAt = new Date(nowMs).toISOString();

  const pc = row({
    sourceClass: 'PC_NODE',
    provider: 'E2E_PC',
    providerId: 'pc-1',
    home: 'E2E PC Home U20',
    away: 'E2E PC Away U20',
    kickoffIso: isoLocal(targetDate, '12:30'),
    observedAt
  });

  const pub = row({
    sourceClass: 'PUBLIC_DISCOVERY',
    provider: 'E2E_PUBLIC',
    providerId: 'public-1',
    home: 'E2E Public Rescue Women U19',
    away: 'E2E Public Rescue Away Women U19',
    kickoffIso: isoLocal(targetDate, '13:00'),
    observedAt,
    sourceUrl: 'https://example.com/e2e/public-1'
  });

  const webSupplement = webSearchCandidatesToSupplement([
    {
      providerId: 'web-1',
      home: 'E2E Web Rescue Reserves',
      away: 'E2E Web Rescue II',
      competition: 'CFI E2E Shadow League',
      country: 'E2E',
      kickoffIso: isoLocal(targetDate, '13:15'),
      status: 'scheduled',
      sourceUrls: ['https://example.com/e2e/web-1'],
      discoveredAt: observedAt
    }
  ], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs
  });

  must(webSupplement.rows.length === 1, 'WEB_RESCUE_VALID_CANDIDATE_REJECTED');
  must(webSupplement.rejected.length === 0, 'WEB_RESCUE_UNEXPECTED_REJECTION');

  const cycle1 = mergeDailyFixtureRegistry(null, [
    pc,
    pub,
    ...webSupplement.rows
  ], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs,
    pcSourceClass: 'PC_NODE'
  });

  const matrix1 = buildRegistryCoverageMatrix(cycle1);
  must(matrix1.unionFixtures === 3, 'CYCLE1_UNION_EXPECTED_3', matrix1);
  must(matrix1.pcNodeFixtures === 1, 'CYCLE1_PC_EXPECTED_1', matrix1);
  must(matrix1.publicDiscoveryFixtures === 1, 'CYCLE1_PUBLIC_EXPECTED_1', matrix1);
  must(matrix1.webSearchRescueFixtures === 1, 'CYCLE1_WEB_EXPECTED_1', matrix1);
  must(matrix1.rescuedWithoutPcNode === 2, 'CYCLE1_PC_MISS_RESCUE_EXPECTED_2', matrix1);

  const rolling1 = selectRollingFixtureWindow(cycle1, {
    nowMs,
    horizonMinutes: 90
  });
  must(rolling1.metrics.selected === 3, 'ROLLING_CYCLE1_EXPECTED_3', rolling1.metrics);

  // Simulate a complete current-cycle discovery outage. Prior registry entries
  // must remain available for refresh and must never be deleted by source absence.
  const cycle2 = mergeDailyFixtureRegistry(cycle1, [], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs: nowMs + 5 * 60_000,
    pcSourceClass: 'PC_NODE'
  });
  const matrix2 = buildRegistryCoverageMatrix(cycle2);
  must(matrix2.unionFixtures === 3, 'SOURCE_FAILURE_DELETED_FIXTURES', matrix2);
  must(cycle2.coverage.seenInCurrentCycle === 0, 'SOURCE_FAILURE_SEEN_CURRENT_SHOULD_BE_0');
  must(cycle2.coverage.notSeenInCurrentCycle === 3, 'SOURCE_FAILURE_PRIOR_FIXTURE_COUNT_EXPECTED_3');

  const rolling2 = selectRollingFixtureWindow(cycle2, {
    nowMs: nowMs + 5 * 60_000,
    horizonMinutes: 90
  });
  must(rolling2.metrics.refreshRequired === 3, 'SOURCE_FAILURE_REFRESH_REQUIRED_EXPECTED_3');

  // Same identity/date with a second kickoff from another source must fail closed.
  const conflictObservation = row({
    sourceClass: 'WEB_SEARCH_RESCUE',
    provider: 'E2E_WEB_CONFLICT',
    providerId: 'conflict-1',
    home: 'E2E Public Rescue Women U19',
    away: 'E2E Public Rescue Away Women U19',
    kickoffIso: isoLocal(targetDate, '13:10'),
    observedAt: new Date(nowMs + 10 * 60_000).toISOString(),
    sourceUrl: 'https://example.com/e2e/conflict-1'
  });

  const cycle3 = mergeDailyFixtureRegistry(cycle2, [conflictObservation], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs: nowMs + 10 * 60_000,
    pcSourceClass: 'PC_NODE'
  });
  const conflictEntry = cycle3.entries.find(entry =>
    entry.home === 'E2E Public Rescue Women U19'
  );
  must(conflictEntry?.hasKickoffConflict === true, 'KICKOFF_CONFLICT_NOT_DETECTED', conflictEntry);
  must(conflictEntry?.verificationStatus === 'CONFLICT_FAIL_CLOSED', 'KICKOFF_CONFLICT_NOT_FAIL_CLOSED', conflictEntry);

  const rolling3 = selectRollingFixtureWindow(cycle3, {
    nowMs: nowMs + 10 * 60_000,
    horizonMinutes: 90
  });
  must(
    rolling3.excluded.some(item =>
      item.identityKey === conflictEntry.identityKey &&
      item.reason === 'KICKOFF_CONFLICT'
    ),
    'KICKOFF_CONFLICT_ENTERED_ROLLING_QUEUE'
  );

  must(cycle3.decisionUse === false, 'DECISION_USE_MUST_REMAIN_FALSE');
  must(cycle3.bigDbWriteAllowed === false, 'BIGDB_WRITE_MUST_REMAIN_FALSE');

  return {
    status: 'PASS',
    targetDate,
    cycle1: {
      coverage: cycle1.coverage,
      matrix: matrix1,
      rolling: rolling1.metrics
    },
    sourceFailureCycle: {
      coverage: cycle2.coverage,
      matrix: matrix2,
      rolling: rolling2.metrics
    },
    conflictCycle: {
      verificationStatus: conflictEntry.verificationStatus,
      kickoffCandidates: conflictEntry.kickoffCandidates.length,
      rolling: rolling3.metrics
    }
  };
}

async function runLivePublicSmoke() {
  const nowMs = Date.now();
  const targetDate = localDateNow(TIME_ZONE, nowMs);
  let discovery = null;
  let thrown = null;

  try {
    discovery = await discoverFixtures({
      targetDate,
      timeZone: TIME_ZONE,
      nowMs,
      minimumRows: 100
    });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }

  if (!discovery) {
    return {
      status: 'DEGRADED_SOURCE_EXCEPTION',
      targetDate,
      error: thrown,
      blocking: false
    };
  }

  const supplement = publicDiscoveryToSupplement(discovery, {
    observedAt: new Date(nowMs).toISOString()
  });
  const attempts = Array.isArray(discovery.attempts) ? discovery.attempts : [];
  const successfulAttempts = attempts.filter(attempt => attempt?.ok === true).length;
  const failedAttempts = attempts.length - successfulAttempts;
  const status = successfulAttempts === 0
    ? 'DEGRADED_ALL_PUBLIC_PROVIDERS_FAILED'
    : supplement.rows.length === 0
      ? 'PASS_EMPTY'
      : 'PASS';

  must(supplement.decisionUse === false, 'LIVE_PUBLIC_DECISION_USE_MUST_BE_FALSE');
  must(supplement.bigDbWriteAllowed === false, 'LIVE_PUBLIC_BIGDB_WRITE_MUST_BE_FALSE');

  return {
    status,
    targetDate,
    blocking: false,
    provider: discovery.provider,
    providers: discovery.providers,
    rows: supplement.rows.length,
    successfulAttempts,
    failedAttempts,
    search: discovery.search,
    note: 'Live provider smoke measures observable coverage only; it does not claim global fixture recall.'
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const targetDate = localDateNow(TIME_ZONE, Date.now());

  let deterministic;
  try {
    deterministic = await runDeterministicResilience(targetDate);
  } catch (error) {
    const report = {
      contract: 'CFI_DAILY_FIXTURE_AUTO_E2E_V1',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      deterministic: {
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
        detail: error?.detail ?? null
      },
      livePublic: null,
      safety: {
        shadowOnly: true,
        decisionUse: false,
        bigDbWriteAllowed: false,
        productionScheduleActivated: false
      }
    };
    await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
    throw error;
  }

  const livePublic = await runLivePublicSmoke();
  const report = {
    contract: 'CFI_DAILY_FIXTURE_AUTO_E2E_V1',
    status: 'PASS',
    startedAt,
    finishedAt: new Date().toISOString(),
    deterministic,
    livePublic,
    safety: {
      shadowOnly: true,
      decisionUse: false,
      bigDbWriteAllowed: false,
      bigDbWriteAttempted: false,
      productionScheduleActivated: false,
      automaticBetting: false
    }
  };

  const md = `# CFI Daily Fixture Auto E2E\n\n` +
    `- Contract: ${report.contract}\n` +
    `- Status: ${report.status}\n` +
    `- Target date: ${targetDate}\n` +
    `- Deterministic resilience: ${deterministic.status}\n` +
    `- PC-miss rescued fixtures (synthetic contract E2E): ${deterministic.cycle1.matrix.rescuedWithoutPcNode}\n` +
    `- Source-outage retained fixtures: ${deterministic.sourceFailureCycle.matrix.unionFixtures}\n` +
    `- Kickoff conflict status: ${deterministic.conflictCycle.verificationStatus}\n` +
    `- Live public smoke: ${livePublic.status}\n` +
    `- Live public rows: ${livePublic.rows ?? 0}\n` +
    `- Live public successful attempts: ${livePublic.successfulAttempts ?? 0}\n` +
    `- decisionUse: false\n` +
    `- bigDbWriteAllowed: false\n` +
    `- Production schedule activated: false\n\n` +
    `Live public-provider failure is non-blocking because third-party outages are an expected resilience scenario. Deterministic registry integrity failures are blocking.\n`;

  await Promise.all([
    writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8'),
    writeFile(REPORT_MD, md, 'utf8')
  ]);

  console.log(JSON.stringify({
    contract: report.contract,
    status: report.status,
    targetDate,
    deterministic: deterministic.status,
    rescuedWithoutPcNode: deterministic.cycle1.matrix.rescuedWithoutPcNode,
    retainedAfterSourceFailure: deterministic.sourceFailureCycle.matrix.unionFixtures,
    conflictStatus: deterministic.conflictCycle.verificationStatus,
    livePublicStatus: livePublic.status,
    livePublicRows: livePublic.rows ?? 0,
    decisionUse: false,
    bigDbWriteAllowed: false
  }));
}

await main();
