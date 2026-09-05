import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addIsoDays,
  buildDateUnverifiedWebPlan,
  DATE_UNVERIFIED_RESOLUTION_CONTRACT,
  DATE_UNVERIFIED_WEB_PLAN_CONTRACT,
  resolveDateUnverifiedHints
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

test('exact identity plus same displayed time from independent trusted provider recovers kickoff without self-promoting', () => {
  const resolution = resolveDateUnverifiedHints([
    {
      provider: 'BONGDAWAP',
      source_id: 'daily-bongdawap',
      source_url: 'https://bongdawap.com/lich-thi-dau-bong-da.html',
      home_team: 'Newcastle',
      away_team: 'Bournemouth',
      displayed_time: '18:30',
      render_timezone: 'Asia/Ho_Chi_Minh'
    }
  ], [
    {
      provider: 'FLASHSCORE',
      sourceUrl: 'https://www.flashscore.com/football/',
      home: 'Newcastle',
      away: 'Bournemouth',
      kickoffIso: '2026-09-05T11:30:00.000Z',
      parserEvidence: { time_line: '18:30' },
      competition: 'England',
      country: 'England'
    }
  ], {
    generatedAt: '2026-09-05T01:00:00.000Z',
    targetDate: '2026-09-05',
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  assert.equal(resolution.contract, DATE_UNVERIFIED_RESOLUTION_CONTRACT);
  assert.deepEqual(resolution.metrics, {
    hints: 1,
    recovered: 1,
    unresolved: 0,
    conflicts: 0,
    resolvedOutsideTargetDate: 0,
    webRequired: 0
  });
  const recovered = resolution.recoveredRows[0];
  assert.equal(recovered.provider, 'BONGDAWAP');
  assert.equal(recovered.kickoffIso, '2026-09-05T11:30:00.000Z');
  assert.equal(recovered.dateRecoveryVerified, true);
  assert.equal(recovered.rankingReady, false);
  assert.equal(recovered.predictionExecutionAllowed, false);
  assert.equal(recovered.decisionUse, false);
  assert.equal(recovered.bigDbWriteAllowed, false);
  assert.equal(recovered.parserEvidence.fuzzy_identity_used, false);
  assert.equal(recovered.parserEvidence.automatic_kickoff_correction_used, false);
  assert.deepEqual(recovered.parserEvidence.independent_providers, ['FLASHSCORE']);
});

test('exact identity with different displayed time fails closed and remains web-required', () => {
  const resolution = resolveDateUnverifiedHints([
    {
      provider: 'BONGDAWAP',
      home_team: 'Okzhetpes',
      away_team: 'Ordabasy',
      displayed_time: '17:00',
      render_timezone: 'Asia/Ho_Chi_Minh'
    }
  ], [
    {
      provider: 'FLASHSCORE',
      home: 'Okzhetpes',
      away: 'Ordabasy',
      kickoffIso: '2026-09-05T11:00:00.000Z',
      parserEvidence: { time_line: '18:00' }
    }
  ], {
    targetDate: '2026-09-05',
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  assert.equal(resolution.metrics.recovered, 0);
  assert.equal(resolution.metrics.conflicts, 1);
  assert.equal(resolution.metrics.webRequired, 1);
  assert.equal(resolution.conflictHints[0].resolutionStatus, 'KICKOFF_TIME_CONFLICT_FAIL_CLOSED');
  assert.equal(resolution.conflictHints[0].canEnterRegistry, false);
  assert.equal(resolution.conflictHints[0].canEnterRanking, false);
});

test('independent exact match on adjacent local date is resolved but cannot enter current-day registry', () => {
  const resolution = resolveDateUnverifiedHints([
    {
      provider: 'BONGDAWAP',
      home_team: 'Junior Barranquilla',
      away_team: 'Jag de Cordoba',
      displayed_time: '08:20',
      render_timezone: 'Asia/Ho_Chi_Minh'
    }
  ], [
    {
      provider: 'FLASHSCORE',
      home: 'Junior Barranquilla',
      away: 'Jag de Cordoba',
      kickoffIso: '2026-09-06T01:20:00.000Z',
      parserEvidence: { time_line: '08:20' }
    }
  ], {
    targetDate: '2026-09-05',
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  assert.equal(resolution.metrics.recovered, 0);
  assert.equal(resolution.metrics.resolvedOutsideTargetDate, 1);
  assert.equal(resolution.metrics.webRequired, 0);
  assert.equal(resolution.resolvedOutsideTargetDate[0].resolvedLocalDate, '2026-09-06');
  assert.equal(resolution.resolvedOutsideTargetDate[0].canEnterCurrentRegistry, false);
  assert.equal(resolution.resolvedOutsideTargetDate[0].canEnterRanking, false);
});

test('cross-source date recovery does not fuzzy-match decorated or aliased team names', () => {
  const resolution = resolveDateUnverifiedHints([
    {
      provider: 'BONGDAWAP',
      home_team: 'Atlas W',
      away_team: 'Guadalajara Chivas W',
      displayed_time: '09:06'
    }
  ], [
    {
      provider: 'FLASHSCORE',
      home: 'Atlas Women',
      away: 'Chivas Guadalajara Women',
      kickoffIso: '2026-09-05T02:06:00.000Z',
      parserEvidence: { time_line: '09:06' }
    }
  ], {
    targetDate: '2026-09-05'
  });

  assert.equal(resolution.metrics.recovered, 0);
  assert.equal(resolution.metrics.unresolved, 1);
  assert.equal(resolution.unresolvedHints[0].resolutionStatus, 'NO_EXACT_INDEPENDENT_MATCH');
  assert.equal(resolution.policy.fuzzyIdentityAllowed, false);
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
  assert.throws(
    () => resolveDateUnverifiedHints([], [], { targetDate: '05/09/2026' }),
    /TARGET_DATE_REQUIRED/
  );
});
