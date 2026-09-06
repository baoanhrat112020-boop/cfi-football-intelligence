import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDailyFixtureRegistry, selectRollingFixtureWindow } from '../src/discovery/daily-fixture-registry.mjs';
import {
  annotateRegistryFixtureVerification,
  annotateRollingVerification
} from '../src/discovery/fixture-verification.mjs';
import { buildRollingEvidenceQueues } from '../src/discovery/rolling-evidence-queues.mjs';
import { buildShadowEvidenceDispatch } from '../src/discovery/shadow-evidence-dispatcher.mjs';
import { applyNextCycleReverification } from '../src/discovery/next-cycle-reverification.mjs';

const targetDate = '2026-09-05';
const kickoffIso = '2026-09-05T08:00:00.000Z';
const cycle1Now = Date.parse('2026-09-05T06:45:00.000Z');
const cycle2Now = Date.parse('2026-09-05T06:50:00.000Z');

function liveObservation(observedAt = '2026-09-05T06:44:00.000Z') {
  return {
    sourceClass: 'TIER_A_BROWSER_DISCOVERY',
    provider: 'FLASHSCORE',
    providerId: 'fs-cycle-proof',
    sourceUrl: 'https://www.flashscore.com/match/cycle-proof',
    home: 'Cycle Proof Home',
    away: 'Cycle Proof Away',
    targetDate,
    kickoffIso,
    status: 'scheduled',
    observedAt
  };
}

function bigDbResult() {
  return {
    httpStatus: 200,
    body: {
      status: 'OK',
      version: 'CFI_BIG_DB_RETRIEVAL_E2E_TEST',
      identity: {
        homeTeamId: 'CANON-HOME-ID',
        awayTeamId: 'CANON-AWAY-ID',
        homeCanonical: 'Cycle Proof Home',
        awayCanonical: 'Cycle Proof Away',
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
}

function buildCycle1Registry() {
  const merged = mergeDailyFixtureRegistry(null, [liveObservation()], {
    targetDate,
    timeZone: 'Asia/Ho_Chi_Minh',
    nowMs: cycle1Now,
    pcSourceClass: 'PC_NODE'
  });
  return annotateRegistryFixtureVerification(merged, { pcSourceClass: 'PC_NODE' });
}

test('two-cycle path: single trusted source -> BigDB canonical -> same-cycle block -> next-cycle CANONICAL_PLUS_LIVE_VERIFIED', () => {
  // CYCLE 1: one trusted live source discovers the fixture.
  const cycle1Registry = buildCycle1Registry();
  assert.equal(cycle1Registry.entries.length, 1);
  const cycle1Entry = cycle1Registry.entries[0];
  assert.equal(cycle1Entry.rankingReady, false);
  assert.equal(cycle1Entry.rankingVerificationStatus, 'SINGLE_TRUSTED_SOURCE_OBSERVED');

  const cycle1Rolling = annotateRollingVerification(
    selectRollingFixtureWindow(cycle1Registry, {
      nowMs: cycle1Now,
      horizonMinutes: 90
    }),
    cycle1Registry
  );
  assert.equal(cycle1Rolling.fixtures.length, 1);
  assert.equal(cycle1Rolling.fixtures[0].rankingReady, false);

  const queues = buildRollingEvidenceQueues(cycle1Rolling);
  assert.equal(queues.verifiedRankingQueue.count, 0);
  assert.equal(queues.crosscheckRequiredQueue.count, 1);
  assert.equal(queues.metrics.droppedByQuota, 0);

  // BigDB resolves exact canonical identity and strict-prior evidence, but dispatcher
  // is forbidden from changing ranking state in the same cycle.
  const request = queues.evidenceRequestPlan.requests[0];
  const dispatch = buildShadowEvidenceDispatch(
    queues.evidenceRequestPlan,
    new Map([[request.requestId, bigDbResult()]]),
    {
      liveReadEnabled: true,
      generatedAt: '2026-09-05T06:46:00.000Z',
      sourceCycleId: 'cycle-1'
    }
  );
  assert.equal(dispatch.metrics.bigDbFound, 1);
  assert.equal(dispatch.receipts[0].rankingReady, false);
  assert.equal(dispatch.receipts[0].autoPromoted, false);
  assert.equal(dispatch.nextCycleReverification.count, 1);
  assert.equal(dispatch.nextCycleReverification.rows[0].identityKey, cycle1Entry.identityKey);

  // SAME CYCLE: explicit block proves no race/leak promotion.
  const sameCycle = applyNextCycleReverification(
    cycle1Registry,
    dispatch.nextCycleReverification,
    {
      currentCycleId: 'cycle-1',
      targetDate,
      pcSourceClass: 'PC_NODE'
    }
  );
  assert.equal(sameCycle.audit.applied, 0);
  assert.equal(sameCycle.audit.sameCycleBlocked, 1);
  assert.equal(sameCycle.registry.entries[0].rankingReady, false);

  // CYCLE 2: previous-cycle canonical evidence enriches the existing entry only.
  const applied = applyNextCycleReverification(
    cycle1Registry,
    dispatch.nextCycleReverification,
    {
      currentCycleId: 'cycle-2',
      targetDate,
      pcSourceClass: 'PC_NODE'
    }
  );
  assert.equal(applied.audit.applied, 1);
  assert.equal(applied.registry.entries.length, 1);
  assert.equal(applied.registry.entries[0].canonicalHomeId, 'CANON-HOME-ID');
  assert.equal(applied.registry.entries[0].canonicalAwayId, 'CANON-AWAY-ID');

  // Cycle 2 still sees the same trusted live observation. No new fixture is created.
  const cycle2Merged = mergeDailyFixtureRegistry(
    applied.registry,
    [liveObservation('2026-09-05T06:49:00.000Z')],
    {
      targetDate,
      timeZone: 'Asia/Ho_Chi_Minh',
      nowMs: cycle2Now,
      pcSourceClass: 'PC_NODE'
    }
  );
  const cycle2Registry = annotateRegistryFixtureVerification(cycle2Merged, {
    pcSourceClass: 'PC_NODE'
  });
  assert.equal(cycle2Registry.entries.length, 1);
  assert.equal(cycle2Registry.entries[0].rankingReady, true);
  assert.equal(
    cycle2Registry.entries[0].rankingVerificationStatus,
    'CANONICAL_PLUS_LIVE_VERIFIED'
  );

  const cycle2Rolling = annotateRollingVerification(
    selectRollingFixtureWindow(cycle2Registry, {
      nowMs: cycle2Now,
      horizonMinutes: 90
    }),
    cycle2Registry
  );
  const cycle2Queues = buildRollingEvidenceQueues(cycle2Rolling);
  assert.equal(cycle2Queues.verifiedRankingQueue.count, 1);
  assert.equal(cycle2Queues.crosscheckRequiredQueue.count, 0);
  assert.equal(cycle2Queues.metrics.droppedByQuota, 0);
  assert.equal(cycle2Queues.verifiedRankingQueue.rows[0].identityKey, cycle1Entry.identityKey);
  assert.equal(cycle2Queues.verifiedRankingQueue.rows[0].rankingInputEligible, true);
  assert.equal(cycle2Queues.verifiedRankingQueue.rows[0].predictionExecutionAllowed, false);
  assert.equal(cycle2Queues.verifiedRankingQueue.rows[0].decisionUse, false);
});
