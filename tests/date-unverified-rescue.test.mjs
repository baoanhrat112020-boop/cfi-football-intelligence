import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addIsoDays,
  buildDateUnverifiedWebPlan,
  DATE_UNVERIFIED_WEB_PLAN_CONTRACT
} from '../src/discovery/date-unverified-rescue.mjs';

test('date-unverified rescue dedupes hints and searches adjacent dates without inventing kickoff', () => {
  const rows = [
    {
      provider: 'BONGDAWAP',
      source_id: 'daily-bongdawap',
      source_url: 'https://bongdawap.com/lich-thi-dau-bong-da.html',
      home_team: 'Junior Barranquilla',
      away_team: 'Jag de Cordoba',
      displayed_time: '08:20',
      source_page_date_claim: '2026-09-05',
      render_timezone: 'Asia/Ho_Chi_Minh'
    },
    {
      provider: 'BONGDAWAP',
      home_team: 'Junior Barranquilla',
      away_team: 'Jag de Cordoba',
      displayed_time: '08:20'
    }
  ];

  const plan = buildDateUnverifiedWebPlan(rows, {
    generatedAt: '2026-09-05T01:00:00.000Z',
    targetDate: '2026-09-05',
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  assert.equal(plan.contract, DATE_UNVERIFIED_WEB_PLAN_CONTRACT);
  assert.equal(plan.count, 1);
  assert.deepEqual(plan.rows[0].candidateDates, [
    '2026-09-04',
    '2026-09-05',
    '2026-09-06'
  ]);
  assert.equal(plan.rows[0].kickoffIso, null);
  assert.equal(plan.rows[0].canEnterRegistry, false);
  assert.equal(plan.rows[0].canEnterRanking, false);
  assert.equal(plan.rows[0].autoCorrectKickoffAllowed, false);
  assert.equal(plan.rows[0].predictionExecutionAllowed, false);
  assert.equal(plan.rows[0].decisionUse, false);
  assert.equal(plan.rows[0].bigDbWriteAllowed, false);
  assert.equal(plan.rows[0].requiredEvidence.sourcePageDateClaimCannotVerifyKickoff, true);
  assert.equal(plan.policy.sourcePageDateClaimTrustedAsKickoffDate, false);
  assert.equal(plan.policy.canEnterRegistryBeforeVerification, false);
  assert.equal(plan.policy.canEnterRankingBeforeVerification, false);
  assert.ok(plan.rows[0].queries.some(query =>
    query.includes('Junior Barranquilla vs Jag de Cordoba') &&
    query.includes('2026-09-06')
  ));
});

test('date helper safely crosses month and year boundaries', () => {
  assert.equal(addIsoDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addIsoDays('2026-01-01', -1), '2025-12-31');
});

test('invalid target date fails closed', () => {
  assert.throws(
    () => buildDateUnverifiedWebPlan([], { targetDate: '05/09/2026' }),
    /TARGET_DATE_REQUIRED/
  );
});
