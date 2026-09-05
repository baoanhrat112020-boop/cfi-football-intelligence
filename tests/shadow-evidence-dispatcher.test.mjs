import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShadowEvidenceDispatch,
  classifyBigDbReceipt,
  resolveBigDbRetrievalUrl
} from '../src/discovery/shadow-evidence-dispatcher.mjs';

function request(id = 'fixture-1', overrides = {}) {
  return {
    requestId: `CROSSCHECK_REQUIRED_QUEUE:${id}`,
    lane: 'CROSSCHECK_REQUIRED_QUEUE',
    identityKey: `${id}|away|2026-09-05`,
    targetDate: '2026-09-05',
    home: `${id} Home`,
    away: `${id} Away`,
    kickoffIso: '2026-09-05T08:00:00.000Z',
    trustedProviders: ['FLASHSCORE'],
    trustedLiveProviders: ['FLASHSCORE'],
    bigDb: {
      request: {
        method: 'POST',
        body: {
          home: `${id} Home`,
          away: `${id} Away`,
          target_date: '2026-09-05'
        }
      }
    },
    web: {
      implementation: 'local-node/registry/web-search-rescue.mjs',
      ingestFile: 'local-node/cache/registry/web-search-candidates.json',
      trustedSourcePriority: ['AISCORE', 'BONGDAWAP', 'SOFASCORE', 'FLASHSCORE'],
      queries: [`${id} Home vs ${id} Away 2026-09-05 kickoff fixture`]
    },
    routing: {
      rankingInputEligible: false,
      webCanSupplementBigDb: true,
      autoPromoteWithinCycle: false
    },
    ...overrides
  };
}

function readyBigDb(homeId = 'H1', awayId = 'A1') {
  return {
    httpStatus: 200,
    body: {
      status: 'OK',
      version: 'CFI_BIG_DB_RETRIEVAL_TEST',
      identity: {
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeCanonical: 'Canonical Home',
        awayCanonical: 'Canonical Away',
        homeResolution: 'CANONICAL_FOLDED_EXACT',
        awayResolution: 'CANONICAL_FOLDED_EXACT'
      },
      exactTeam: {
        home: { retrieved: 7 },
        away: { retrieved: 8 },
        h2h: { retrieved: 2 }
      },
      temporalAudit: { verified: true, targetDate: '2026-09-05' }
    }
  };
}

test('BigDB endpoint resolution reuses CFI_DB_BASE_URL cfi-db convention and fails closed otherwise', () => {
  assert.deepEqual(
    resolveBigDbRetrievalUrl('https://example.test/functions/v1/cfi-db'),
    {
      ok: true,
      reason: null,
      url: 'https://example.test/functions/v1/cfi-bigdb-retrieval'
    }
  );
  assert.equal(
    resolveBigDbRetrievalUrl('https://example.test/unknown').reason,
    'CFI_DB_BASE_URL_UNSUPPORTED'
  );
});

test('BigDB receipt classification matches existing evidence-preflight readiness contract', () => {
  const found = classifyBigDbReceipt(readyBigDb());
  assert.equal(found.status, 'FOUND');
  assert.equal(found.reason, 'EVIDENCE_READY');
  assert.equal(found.ready, true);
  assert.equal(found.exactTeam.homeRetrieved, 7);
  assert.equal(found.temporalAudit.verified, true);

  const missingIdentity = classifyBigDbReceipt({
    httpStatus: 200,
    body: {
      status: 'OK',
      identity: { homeTeamId: null, awayTeamId: null },
      exactTeam: { home: { retrieved: 0 }, away: { retrieved: 0 } },
      temporalAudit: { verified: true }
    }
  });
  assert.equal(missingIdentity.status, 'INSUFFICIENT');
  assert.equal(missingIdentity.reason, 'NO_EXACT_IDENTITY');
});

test('default shadow mode emits one receipt per request with zero network implication and no quota drop', () => {
  const plan = { requests: [request('a'), request('b')] };
  const dispatch = buildShadowEvidenceDispatch(plan, new Map(), {
    liveReadEnabled: false,
    generatedAt: '2026-09-05T00:00:00.000Z',
    sourceCycleId: 'cycle-a'
  });

  assert.equal(dispatch.metrics.requests, 2);
  assert.equal(dispatch.metrics.receipts, 2);
  assert.equal(dispatch.metrics.bigDbNotDispatched, 2);
  assert.equal(dispatch.metrics.droppedByQuota, 0);
  assert.equal(dispatch.metrics.autoPromoted, 0);
  assert.equal(dispatch.webCrosscheckPlan.count, 2);
  assert.equal(dispatch.nextCycleReverification.count, 0);
  assert.ok(dispatch.receipts.every(row => row.rankingReady === false));
  assert.ok(dispatch.receipts.every(row => row.predictionExecutionAllowed === false));
  assert.ok(dispatch.receipts.every(row => row.bigDbWriteAllowed === false));
});

