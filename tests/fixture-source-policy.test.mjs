import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFixtureSourceScanPlan,
  evaluateFixtureSourceCoverage,
  resolveFixtureSource
} from '../src/discovery/fixture-source-policy.mjs';

test('primary scan order starts with AiScore, BongdaWap, Sofascore and Flashscore', () => {
  const plan = buildFixtureSourceScanPlan();
  assert.deepEqual(
    plan.filter(source => source.tier === 'A').map(source => source.key),
    ['AISCORE', 'BONGDAWAP', 'SOFASCORE', 'FLASHSCORE']
  );
});

test('large secondary sources are retained ahead of fallback providers', () => {
  const plan = buildFixtureSourceScanPlan();
  const index = key => plan.findIndex(source => source.key === key);

  for (const key of ['SOCCERWAY', 'FOTMOB', 'LIVESCORE', '365SCORES']) {
    assert.ok(index(key) >= 0);
    assert.ok(index(key) < index('THESPORTSDB'));
    assert.ok(index(key) < index('ESPN'));
  }
});

test('ESPN is last-resort and cannot satisfy ranking coverage readiness', () => {
  const source = resolveFixtureSource({
    provider: 'ESPN',
    sourceUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
  });

  assert.equal(source.tier, 'D');
  assert.equal(source.priority, 5);
  assert.equal(source.primaryCoverage, false);

  const health = evaluateFixtureSourceCoverage([
    { provider: 'ESPN', sourceUrl: 'https://site.api.espn.com/a' },
    { provider: 'THESPORTSDB', sourceUrl: 'https://www.thesportsdb.com/b' }
  ]);

  assert.equal(health.status, 'FALLBACK_ONLY');
  assert.equal(health.coverageReadyForRanking, false);
  assert.equal(health.globalRecallClaimAllowed, false);
});

test('AiScore URL is recognized even when provider is GPT web search', () => {
  const source = resolveFixtureSource({
    provider: 'GPT_WEB_SEARCH',
    sourceUrls: ['https://www.aiscore.com/match/example']
  });

  assert.equal(source.key, 'AISCORE');
  assert.equal(source.tier, 'A');
});

test('ranking readiness requires primary plus another trusted source', () => {
  const onePrimary = evaluateFixtureSourceCoverage([
    { provider: 'SOFASCORE', sourceUrl: 'https://www.sofascore.com/a' }
  ]);
  assert.equal(onePrimary.status, 'PRIMARY_SINGLE_SOURCE');
  assert.equal(onePrimary.coverageReadyForRanking, false);

  const primaryPlusSecondary = evaluateFixtureSourceCoverage([
    { provider: 'SOFASCORE', sourceUrl: 'https://www.sofascore.com/a' },
    { provider: 'SOCCERWAY', sourceUrl: 'https://www.soccerway.com/b' }
  ]);
  assert.equal(primaryPlusSecondary.status, 'PRIMARY_PLUS_SECONDARY');
  assert.equal(primaryPlusSecondary.coverageReadyForRanking, true);
}
);
