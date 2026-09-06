import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialFixtureAliasReview } from '../src/discovery/official-fixture-alias-review.mjs';

test('one official fixture cannot back multiple localized alias proposals', () => {
  const targetDate = '2026-09-05';
  const base = {
    provider: 'BONGDAWAP',
    source_id: 'daily-bongdawap',
    source_url: 'https://bongdawap.com/lich-thi-dau-bong-da.html',
    displayed_time: '17:00',
    source_page_date_claim: targetDate
  };
  const review = buildOfficialFixtureAliasReview([
    { ...base, home_team: 'Gangjin Swans Nữ', away_team: 'Gyeongju Nữ' },
    { ...base, home_team: 'Gangjin Swans WFC Nữ', away_team: 'Unknown Nữ' }
  ], [{
    providerId: 'KWFF:209',
    home: 'GANGJIN SWANS WFC',
    away: 'KHNP Football Club Womens',
    kickoffIso: '2026-09-05T10:00:00.000Z',
    sourceUrl: 'https://www.kwff.or.kr/matches/209'
  }], {
    targetDate,
    timeZone: 'Asia/Ho_Chi_Minh',
    officialProvider: 'KWFF'
  });

  assert.equal(review.metrics.hints, 2);
  assert.equal(review.metrics.proposals, 0);
  assert.equal(review.metrics.ambiguous, 2);
  assert.equal(review.metrics.accountedFor, 2);
  assert.ok(review.ambiguous.every(row => row.reason === 'OFFICIAL_FIXTURE_REUSED_BY_MULTIPLE_HINTS'));
  assert.ok(review.ambiguous.every(row => row.autoAliasAllowed === false));
  assert.equal(review.policy.officialFixtureMayBackMultipleHints, false);
});
