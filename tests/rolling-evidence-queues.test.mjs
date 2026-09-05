import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingEvidenceQueues } from '../src/discovery/rolling-evidence-queues.mjs';
import { partitionWebRescueCandidates } from '../src/discovery/web-alias-gap-audit.mjs';

function fixture(identityKey, overrides = {}) {
  return {
    identityKey,
    targetDate: '2026-09-05',
    home: `${identityKey} Home`,
    away: `${identityKey} Away`,
    competition: 'Test League',
    kickoffIso: '2026-09-05T08:00:00.000Z',
    kickoffLocal: '15:00',
    minutesToKickoff: 45,
    queueStatus: 'READY_FOR_EVIDENCE_REFRESH',
    rankingReady: false,
    rankingVerificationStatus: 'SINGLE_TRUSTED_SOURCE_OBSERVED',
    trustedVerification: {
      needsCrossCheck: true,
      hasCanonicalIdentity: false,
      trustedProviders: ['FLASHSCORE'],
      trustedLiveProviders: ['FLASHSCORE']
    },
    providers: ['FLASHSCORE'],
    sourceClasses: ['TIER_A_BROWSER_DISCOVERY'],
    decisionUse: false,
    ...overrides
  };
}

test('rolling fixtures split into verified and crosscheck physical lanes without quota drops', () => {
  const queues = buildRollingEvidenceQueues({
    generatedAt: '2026-09-05T06:00:00.000Z',
    targetDate: '2026-09-05',
    timeZone: 'Asia/Ho_Chi_Minh',
    horizonMinutes: 90,
    fixtures: [
      fixture('verified', {
        rankingReady: true,
        rankingVerificationStatus: 'MULTI_SOURCE_VERIFIED',
        trustedVerification: {
          needsCrossCheck: false,
          hasCanonicalIdentity: false,
          trustedProviders: ['BONGDAWAP', 'FLASHSCORE'],
          trustedLiveProviders: ['BONGDAWAP', 'FLASHSCORE']
        }
      }),
      fixture('single')
    ]
  });

  assert.equal(queues.verifiedRankingQueue.count, 1);
  assert.equal(queues.crosscheckRequiredQueue.count, 1);
  assert.equal(queues.metrics.accountedFor, 2);
  assert.equal(queues.metrics.droppedByQuota, 0);
  assert.equal(queues.verifiedRankingQueue.rows[0].rankingInputEligible, true);
  assert.equal(queues.crosscheckRequiredQueue.rows[0].rankingInputEligible, false);
});

test('verified queue reuses existing BigDB retrieval request contract and web rescue ingest', () => {
  const queues = buildRollingEvidenceQueues({
    targetDate: '2026-09-05',
    fixtures: [fixture('verified', {
      rankingReady: true,
      rankingVerificationStatus: 'MULTI_SOURCE_VERIFIED',
      trustedVerification: {
        needsCrossCheck: false,
        trustedProviders: ['BONGDAWAP', 'FLASHSCORE'],
        trustedLiveProviders: ['BONGDAWAP', 'FLASHSCORE']
      }
    })]
  });

  const item = queues.verifiedRankingQueue.rows[0];
  assert.deepEqual(item.evidencePlan.bigDb.request.body, {
    home: 'verified Home',
    away: 'verified Away',
    target_date: '2026-09-05'
  });
  assert.equal(item.evidencePlan.bigDb.implementation, 'supabase/functions/cfi-bigdb-retrieval');
  assert.equal(item.evidencePlan.web.ingestFile, 'local-node/cache/registry/web-search-candidates.json');
  assert.equal(item.evidencePlan.web.implementation, 'local-node/registry/web-search-rescue.mjs');
  assert.equal(item.evidencePlan.routing.rankingInputEligible, true);
  assert.equal(item.evidencePlan.safety.predictionExecutionAllowed, false);
});

test('crosscheck lane requires registry reverification and web rescue only after BigDB insufficiency', () => {
  const queues = buildRollingEvidenceQueues({
    targetDate: '2026-09-05',
    fixtures: [fixture('single')]
  });

  const item = queues.crosscheckRequiredQueue.rows[0];
  assert.equal(item.evidencePlan.routing.bigDbFirst, true);
  assert.equal(item.evidencePlan.routing.webFallbackWhenBigDbInsufficient, true);
  assert.equal(item.evidencePlan.routing.webCanSupplementBigDb, false);
  assert.equal(item.evidencePlan.routing.reverifyFixtureAfterEvidence, true);
  assert.equal(item.evidencePlan.routing.autoPromoteWithinCycle, false);
  assert.equal(item.evidencePlan.routing.promotionPolicy, 'REVERIFY_NEXT_REGISTRY_CYCLE');
  assert.equal(item.evidencePlan.routing.rankingInputEligible, false);
});

