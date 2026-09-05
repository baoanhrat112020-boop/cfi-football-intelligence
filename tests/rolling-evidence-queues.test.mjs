import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingEvidenceQueues } from '../src/discovery/rolling-evidence-queues.mjs';

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
  assert.equal(
    item.evidencePlan.bigDb.implementation,
    'supabase/functions/cfi-bigdb-retrieval'
  );
  assert.equal(
    item.evidencePlan.web.ingestFile,
    'local-node/cache/registry/web-search-candidates.json'
  );
  assert.equal(
    item.evidencePlan.web.implementation,
    'local-node/registry/web-search-rescue.mjs'
  );
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
  assert.equal(
    item.evidencePlan.routing.promotionPolicy,
    'REVERIFY_NEXT_REGISTRY_CYCLE'
  );
  assert.equal(item.evidencePlan.routing.rankingInputEligible, false);
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
