import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialFixtureAliasReview } from '../src/discovery/official-fixture-alias-review.mjs';

const targetDate = '2026-09-05';
const timeZone = 'Asia/Ho_Chi_Minh';
const kickoffIso = '2026-09-05T10:00:00.000Z';

function hint(home, away, displayedTime = '17:00') {
  return {
    provider: 'BONGDAWAP',
    source_id: 'daily-bongdawap',
    source_url: 'https://bongdawap.com/lich-thi-dau-bong-da.html',
    home_team: home,
    away_team: away,
    displayed_time: displayedTime,
    source_page_date_claim: targetDate,
    reason: 'DATE_CONTEXT_UNVERIFIED',
    can_enter_registry: false,
    can_enter_ranking: false
  };
}

function official(providerId, home, away, kickoff = kickoffIso) {
  return {
    providerId,
    home,
    away,
    kickoffIso: kickoff,
    targetDate,
    sourceUrl: `https://www.kwff.or.kr/matches/${providerId.split(':').at(-1)}`,
    sourceTier: 'X',
    sourceKey: 'UNKNOWN'
  };
}

test('WK League localized identities become review-only proposals, never aliases or registry rows', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Suwon Nữ', 'Red Angels Nữ'),
    hint('Gangjin Swans Nữ', 'Gyeongju Nữ'),
    hint('Sejong Sportstoto Nữ', 'Seoul WFC Nữ'),
    hint('Mung. Sangmu Nữ', 'Hwacheon KSPO Nữ')
  ], [
    official('KWFF:208', 'Suwon FC Women', 'Incheon Hyundai Steel Red Angels Womens Football Club'),
    official('KWFF:209', 'GANGJIN SWANS WFC', 'KHNP Football Club Womens'),
    official('KWFF:210', 'Sejong Sportstoto WFC', 'Seoul City Amazones womens football club'),
    official('KWFF:211', 'Sangmu womens football club', 'Hwacheon KSPO WFC')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.hints, 4);
  assert.equal(review.metrics.proposals, 4);
  assert.equal(review.metrics.ambiguous, 0);
  assert.equal(review.metrics.rejected, 0);
  assert.deepEqual(
    review.proposals.map(row => row.officialFixture.providerId),
    ['KWFF:208', 'KWFF:209', 'KWFF:210', 'KWFF:211']
  );
  for (const proposal of review.proposals) {
    assert.equal(proposal.classification, 'ALIAS_CANDIDATE_REVIEW_REQUIRED');
    assert.equal(proposal.reviewEvidence.reviewOnlyHeuristic, true);
    assert.equal(proposal.reviewEvidence.fuzzyIdentityResolutionPerformed, false);
    assert.equal(proposal.autoAliasAllowed, false);
    assert.equal(proposal.canonicalTeamCreateAllowed, false);
    assert.equal(proposal.registryIngestAllowed, false);
    assert.equal(proposal.rankingInputEligible, false);
    assert.equal(proposal.predictionExecutionAllowed, false);
    assert.equal(proposal.bigDbWriteAllowed, false);
    assert.equal(proposal.decisionUse, false);
  }
});

test('wrong displayed time cannot produce an alias-review proposal', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Suwon Nữ', 'Red Angels Nữ', '16:30')
  ], [
    official('KWFF:208', 'Suwon FC Women', 'Incheon Hyundai Steel Red Angels Womens Football Club')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.rejected[0].reason, 'NO_OFFICIAL_FIXTURE_SAME_DATE_TIME');
});

test('reversed home-away evidence is blocked instead of proposed', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Hwacheon KSPO Nữ', 'Mung. Sangmu Nữ')
  ], [
    official('KWFF:211', 'Sangmu womens football club', 'Hwacheon KSPO WFC')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.rejected[0].reason, 'REVERSED_ORIENTATION_BLOCKED');
});

test('equal-strength multiple official candidates fail closed as ambiguous', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Gangjin Swans Nữ', 'Unknown Nữ')
  ], [
    official('KWFF:301', 'Gangjin Swans WFC', 'Alpha Women'),
    official('KWFF:302', 'Gangjin Swans Women', 'Beta Women')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.metrics.ambiguous, 1);
  assert.equal(review.ambiguous[0].reason, 'AMBIGUOUS_OFFICIAL_ALIAS_REVIEW_CANDIDATE');
  assert.equal(review.ambiguous[0].autoAliasAllowed, false);
});

test('non-women entity scope is rejected even with lexical overlap', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Suwon FC', 'Red Angels')
  ], [
    official('KWFF:208', 'Suwon FC Women', 'Incheon Hyundai Steel Red Angels Womens Football Club')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.rejected[0].reason, 'WOMEN_ENTITY_SCOPE_REQUIRED');
});

test('near-spelling similarity without shared lexical anchors is not used', () => {
  const review = buildOfficialFixtureAliasReview([
    hint('Suwonn Nữ', 'Angell Nữ')
  ], [
    official('KWFF:208', 'Suwon FC Women', 'Red Angels Women')
  ], { targetDate, timeZone, officialProvider: 'KWFF' });

  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.rejected[0].reason, 'NO_UNIQUE_LEXICAL_REVIEW_ANCHOR');
  assert.equal(review.policy.fuzzyIdentityResolutionAllowed, false);
});
