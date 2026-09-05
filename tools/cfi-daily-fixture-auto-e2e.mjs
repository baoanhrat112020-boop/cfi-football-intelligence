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
  annotateRegistryFixtureVerification,
  annotateRollingVerification
} from '../src/discovery/fixture-verification.mjs';
import { buildRollingEvidenceQueues } from '../src/discovery/rolling-evidence-queues.mjs';
import { buildShadowEvidenceDispatch } from '../src/discovery/shadow-evidence-dispatcher.mjs';
import { applyNextCycleReverification } from '../src/discovery/next-cycle-reverification.mjs';
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

  const tierA = row({
    sourceClass: 'TIER_A_BROWSER_DISCOVERY',
    provider: 'AISCORE',
    providerId: 'tier-a-1',
    home: 'E2E Tier A Rescue U19',
    away: 'E2E Tier A Rescue Away U19',
    kickoffIso: isoLocal(targetDate, '12:45'),
    observedAt,
    sourceUrl: 'https://www.aiscore.com/e2e/tier-a-1'
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
    tierA,
    pub,
    ...webSupplement.rows
  ], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs,
    pcSourceClass: 'PC_NODE'
  });

  const matrix1 = buildRegistryCoverageMatrix(cycle1);
  must(matrix1.unionFixtures === 4, 'CYCLE1_UNION_EXPECTED_4', matrix1);
  must(matrix1.pcNodeFixtures === 1, 'CYCLE1_PC_EXPECTED_1', matrix1);
  must(matrix1.tierABrowserFixtures === 1, 'CYCLE1_TIER_A_BROWSER_EXPECTED_1', matrix1);
  must(matrix1.publicDiscoveryFixtures === 1, 'CYCLE1_PUBLIC_EXPECTED_1', matrix1);
  must(matrix1.webSearchRescueFixtures === 1, 'CYCLE1_WEB_EXPECTED_1', matrix1);
  must(matrix1.rescuedWithoutPcNode === 3, 'CYCLE1_PC_MISS_RESCUE_EXPECTED_3', matrix1);
  must(matrix1.rescuedByTierABrowser === 1, 'CYCLE1_TIER_A_RESCUE_EXPECTED_1', matrix1);

  const rolling1 = selectRollingFixtureWindow(cycle1, {
    nowMs,
    horizonMinutes: 90
  });
  must(rolling1.metrics.selected === 4, 'ROLLING_CYCLE1_EXPECTED_4', rolling1.metrics);

  const cycle2 = mergeDailyFixtureRegistry(cycle1, [], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs: nowMs + 5 * 60_000,
    pcSourceClass: 'PC_NODE'
  });
  const matrix2 = buildRegistryCoverageMatrix(cycle2);
  must(matrix2.unionFixtures === 4, 'SOURCE_FAILURE_DELETED_FIXTURES', matrix2);
  must(cycle2.coverage.seenInCurrentCycle === 0, 'SOURCE_FAILURE_SEEN_CURRENT_SHOULD_BE_0');
  must(cycle2.coverage.notSeenInCurrentCycle === 4, 'SOURCE_FAILURE_PRIOR_FIXTURE_COUNT_EXPECTED_4');

  const rolling2 = selectRollingFixtureWindow(cycle2, {
    nowMs: nowMs + 5 * 60_000,
    horizonMinutes: 90
  });
  must(rolling2.metrics.refreshRequired === 4, 'SOURCE_FAILURE_REFRESH_REQUIRED_EXPECTED_4');

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

