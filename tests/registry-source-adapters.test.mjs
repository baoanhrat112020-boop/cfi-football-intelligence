import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_DISCOVERY_SOURCE_CLASS,
  WEB_SEARCH_RESCUE_SOURCE_CLASS,
  buildRegistryCoverageMatrix,
  publicDiscoveryToSupplement,
  snapshotFreshness,
  webSearchCandidatesToSupplement
} from '../src/discovery/registry-source-adapters.mjs';

test('public discovery becomes additive registry observations with provider provenance', () => {
  const observedAt = '2026-09-04T07:00:00.000Z';
  const supplement = publicDiscoveryToSupplement({
    provider: 'MULTI_SOURCE',
    providers: ['SOFASCORE', 'ESPN'],
    attempts: [
      {
        provider: 'SOFASCORE',
        url: 'https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-09-04',
        ok: true,
        rows: 1
      }
    ],
    rows: [
      {
        provider: 'SOFASCORE',
        providerId: '991',
        home: 'Alpha U20',
        away: 'Beta U20',
        competition: 'U20 League',
        country: 'Test',
        kickoffIso: '2026-09-04T08:00:00.000Z',
        targetDate: '2026-09-04',
        status: 'notstarted'
      }
    ],
    search: { foundRows: 1 }
  }, { observedAt });

  assert.equal(supplement.rows.length, 1);
  assert.equal(supplement.rows[0].sourceClass, PUBLIC_DISCOVERY_SOURCE_CLASS);
  assert.equal(supplement.rows[0].provider, 'SOFASCORE');
  assert.equal(supplement.rows[0].providerId, '991');
  assert.equal(
    supplement.rows[0].sourceUrl,
    'https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-09-04'
  );
  assert.equal(supplement.decisionUse, false);
  assert.equal(supplement.bigDbWriteAllowed, false);
});

test('web-search rescue accepts only auditable future same-day candidates', () => {
  const nowMs = Date.parse('2026-09-04T07:00:00.000Z');
  const supplement = webSearchCandidatesToSupplement([
    {
      providerId: 'official-1',
      home: 'Gamma Women U19',
      away: 'Delta Women U19',
      competition: 'Women U19',
      kickoffIso: '2026-09-04T08:00:00.000Z',
      status: 'scheduled',
      sourceUrls: ['https://example.com/fixture/official-1'],
      discoveredAt: '2026-09-04T06:59:00.000Z'
    },
    {
      providerId: 'no-proof',
      home: 'Reject',
      away: 'No Proof',
      kickoffIso: '2026-09-04T08:10:00.000Z',
      status: 'scheduled',
      sourceUrls: [],
      discoveredAt: '2026-09-04T06:59:00.000Z'
    }
  ], {
    targetDate: '2026-09-04',
    timeZone: 'Asia/Ho_Chi_Minh',
    nowMs
  });

  assert.equal(supplement.rows.length, 1);
  assert.equal(supplement.rejected.length, 1);
  assert.equal(supplement.rejected[0].reason, 'HTTPS_PROVENANCE_REQUIRED');
  assert.equal(supplement.rows[0].sourceClass, WEB_SEARCH_RESCUE_SOURCE_CLASS);
  assert.equal(supplement.rows[0].provider, 'GPT_WEB_SEARCH');
  assert.equal(supplement.rows[0].sourceUrl, 'https://example.com/fixture/official-1');
  assert.equal(supplement.policy.httpsProvenanceRequired, true);
});

test('stale and future snapshots cannot be re-ingested as current-cycle evidence', () => {
  const nowMs = Date.parse('2026-09-04T07:30:00.000Z');
  const fresh = snapshotFreshness(
    { generatedAt: '2026-09-04T07:10:00.000Z' },
    { nowMs, ttlMinutes: 30 }
  );
  const stale = snapshotFreshness(
    { generatedAt: '2026-09-04T06:50:00.000Z' },
    { nowMs, ttlMinutes: 30 }
  );
  const future = snapshotFreshness(
    { generatedAt: '2026-09-04T07:40:00.000Z' },
    { nowMs, ttlMinutes: 30 }
  );

  assert.equal(fresh.fresh, true);
  assert.equal(stale.fresh, false);
  assert.equal(stale.reason, 'SNAPSHOT_STALE');
  assert.equal(future.fresh, false);
  assert.equal(future.reason, 'FUTURE_SNAPSHOT_TIMESTAMP');
});

test('coverage matrix exposes exactly how many fixtures were rescued without PC Node', () => {
  const registry = {
    entries: [
      { sourceClasses: ['PC_NODE'] },
      { sourceClasses: ['PUBLIC_DISCOVERY'] },
      { sourceClasses: ['WEB_SEARCH_RESCUE'] },
      { sourceClasses: ['PC_NODE', 'PUBLIC_DISCOVERY'] },
      { sourceClasses: ['PUBLIC_DISCOVERY', 'WEB_SEARCH_RESCUE'] },
      { sourceClasses: ['PC_NODE', 'PUBLIC_DISCOVERY', 'WEB_SEARCH_RESCUE'] }
    ]
  };

  const matrix = buildRegistryCoverageMatrix(registry);

  assert.equal(matrix.unionFixtures, 6);
  assert.equal(matrix.pcNodeFixtures, 3);
  assert.equal(matrix.publicDiscoveryFixtures, 4);
  assert.equal(matrix.webSearchRescueFixtures, 3);
  assert.equal(matrix.pcOnly, 1);
  assert.equal(matrix.publicOnly, 1);
  assert.equal(matrix.webOnly, 1);
  assert.equal(matrix.pcAndPublic, 1);
  assert.equal(matrix.publicAndWeb, 1);
  assert.equal(matrix.allThree, 1);
  assert.equal(matrix.rescuedWithoutPcNode, 3);
  assert.equal(matrix.rescuedByPublicDiscovery, 2);
  assert.equal(matrix.rescuedByWebSearch, 2);
});
