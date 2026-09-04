import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDailyFixtureRegistry,
  selectRollingFixtureWindow
} from '../src/discovery/daily-fixture-registry.mjs';

const targetDate = '2026-09-04';
const timeZone = 'Asia/Ho_Chi_Minh';
const nowMs = Date.parse('2026-09-04T07:00:00Z'); // 14:00 GMT+7

function row(overrides = {}) {
  return {
    sourceClass: 'PC_NODE',
    provider: 'SOFASCORE',
    providerId: 'fixture-1',
    home: 'Alpha U20',
    away: 'Beta U20',
    canonicalHomeId: 'alpha-u20',
    canonicalAwayId: 'beta-u20',
    competition: 'U20 League',
    kickoffIso: '2026-09-04T08:20:00Z', // 15:20 GMT+7
    status: 'scheduled',
    observedAt: '2026-09-04T06:59:00Z',
    ...overrides
  };
}

test('registry merges PC-Node and supplemental evidence without duplicating the fixture', () => {
  const registry = mergeDailyFixtureRegistry(null, [
    row(),
    row({
      sourceClass: 'WEB_SEARCH',
      provider: 'AISCORE_WEB',
      providerId: 'ai-99',
      sourceUrl: 'https://example.com/fixture',
      observedAt: '2026-09-04T06:59:30Z'
    })
  ], { targetDate, timeZone, nowMs });

  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].kickoffCandidates.length, 1);
  assert.equal(registry.entries[0].verificationStatus, 'MULTI_SOURCE_EXACT');
  assert.equal(registry.entries[0].hasPcNodeEvidence, true);
  assert.equal(registry.entries[0].rescuedWithoutPcNode, false);
  assert.equal(registry.coverage.registryFixtures, 1);
  assert.equal(registry.policy.pcNodeIsGatekeeper, false);
  assert.equal(registry.bigDbWriteAllowed, false);
});

test('fixture discovered without PC-Node survives and enters the rolling prediction horizon', () => {
  const registry = mergeDailyFixtureRegistry(null, [
    row({
      sourceClass: 'WEB_SEARCH',
      provider: 'GPT_WEB_SEARCH',
      providerId: 'web-only-1'
    })
  ], { targetDate, timeZone, nowMs });

  const rolling = selectRollingFixtureWindow(registry, {
    nowMs,
    horizonMinutes: 90
  });

  assert.equal(registry.entries.length, 1);
  assert.equal(registry.coverage.withPcNodeEvidence, 0);
  assert.equal(registry.coverage.rescuedWithoutPcNode, 1);
  assert.equal(rolling.fixtures.length, 1);
  assert.equal(rolling.fixtures[0].rescuedWithoutPcNode, true);
  assert.equal(rolling.fixtures[0].queueStatus, 'READY_FOR_EVIDENCE_REFRESH');
});

test('source failure in a later cycle never deletes a previously discovered fixture', () => {
  const first = mergeDailyFixtureRegistry(null, [
    row({
      sourceClass: 'WEB_SEARCH',
      provider: 'GPT_WEB_SEARCH',
      providerId: 'web-first'
    })
  ], { targetDate, timeZone, nowMs });

  const second = mergeDailyFixtureRegistry(first, [], {
    targetDate,
    timeZone,
    nowMs: nowMs + 15 * 60_000
  });

  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].seenInCurrentCycle, false);
  assert.equal(second.coverage.notSeenInCurrentCycle, 1);

  const rolling = selectRollingFixtureWindow(second, {
    nowMs: nowMs + 15 * 60_000,
    horizonMinutes: 90
  });

  assert.equal(rolling.fixtures.length, 1);
  assert.equal(rolling.fixtures[0].queueStatus, 'REFRESH_REQUIRED');
});

test('same canonical teams and date with different kickoffs fail closed instead of choosing a source', () => {
  const registry = mergeDailyFixtureRegistry(null, [
    row(),
    row({
      sourceClass: 'WEB_SEARCH',
      provider: 'AISCORE_WEB',
      providerId: 'different-time',
      kickoffIso: '2026-09-04T08:50:00Z'
    })
  ], { targetDate, timeZone, nowMs });

  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].kickoffCandidates.length, 2);
  assert.equal(registry.entries[0].verificationStatus, 'CONFLICT_FAIL_CLOSED');
  assert.equal(registry.entries[0].hasKickoffConflict, true);

  const rolling = selectRollingFixtureWindow(registry, {
    nowMs,
    horizonMinutes: 120
  });

  assert.equal(rolling.fixtures.length, 0);
  assert.equal(rolling.metrics.conflictsExcluded, 1);
  assert.equal(rolling.excluded[0].reason, 'KICKOFF_CONFLICT');
});

test('re-ingesting an identical source observation is idempotent for fixture and provenance counts', () => {
  const first = mergeDailyFixtureRegistry(null, [row()], {
    targetDate,
    timeZone,
    nowMs
  });

  const second = mergeDailyFixtureRegistry(first, [row({
    observedAt: '2026-09-04T07:05:00Z'
  })], {
    targetDate,
    timeZone,
    nowMs: nowMs + 5 * 60_000
  });

  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].sourceObservations.length, 1);
  assert.equal(second.entries[0].kickoffCandidates.length, 1);
  assert.equal(second.entries[0].kickoffCandidates[0].sources.length, 1);
});

test('rolling 90-minute windows overlap instead of partitioning the day into rigid blocks', () => {
  const registry = mergeDailyFixtureRegistry(null, [row()], {
    targetDate,
    timeZone,
    nowMs
  });

  const at1400 = selectRollingFixtureWindow(registry, {
    nowMs,
    horizonMinutes: 90
  });

  const at1415 = selectRollingFixtureWindow(registry, {
    nowMs: nowMs + 15 * 60_000,
    horizonMinutes: 90
  });

  const at1530 = selectRollingFixtureWindow(registry, {
    nowMs: nowMs + 90 * 60_000,
    horizonMinutes: 90
  });

  assert.equal(at1400.fixtures.length, 1);
  assert.equal(at1415.fixtures.length, 1);
  assert.equal(at1530.fixtures.length, 0);
});

test('terminal observations stop a fixture from entering the prediction queue', () => {
  const registry = mergeDailyFixtureRegistry(null, [
    row(),
    row({
      sourceClass: 'WEB_SEARCH',
      provider: 'OFFICIAL',
      providerId: 'cancelled-1',
      status: 'cancelled'
    })
  ], { targetDate, timeZone, nowMs });

  assert.equal(registry.entries[0].verificationStatus, 'TERMINAL_OBSERVED_FAIL_CLOSED');
  assert.equal(registry.entries[0].hasTerminalObservation, true);

  const rolling = selectRollingFixtureWindow(registry, {
    nowMs,
    horizonMinutes: 90
  });

  assert.equal(rolling.fixtures.length, 0);
  assert.equal(rolling.excluded[0].reason, 'TERMINAL_OBSERVED');
});