function runTwoCycleEvidencePromotion(targetDate) {
  const cycle1Now = Date.parse(`${targetDate}T12:00:00+07:00`);
  const cycle2Now = cycle1Now + 5 * 60_000;
  const kickoffIso = isoLocal(targetDate, '13:20');
  const home = 'E2E Canonical Rescue Home U19';
  const away = 'E2E Canonical Rescue Away U19';
  const liveObservation = observedAt => row({
    sourceClass: 'TIER_A_BROWSER_DISCOVERY',
    provider: 'FLASHSCORE',
    providerId: 'two-cycle-fs-1',
    home,
    away,
    kickoffIso,
    observedAt,
    sourceUrl: 'https://www.flashscore.com/e2e/two-cycle-fs-1'
  });

  const cycle1Base = mergeDailyFixtureRegistry(null, [
    liveObservation(new Date(cycle1Now).toISOString())
  ], {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs: cycle1Now,
    pcSourceClass: 'PC_NODE'
  });
  const cycle1 = annotateRegistryFixtureVerification(cycle1Base, {
    pcSourceClass: 'PC_NODE'
  });
  const entry1 = cycle1.entries[0];
  must(cycle1.entries.length === 1, 'TWO_CYCLE_EXPECTED_ONE_FIXTURE');
  must(entry1?.rankingReady === false, 'TWO_CYCLE_SINGLE_SOURCE_SHOULD_NOT_RANK');
  must(
    entry1?.rankingVerificationStatus === 'SINGLE_TRUSTED_SOURCE_OBSERVED',
    'TWO_CYCLE_EXPECTED_SINGLE_TRUSTED_SOURCE',
    entry1?.rankingVerificationStatus
  );

  const rolling1 = annotateRollingVerification(
    selectRollingFixtureWindow(cycle1, {
      nowMs: cycle1Now,
      horizonMinutes: 90
    }),
    cycle1
  );
  const queues1 = buildRollingEvidenceQueues(rolling1);
  must(queues1.verifiedRankingQueue.count === 0, 'TWO_CYCLE_VERIFIED_QUEUE_SHOULD_START_EMPTY');
  must(queues1.crosscheckRequiredQueue.count === 1, 'TWO_CYCLE_CROSSCHECK_EXPECTED_ONE');
  must(queues1.metrics.droppedByQuota === 0, 'TWO_CYCLE_QUEUE_DROP_FORBIDDEN');

  const request = queues1.evidenceRequestPlan.requests[0];
  const bigDbResult = {
    httpStatus: 200,
    body: {
      status: 'OK',
      version: 'CFI_BIG_DB_RETRIEVAL_TWO_CYCLE_E2E',
      identity: {
        homeTeamId: 'E2E-CANON-HOME-ID',
        awayTeamId: 'E2E-CANON-AWAY-ID',
        homeCanonical: home,
        awayCanonical: away,
        homeResolution: 'CANONICAL_FOLDED_EXACT',
        awayResolution: 'CANONICAL_FOLDED_EXACT'
      },
      exactTeam: {
        home: { retrieved: 8 },
        away: { retrieved: 7 },
        h2h: { retrieved: 2 }
      },
      temporalAudit: {
        verified: true,
        targetDate
      }
    }
  };
  const dispatch = buildShadowEvidenceDispatch(
    queues1.evidenceRequestPlan,
    new Map([[request.requestId, bigDbResult]]),
    {
      liveReadEnabled: true,
      generatedAt: new Date(cycle1Now + 60_000).toISOString(),
      sourceCycleId: 'E2E-CYCLE-1'
    }
  );

  must(dispatch.metrics.bigDbFound === 1, 'TWO_CYCLE_BIGDB_FOUND_EXPECTED_ONE', dispatch.metrics);
  must(dispatch.metrics.autoPromoted === 0, 'TWO_CYCLE_DISPATCHER_AUTO_PROMOTED');
  must(dispatch.receipts[0]?.rankingReady === false, 'TWO_CYCLE_SAME_CYCLE_RANKING_LEAK');
  must(dispatch.nextCycleReverification.count === 1, 'TWO_CYCLE_REVERIFY_CANDIDATE_EXPECTED_ONE');
  must(
    dispatch.nextCycleReverification.rows[0]?.identityKey === entry1.identityKey,
    'TWO_CYCLE_REVERIFY_IDENTITY_KEY_CHANGED'
  );

  const sameCycle = applyNextCycleReverification(
    cycle1,
    dispatch.nextCycleReverification,
    {
      currentCycleId: 'E2E-CYCLE-1',
      targetDate,
      pcSourceClass: 'PC_NODE'
    }
  );
  must(sameCycle.audit.applied === 0, 'TWO_CYCLE_SAME_CYCLE_EVIDENCE_APPLIED');
  must(sameCycle.audit.sameCycleBlocked === 1, 'TWO_CYCLE_SAME_CYCLE_BLOCK_NOT_PROVEN');

  const nextCycleApplied = applyNextCycleReverification(
    cycle1,
    dispatch.nextCycleReverification,
    {
      currentCycleId: 'E2E-CYCLE-2',
      targetDate,
      pcSourceClass: 'PC_NODE'
    }
  );
  must(nextCycleApplied.audit.applied === 1, 'TWO_CYCLE_NEXT_CYCLE_APPLY_EXPECTED_ONE', nextCycleApplied.audit);
  must(nextCycleApplied.registry.entries.length === 1, 'TWO_CYCLE_REVERIFY_CREATED_DUPLICATE_FIXTURE');

  const cycle2Merged = mergeDailyFixtureRegistry(
    nextCycleApplied.registry,
    [liveObservation(new Date(cycle2Now).toISOString())],
    {
      targetDate,
      timeZone: TIME_ZONE,
      nowMs: cycle2Now,
      pcSourceClass: 'PC_NODE'
    }
  );
  const cycle2 = annotateRegistryFixtureVerification(cycle2Merged, {
    pcSourceClass: 'PC_NODE'
  });
  const entry2 = cycle2.entries[0];
  must(cycle2.entries.length === 1, 'TWO_CYCLE_CYCLE2_DUPLICATE_FIXTURE');
  must(entry2?.rankingReady === true, 'TWO_CYCLE_CYCLE2_NOT_RANKING_READY', entry2);
  must(
    entry2?.rankingVerificationStatus === 'CANONICAL_PLUS_LIVE_VERIFIED',
    'TWO_CYCLE_CANONICAL_PLUS_LIVE_NOT_PROVEN',
    entry2?.rankingVerificationStatus
  );

  const rolling2 = annotateRollingVerification(
    selectRollingFixtureWindow(cycle2, {
      nowMs: cycle2Now,
      horizonMinutes: 90
    }),
    cycle2
  );
  const queues2 = buildRollingEvidenceQueues(rolling2);
  must(queues2.verifiedRankingQueue.count === 1, 'TWO_CYCLE_VERIFIED_QUEUE_EXPECTED_ONE');
  must(queues2.crosscheckRequiredQueue.count === 0, 'TWO_CYCLE_CROSSCHECK_SHOULD_CLEAR');
  must(queues2.metrics.droppedByQuota === 0, 'TWO_CYCLE_CYCLE2_QUEUE_DROP_FORBIDDEN');
  must(
    queues2.verifiedRankingQueue.rows[0]?.predictionExecutionAllowed === false,
    'TWO_CYCLE_VERIFIED_QUEUE_ENABLED_PREDICTION'
  );
  must(
    queues2.verifiedRankingQueue.rows[0]?.decisionUse === false,
    'TWO_CYCLE_VERIFIED_QUEUE_ENABLED_DECISION_USE'
  );

  return {
    status: 'PASS',
    sourceCycleId: 'E2E-CYCLE-1',
    nextCycleId: 'E2E-CYCLE-2',
    cycle1: {
      rankingVerificationStatus: entry1.rankingVerificationStatus,
      rankingReady: entry1.rankingReady,
      verifiedQueue: queues1.verifiedRankingQueue.count,
      crosscheckQueue: queues1.crosscheckRequiredQueue.count
    },
    evidence: {
      bigDbFound: dispatch.metrics.bigDbFound,
      sameCycleAutoPromoted: dispatch.metrics.autoPromoted,
      nextCycleReverificationCandidates: dispatch.nextCycleReverification.count,
      sameCycleBlocked: sameCycle.audit.sameCycleBlocked,
      nextCycleApplied: nextCycleApplied.audit.applied
    },
    cycle2: {
      rankingVerificationStatus: entry2.rankingVerificationStatus,
      rankingReady: entry2.rankingReady,
      verifiedQueue: queues2.verifiedRankingQueue.count,
      crosscheckQueue: queues2.crosscheckRequiredQueue.count
    },
    safety: {
      duplicateFixturesCreated: cycle2.entries.length !== 1,
      droppedByQuota: queues1.metrics.droppedByQuota + queues2.metrics.droppedByQuota,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
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
  const sourceHealth = supplement.telemetry?.sourceHealth ?? null;
  const status = successfulAttempts === 0
    ? 'DEGRADED_ALL_PUBLIC_PROVIDERS_FAILED'
    : supplement.rows.length === 0
      ? 'PASS_EMPTY'
      : sourceHealth?.status === 'FALLBACK_ONLY'
        ? 'PASS_FALLBACK_ONLY'
        : sourceHealth?.status === 'SECONDARY_ONLY'
          ? 'PASS_SECONDARY_ONLY'
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
    sourceHealth,
    coverageReadyForRanking: sourceHealth?.coverageReadyForRanking === true,
    successfulAttempts,
    failedAttempts,
    search: discovery.search,
    note: 'Live provider smoke measures observable coverage only. Fallback-only ESPN/TheSportsDB coverage cannot satisfy ranking readiness and never claims global fixture recall.'
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const targetDate = localDateNow(TIME_ZONE, Date.now());

  let deterministic;
  let twoCycleEvidence;
  try {
    deterministic = await runDeterministicResilience(targetDate);
    twoCycleEvidence = runTwoCycleEvidencePromotion(targetDate);
  } catch (error) {
    const report = {
      contract: 'CFI_DAILY_FIXTURE_AUTO_E2E_V4',
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      deterministic: deterministic ?? {
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
        detail: error?.detail ?? null
      },
      twoCycleEvidence: twoCycleEvidence ?? {
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
    contract: 'CFI_DAILY_FIXTURE_AUTO_E2E_V4',
    status: 'PASS',
    startedAt,
    finishedAt: new Date().toISOString(),
    deterministic,
    twoCycleEvidence,
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
    `- Tier A browser rescued fixtures: ${deterministic.cycle1.matrix.rescuedByTierABrowser}\n` +
    `- PC-miss rescued fixtures (synthetic contract E2E): ${deterministic.cycle1.matrix.rescuedWithoutPcNode}\n` +
    `- Source-outage retained fixtures: ${deterministic.sourceFailureCycle.matrix.unionFixtures}\n` +
    `- Kickoff conflict status: ${deterministic.conflictCycle.verificationStatus}\n` +
    `- Two-cycle evidence path: ${twoCycleEvidence.status}\n` +
    `- Two-cycle cycle-1 state: ${twoCycleEvidence.cycle1.rankingVerificationStatus}\n` +
    `- Two-cycle same-cycle blocked: ${twoCycleEvidence.evidence.sameCycleBlocked}\n` +
    `- Two-cycle next-cycle applied: ${twoCycleEvidence.evidence.nextCycleApplied}\n` +
    `- Two-cycle cycle-2 state: ${twoCycleEvidence.cycle2.rankingVerificationStatus}\n` +
    `- Two-cycle verified queue after reverify: ${twoCycleEvidence.cycle2.verifiedQueue}\n` +
    `- Live public smoke: ${livePublic.status}\n` +
    `- Live public source health: ${livePublic.sourceHealth?.status ?? 'N/A'}\n` +
    `- Live public ranking-ready coverage: ${livePublic.coverageReadyForRanking === true}\n` +
    `- Live public rows: ${livePublic.rows ?? 0}\n` +
    `- Live public successful attempts: ${livePublic.successfulAttempts ?? 0}\n` +
    `- decisionUse: false\n` +
    `- bigDbWriteAllowed: false\n` +
    `- Production schedule activated: false\n\n` +
    `Live public-provider failure is non-blocking because third-party outages are an expected resilience scenario. Tier A browser discovery is additive and cannot become a PC-Node gate. Fallback-only ESPN/TheSportsDB rows do not satisfy ranking coverage readiness. Deterministic registry integrity failures and same-cycle evidence promotion are blocking.\n`;

  await Promise.all([
    writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8'),
    writeFile(REPORT_MD, md, 'utf8')
  ]);

  console.log(JSON.stringify({
    contract: report.contract,
    status: report.status,
    targetDate,
    deterministic: deterministic.status,
    tierABrowserRescued: deterministic.cycle1.matrix.rescuedByTierABrowser,
    rescuedWithoutPcNode: deterministic.cycle1.matrix.rescuedWithoutPcNode,
    retainedAfterSourceFailure: deterministic.sourceFailureCycle.matrix.unionFixtures,
    conflictStatus: deterministic.conflictCycle.verificationStatus,
    twoCycleEvidenceStatus: twoCycleEvidence.status,
    twoCycleStartState: twoCycleEvidence.cycle1.rankingVerificationStatus,
    twoCycleSameCycleBlocked: twoCycleEvidence.evidence.sameCycleBlocked,
    twoCycleNextCycleApplied: twoCycleEvidence.evidence.nextCycleApplied,
    twoCycleFinalState: twoCycleEvidence.cycle2.rankingVerificationStatus,
    twoCycleVerifiedQueue: twoCycleEvidence.cycle2.verifiedQueue,
    livePublicStatus: livePublic.status,
    livePublicSourceHealth: livePublic.sourceHealth?.status ?? null,
    livePublicCoverageReadyForRanking: livePublic.coverageReadyForRanking === true,
    livePublicRows: livePublic.rows ?? 0,
    decisionUse: false,
    bigDbWriteAllowed: false
  }));
}

await main();