test('web rescue alias change is review-only and cannot enter registry ingest', () => {
  const unresolved = [{
    identityKey: 'cancun fc|cruz a hidalgo|2026-09-05',
    home: 'Cancun FC',
    away: 'Cruz A.Hidalgo',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T01:00:00.000Z'
  }];
  const partition = partitionWebRescueCandidates([{
    rescueIdentityKey: 'cancun fc|cruz a hidalgo|2026-09-05',
    provider: 'SOCCERWAY',
    providerId: 'fixture-123',
    home: 'Cancun FC',
    away: 'Cruz Azul Hidalgo',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T01:00:00.000Z',
    sourceUrls: ['https://example.test/fixture-123']
  }], unresolved, {
    generatedAt: '2026-09-05T00:00:00.000Z'
  });

  assert.equal(partition.metrics.accepted, 0);
  assert.equal(partition.metrics.aliasReviewRequired, 1);
  assert.equal(partition.metrics.rejected, 0);
  assert.equal(partition.metrics.accountedFor, partition.inputCandidates);
  assert.equal(partition.policy.aliasCandidateCanCreateFixture, false);
  assert.equal(partition.aliasReview[0].classification, 'ALIAS_CANDIDATE_REVIEW_REQUIRED');
  assert.equal(partition.aliasReview[0].registryIngestAllowed, false);
  assert.equal(partition.aliasReview[0].autoAliasAllowed, false);
});

test('web rescue exact identity and kickoff remains eligible for existing ingest path', () => {
  const unresolved = [{
    identityKey: 'same|fixture|2026-09-05',
    home: 'Same Home',
    away: 'Same Away',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T02:00:00.000Z'
  }];
  const candidate = {
    rescueIdentityKey: 'same|fixture|2026-09-05',
    provider: 'FLASHSCORE',
    providerId: 'same-1',
    home: 'Same Home',
    away: 'Same Away',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T02:00:00.000Z',
    sourceUrls: ['https://example.test/same-1']
  };
  const partition = partitionWebRescueCandidates([candidate], unresolved);

  assert.equal(partition.metrics.accepted, 1);
  assert.equal(partition.metrics.aliasReviewRequired, 0);
  assert.equal(partition.metrics.rejected, 0);
  assert.equal(partition.metrics.accountedFor, partition.inputCandidates);
  assert.equal(partition.accepted[0], candidate);
});

test('web rescue rescue-key mismatch or kickoff mismatch fails closed', () => {
  const unresolved = [{
    identityKey: 'fixture|key|2026-09-05',
    home: 'Home',
    away: 'Away',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T03:00:00.000Z'
  }];
  const partition = partitionWebRescueCandidates([
    {
      rescueIdentityKey: 'missing|key|2026-09-05',
      home: 'Home',
      away: 'Away',
      kickoffIso: '2026-09-05T03:00:00.000Z'
    },
    {
      rescueIdentityKey: 'fixture|key|2026-09-05',
      home: 'Home',
      away: 'Away',
      kickoffIso: '2026-09-05T03:15:00.000Z'
    }
  ], unresolved);

  assert.equal(partition.metrics.accepted, 0);
  assert.equal(partition.metrics.aliasReviewRequired, 0);
  assert.equal(partition.metrics.rejected, 2);
  assert.equal(partition.metrics.accountedFor, partition.inputCandidates);
  assert.deepEqual(
    partition.rejected.map(row => row.reason).sort(),
    ['RESCUE_IDENTITY_KEY_NOT_FOUND', 'RESCUE_KICKOFF_MISMATCH'].sort()
  );
});

test('fail-closed fixture never enters either active queue', () => {
  const queues = buildRollingEvidenceQueues({
    targetDate: '2026-09-05',
    fixtures: [fixture('conflict', {
      rankingVerificationStatus: 'KICKOFF_CONFLICT_FAIL_CLOSED',
      trustedVerification: { needsCrossCheck: false }
    })]
  });

  assert.equal(queues.verifiedRankingQueue.count, 0);
  assert.equal(queues.crosscheckRequiredQueue.count, 0);
  assert.equal(queues.excluded.length, 1);
  assert.equal(queues.excluded[0].reason, 'FAIL_CLOSED_FIXTURE');
});

test('queue urgency prioritizes imminent crosschecks but never drops later fixtures', () => {
  const queues = buildRollingEvidenceQueues({
    targetDate: '2026-09-05',
    fixtures: [
      fixture('normal', { minutesToKickoff: 80 }),
      fixture('critical', { minutesToKickoff: 10 }),
      fixture('high', { minutesToKickoff: 25 })
    ]
  });

  assert.deepEqual(
    queues.crosscheckRequiredQueue.rows.map(row => row.identityKey),
    ['critical', 'high', 'normal']
  );
  assert.deepEqual(
    queues.crosscheckRequiredQueue.rows.map(row => row.urgency),
    ['CRITICAL', 'HIGH', 'NORMAL']
  );
  assert.equal(queues.metrics.droppedByQuota, 0);
});
