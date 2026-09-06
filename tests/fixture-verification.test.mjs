import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateRegistryFixtureVerification,
  annotateRollingVerification,
  evaluateFixtureVerification
} from '../src/discovery/fixture-verification.mjs';

function entry(overrides = {}) {
  return {
    identityKey: 'home|away|2026-09-05',
    canonicalHomeId: null,
    canonicalAwayId: null,
    sourceObservations: [],
    kickoffCandidates: [{ kickoffIso: '2026-09-05T12:00:00.000Z' }],
    hasKickoffConflict: false,
    hasTerminalObservation: false,
    hasUpstreamFailClosed: false,
    distinctProviderCount: 1,
    ...overrides
  };
}

function source(provider, sourceClass = 'TIER_A_BROWSER_DISCOVERY') {
  const urls = {
    BONGDAWAP: 'https://bongdawap.com/lich-thi-dau-bong-da.html',
    FLASHSCORE: 'https://www.flashscore.com/football/',
    AISCORE: 'https://www.aiscore.com/',
    ESPN: 'https://www.espn.com/soccer/fixtures',
    THESPORTSDB: 'https://www.thesportsdb.com/'
  };
  return {
    sourceClass,
    provider,
    providerId: `${provider}-1`,
    sourceUrl: urls[provider] ?? 'https://example.com/',
    kickoffIso: '2026-09-05T12:00:00.000Z',
    status: 'scheduled',
    observedAt: '2026-09-05T10:00:00.000Z'
  };
}

test('two trusted Tier A providers agreeing on exact fixture and kickoff are ranking ready', () => {
  const result = evaluateFixtureVerification(entry({
    sourceObservations: [source('BONGDAWAP'), source('FLASHSCORE')],
    distinctProviderCount: 2
  }));

  assert.equal(result.status, 'MULTI_SOURCE_VERIFIED');
  assert.equal(result.rankingReady, true);
  assert.deepEqual(result.trustedProviders, ['BONGDAWAP', 'FLASHSCORE']);
});

test('one trusted provider remains discovery-only even when global source coverage is healthy', () => {
  const result = evaluateFixtureVerification(entry({
    sourceObservations: [source('FLASHSCORE')]
  }));

  assert.equal(result.status, 'SINGLE_TRUSTED_SOURCE_OBSERVED');
  assert.equal(result.rankingReady, false);
  assert.equal(result.rankingLane, 'DISCOVERY_ONLY');
  assert.equal(result.needsCrossCheck, true);
});

test('ESPN plus TheSportsDB cannot create trusted per-fixture ranking quorum', () => {
  const result = evaluateFixtureVerification(entry({
    sourceObservations: [source('ESPN', 'PUBLIC_DISCOVERY'), source('THESPORTSDB', 'PUBLIC_DISCOVERY')],
    distinctProviderCount: 2
  }));

  assert.equal(result.status, 'MULTI_SOURCE_UNTRUSTED_OBSERVED');
  assert.equal(result.rankingReady, false);
  assert.equal(result.trustedProviderCount, 0);
});

test('canonical identity plus one trusted live provider is ranking ready', () => {
  const result = evaluateFixtureVerification(entry({
    canonicalHomeId: 'TEAM_HOME_CANONICAL',
    canonicalAwayId: 'TEAM_AWAY_CANONICAL',
    sourceObservations: [
      source('LOCAL_CANONICAL', 'PC_NODE'),
      source('BONGDAWAP', 'TIER_A_BROWSER_DISCOVERY')
    ],
    distinctProviderCount: 2
  }));

  assert.equal(result.status, 'CANONICAL_PLUS_LIVE_VERIFIED');
  assert.equal(result.rankingReady, true);
  assert.equal(result.trustedLiveProviderCount, 1);
});

test('kickoff conflict always fails closed even with two trusted sources', () => {
  const result = evaluateFixtureVerification(entry({
    sourceObservations: [source('BONGDAWAP'), source('FLASHSCORE')],
    kickoffCandidates: [
      { kickoffIso: '2026-09-05T12:00:00.000Z' },
      { kickoffIso: '2026-09-05T12:15:00.000Z' }
    ],
    hasKickoffConflict: true,
    distinctProviderCount: 2
  }));

  assert.equal(result.status, 'KICKOFF_CONFLICT_FAIL_CLOSED');
  assert.equal(result.rankingReady, false);
});

test('registry and rolling annotations expose verified vs discovery-only counts', () => {
  const registry = annotateRegistryFixtureVerification({
    entries: [
      entry({
        identityKey: 'verified',
        sourceObservations: [source('BONGDAWAP'), source('FLASHSCORE')],
        distinctProviderCount: 2
      }),
      entry({
        identityKey: 'single',
        sourceObservations: [source('FLASHSCORE')]
      })
    ]
  });

  assert.equal(registry.trustedVerificationCoverage.rankingReady, 1);
  assert.equal(registry.trustedVerificationCoverage.discoveryOnly, 1);

  const rolling = annotateRollingVerification({
    fixtures: [{ identityKey: 'verified' }, { identityKey: 'single' }],
    metrics: { selected: 2 }
  }, registry);

  assert.equal(rolling.metrics.rankingReady, 1);
  assert.equal(rolling.metrics.discoveryOnly, 1);
  assert.equal(rolling.fixtures[0].rankingReady, true);
  assert.equal(rolling.fixtures[1].rankingReady, false);
  assert.equal(rolling.rankingPolicy.singleSourceCanEnterHighConfidenceRanking, false);
});
