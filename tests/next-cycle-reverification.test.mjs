import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNextCycleReverification } from '../src/discovery/next-cycle-reverification.mjs';
import { annotateRegistryFixtureVerification } from '../src/discovery/fixture-verification.mjs';

function registry() {
  return {
    targetDate: '2026-09-05',
    entries: [
      {
        identityKey: 'raw home|raw away|2026-09-05',
        targetDate: '2026-09-05',
        home: 'Raw Home',
        away: 'Raw Away',
        canonicalHomeId: null,
        canonicalAwayId: null,
        sourceObservations: [
          {
            sourceClass: 'TIER_A_BROWSER_DISCOVERY',
            provider: 'FLASHSCORE',
            providerId: 'fs-1',
            sourceUrl: 'https://www.flashscore.com/match/test',
            kickoffIso: '2026-09-05T08:00:00.000Z',
            observedAt: '2026-09-05T06:00:00.000Z'
          }
        ],
        kickoffCandidates: [
          {
            kickoffIso: '2026-09-05T08:00:00.000Z',
            kickoffLocal: '15:00',
            sources: []
          }
        ],
        hasKickoffConflict: false,
        hasTerminalObservation: false,
        hasUpstreamFailClosed: false,
        distinctProviderCount: 1
      }
    ]
  };
}

function snapshot(sourceCycleId = 'cycle-1', overrides = {}) {
  return {
    generatedAt: '2026-09-05T06:01:00.000Z',
    sourceCycleId,
    rows: [
      {
        identityKey: 'raw home|raw away|2026-09-05',
        provider: 'CFI_BIGDB_RETRIEVAL',
        providerId: 'req-1',
        targetDate: '2026-09-05',
        kickoffIso: '2026-09-05T08:00:00.000Z',
        canonicalHomeId: 'HOME-ID',
        canonicalAwayId: 'AWAY-ID',
        observedAt: '2026-09-05T06:01:00.000Z',
        ...overrides
      }
    ]
  };
}

test('same orchestrator cycle cannot consume its own reverification evidence', () => {
  const result = applyNextCycleReverification(registry(), snapshot('cycle-1'), {
    currentCycleId: 'cycle-1',
    targetDate: '2026-09-05'
  });

  assert.equal(result.audit.applied, 0);
  assert.equal(result.audit.sameCycleBlocked, 1);
  assert.equal(result.audit.rejectedRows[0].reason, 'SAME_CYCLE_REVERIFICATION_FORBIDDEN');
  assert.equal(result.registry.entries[0].canonicalHomeId, null);
});

test('later cycle enriches exact existing registry entry and then canonical-plus-live verification can pass', () => {
  const result = applyNextCycleReverification(registry(), snapshot('cycle-1'), {
    currentCycleId: 'cycle-2',
    targetDate: '2026-09-05'
  });

  assert.equal(result.audit.applied, 1);
  assert.equal(result.registry.entries.length, 1);
  assert.equal(result.registry.entries[0].canonicalHomeId, 'HOME-ID');
  assert.equal(result.registry.entries[0].canonicalAwayId, 'AWAY-ID');
  assert.equal(result.registry.entries[0].reverificationEvidence.length, 1);

  const annotated = annotateRegistryFixtureVerification(result.registry);
  assert.equal(annotated.entries[0].rankingReady, true);
  assert.equal(
    annotated.entries[0].rankingVerificationStatus,
    'CANONICAL_PLUS_LIVE_VERIFIED'
  );
});

test('reverification can never create a new registry fixture', () => {
  const result = applyNextCycleReverification(
    registry(),
    snapshot('cycle-1', { identityKey: 'unknown|fixture|2026-09-05' }),
    { currentCycleId: 'cycle-2', targetDate: '2026-09-05' }
  );

  assert.equal(result.audit.applied, 0);
  assert.equal(result.audit.rejectedRows[0].reason, 'REGISTRY_ENTRY_NOT_FOUND');
  assert.equal(result.registry.entries.length, 1);
});

test('kickoff mismatch and canonical id conflict fail closed', () => {
  const kickoff = applyNextCycleReverification(
    registry(),
    snapshot('cycle-1', { kickoffIso: '2026-09-05T08:30:00.000Z' }),
    { currentCycleId: 'cycle-2', targetDate: '2026-09-05' }
  );
  assert.equal(kickoff.audit.applied, 0);
  assert.equal(kickoff.audit.rejectedRows[0].reason, 'KICKOFF_MISMATCH_FAIL_CLOSED');

  const existing = registry();
  existing.entries[0].canonicalHomeId = 'OTHER-HOME';
  existing.entries[0].canonicalAwayId = 'AWAY-ID';
  const conflict = applyNextCycleReverification(
    existing,
    snapshot('cycle-1'),
    { currentCycleId: 'cycle-2', targetDate: '2026-09-05' }
  );
  assert.equal(conflict.audit.applied, 0);
  assert.equal(conflict.audit.rejectedRows[0].reason, 'CANONICAL_ID_CONFLICT_FAIL_CLOSED');
});

test('cycle scope and trusted live source are mandatory', () => {
  const noCycle = applyNextCycleReverification(registry(), snapshot('cycle-1'), {
    currentCycleId: null,
    targetDate: '2026-09-05'
  });
  assert.equal(noCycle.audit.rejectedRows[0].reason, 'CURRENT_CYCLE_ID_REQUIRED');

  const noLiveRegistry = registry();
  noLiveRegistry.entries[0].sourceObservations = [];
  const noLive = applyNextCycleReverification(
    noLiveRegistry,
    snapshot('cycle-1'),
    { currentCycleId: 'cycle-2', targetDate: '2026-09-05' }
  );
  assert.equal(noLive.audit.applied, 0);
  assert.equal(noLive.audit.rejectedRows[0].reason, 'TRUSTED_LIVE_SOURCE_REQUIRED');
});
