import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORWARD_MARKET_CANONICAL_LINKER_V1,
  normalizeResearchTeamName,
  linkForwardMarketCaptureToCanonicalFixture,
  linkForwardMarketCaptureBatch,
} from '../research/forward-market-canonical-linker.mjs';

const fixture = (fixtureId, targetDate, homeTeam, awayTeam, extra = {}) => ({
  fixtureId,
  targetDate,
  homeTeam,
  awayTeam,
  ...extra,
});

const capture = (externalFixtureKey, targetDate, homeTeam, awayTeam) => ({
  externalFixtureKey,
  targetDate,
  homeTeam,
  awayTeam,
});

test('research linker is immutable, non-fuzzy and normalizes Unicode deterministically', () => {
  assert.equal(FORWARD_MARKET_CANONICAL_LINKER_V1.researchOnly, true);
  assert.equal(FORWARD_MARKET_CANONICAL_LINKER_V1.productionMutationAllowed, false);
  assert.equal(FORWARD_MARKET_CANONICAL_LINKER_V1.canonicalWriteAllowed, false);
  assert.equal(FORWARD_MARKET_CANONICAL_LINKER_V1.fuzzyMatchingAllowed, false);
  assert.equal(FORWARD_MARKET_CANONICAL_LINKER_V1.crossDateMatchingAllowed, false);
  assert.equal(normalizeResearchTeamName('Malmö FF'), 'malmo ff');
  assert.equal(normalizeResearchTeamName('Djurgården'), 'djurgarden');
  assert.equal(normalizeResearchTeamName("O'Higgins"), 'o higgins');
});

test('links conservative club-affix variants only on one same-date pair', () => {
  const fixtures = [
    fixture('roma-1', '2026-08-24', 'Roma', 'Fiorentina', { competitionKey: 'italy:i1' }),
    fixture('osasuna-1', '2026-08-24', 'Osasuna', 'Levante', { competitionKey: 'spain:sp1' }),
    fixture('reims-1', '2026-08-24', 'Reims', 'Annecy', { competitionKey: 'france:f2' }),
  ];

  const roma = linkForwardMarketCaptureToCanonicalFixture(capture('roma', '2026-08-24', 'AS Roma', 'Fiorentina'), fixtures);
  assert.equal(roma.status, 'VERIFIED_RESEARCH_LINK');
  assert.equal(roma.fixture.fixtureId, 'roma-1');
  assert.match(roma.matchMethod, /CONSERVATIVE_AFFIX_NORMALIZED/);
  assert.equal(roma.provenance.fuzzyMatchingUsed, false);
  assert.equal(roma.provenance.canonicalWritePerformed, false);

  const osasuna = linkForwardMarketCaptureToCanonicalFixture(capture('osasuna', '2026-08-24', 'Osasuna', 'Levante UD'), fixtures);
  assert.equal(osasuna.status, 'VERIFIED_RESEARCH_LINK');
  assert.equal(osasuna.fixture.fixtureId, 'osasuna-1');

  const reims = linkForwardMarketCaptureToCanonicalFixture(capture('reims', '2026-08-24', 'Stade de Reims', 'FC Annecy'), fixtures);
  assert.equal(reims.status, 'VERIFIED_RESEARCH_LINK');
  assert.equal(reims.fixture.fixtureId, 'reims-1');
});

test('accent normalization can identify a pair but never crosses target date', () => {
  const fixtures = [
    fixture('malmo-next-day', '2026-08-25', 'Malmö FF', 'Djurgården'),
  ];
  const wrongDate = linkForwardMarketCaptureToCanonicalFixture(
    capture('malmo', '2026-08-24', 'Malmo FF', 'Djurgardens IF'),
    fixtures,
  );
  assert.equal(wrongDate.status, 'BLOCKED');
  assert.equal(wrongDate.reason, 'NO_UNIQUE_SAME_DATE_CANONICAL_MATCH');
  assert.equal(wrongDate.sameDateFixtureCount, 0);
});

test('accent-normalized exact pair links when date is actually the same', () => {
  const fixtures = [fixture('malmo-same-day', '2026-08-24', 'Malmö FF', 'Djurgården')];
  const linked = linkForwardMarketCaptureToCanonicalFixture(
    capture('malmo', '2026-08-24', 'Malmo FF', 'Djurgarden'),
    fixtures,
  );
  assert.equal(linked.status, 'VERIFIED_RESEARCH_LINK');
  assert.equal(linked.fixture.fixtureId, 'malmo-same-day');
  assert.equal(linked.matchMethod, 'EXACT_NORMALIZED');
});

test('ambiguous same-date candidates fail closed instead of choosing first', () => {
  const fixtures = [
    fixture('dup-a', '2026-08-24', 'Roma', 'Fiorentina'),
    fixture('dup-b', '2026-08-24', 'Roma', 'Fiorentina'),
  ];
  const linked = linkForwardMarketCaptureToCanonicalFixture(capture('roma', '2026-08-24', 'Roma', 'Fiorentina'), fixtures);
  assert.equal(linked.status, 'BLOCKED');
  assert.equal(linked.reason, 'AMBIGUOUS_CANONICAL_MATCH');
  assert.equal(linked.bestCandidateCount, 2);
  assert.equal(linked.fixture, null);
});

test('high-confidence exact alias can link through canonical team IDs without fuzzy matching', () => {
  const fixtures = [fixture('alias-1', '2026-08-24', 'Manchester United', 'Chelsea', {
    homeTeamId: 'team-mu',
    awayTeamId: 'team-chelsea',
  })];
  const aliases = [
    { aliasDisplay: 'Man Utd', teamId: 'team-mu', confidence: 1 },
    { aliasDisplay: 'Chelsea FC', teamId: 'team-chelsea', confidence: 1 },
  ];
  const linked = linkForwardMarketCaptureToCanonicalFixture(
    capture('alias', '2026-08-24', 'Man Utd', 'Chelsea FC'),
    fixtures,
    { aliases },
  );
  assert.equal(linked.status, 'VERIFIED_RESEARCH_LINK');
  assert.equal(linked.fixture.fixtureId, 'alias-1');
  assert.match(linked.matchMethod, /EXACT_ALIAS_TEAM_ID/);
  assert.equal(linked.provenance.fuzzyMatchingUsed, false);
});

test('batch result keeps all blockers visible and never converts blocked rows into writes', () => {
  const fixtures = [fixture('roma-1', '2026-08-24', 'Roma', 'Fiorentina')];
  const result = linkForwardMarketCaptureBatch([
    capture('ok', '2026-08-24', 'AS Roma', 'Fiorentina'),
    capture('wrong-date', '2026-08-25', 'AS Roma', 'Fiorentina'),
    capture('missing-date', '', 'AS Roma', 'Fiorentina'),
  ], fixtures);
  assert.equal(result.total, 3);
  assert.equal(result.verified, 1);
  assert.equal(result.blocked, 2);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.canonicalWriteAllowed, false);
  assert.equal(result.reasons.NO_UNIQUE_SAME_DATE_CANONICAL_MATCH, 1);
  assert.equal(result.reasons.TARGET_DATE_REQUIRED, 1);
});