test('BigDB exact canonical identity makes single trusted live fixture eligible only for NEXT cycle reverification', () => {
  const req = request('single-live');
  const results = new Map([[req.requestId, readyBigDb('HOME-ID', 'AWAY-ID')]]);
  const dispatch = buildShadowEvidenceDispatch({ requests: [req] }, results, {
    liveReadEnabled: true,
    generatedAt: '2026-09-05T00:01:00.000Z',
    sourceCycleId: 'cycle-1'
  });

  const receipt = dispatch.receipts[0];
  assert.equal(receipt.bigDb.status, 'FOUND');
  assert.equal(receipt.eligibleForNextCycleReverification, true);
  assert.equal(receipt.autoPromoted, false);
  assert.equal(receipt.rankingReady, false);
  assert.equal(dispatch.nextCycleReverification.count, 1);
  assert.equal(dispatch.nextCycleReverification.rows[0].canonicalHomeId, 'HOME-ID');
  assert.equal(dispatch.nextCycleReverification.rows[0].canonicalAwayId, 'AWAY-ID');
  assert.equal(dispatch.nextCycleReverification.rows[0].sourceCycleId, 'cycle-1');
  assert.equal(
    dispatch.nextCycleReverification.policy.sameCycleAutoPromotionAllowed,
    false
  );
});

test('BigDB FOUND suppresses web rescue when no explicit supplement is requested', () => {
  const req = request('found-no-web', {
    routing: {
      rankingInputEligible: false,
      webCanSupplementBigDb: false,
      autoPromoteWithinCycle: false
    }
  });
  const results = new Map([[req.requestId, readyBigDb('HOME-ID', 'AWAY-ID')]]);
  const dispatch = buildShadowEvidenceDispatch({ requests: [req] }, results, {
    liveReadEnabled: true,
    generatedAt: '2026-09-05T00:01:00.000Z',
    sourceCycleId: 'cycle-1'
  });

  assert.equal(dispatch.receipts[0].bigDb.status, 'FOUND');
  assert.equal(dispatch.webCrosscheckPlan.rows[0].shouldRequest, false);
  assert.equal(dispatch.metrics.webCrosschecksRequested, 0);
  assert.equal(dispatch.nextCycleReverification.count, 1);
});

test('canonical identity alone cannot create reverification candidate when no trusted live provider was observed', () => {
  const req = request('no-live', { trustedLiveProviders: [] });
  const results = new Map([[req.requestId, readyBigDb()]]);
  const dispatch = buildShadowEvidenceDispatch({ requests: [req] }, results, {
    liveReadEnabled: true
  });

  assert.equal(dispatch.receipts[0].eligibleForNextCycleReverification, false);
  assert.equal(dispatch.nextCycleReverification.count, 0);
  assert.equal(dispatch.receipts[0].rankingReady, false);
});

test('BigDB errors never drop fixture and keep trusted web crosscheck pending', () => {
  const req = request('error');
  const results = new Map([[
    req.requestId,
    { httpStatus: null, body: null, error: 'network down' }
  ]]);
  const dispatch = buildShadowEvidenceDispatch({ requests: [req] }, results, {
    liveReadEnabled: true
  });

  assert.equal(dispatch.metrics.bigDbErrors, 1);
  assert.equal(dispatch.metrics.receipts, 1);
  assert.equal(dispatch.metrics.droppedByQuota, 0);
  assert.equal(dispatch.webCrosscheckPlan.rows[0].shouldRequest, true);
  assert.equal(
    dispatch.webCrosscheckPlan.rows[0].existingIngestImplementation,
    'local-node/registry/web-search-rescue.mjs'
  );
  assert.equal(
    dispatch.webCrosscheckPlan.rows[0].candidateRequirements.explicitKickoffRequiredForFixtureVerification,
    true
  );
});

test('401 is classified separately and never leaks into ranking', () => {
  const req = request('unauthorized');
  const results = new Map([[
    req.requestId,
    { httpStatus: 401, body: { error: 'UNAUTHORIZED' }, error: null }
  ]]);
  const dispatch = buildShadowEvidenceDispatch({ requests: [req] }, results, {
    liveReadEnabled: true
  });

  assert.equal(dispatch.metrics.bigDbUnauthorized, 1);
  assert.equal(dispatch.receipts[0].rankingReady, false);
  assert.equal(dispatch.receipts[0].decisionUse, false);
});
