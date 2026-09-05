import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_CONTEXT_POLICIES,
  parseDailyFixtureText
} from '../local-node/browser/fixture-collector/daily-text-parser.mjs';

const source = {
  id: 'daily-bongdawap',
  provider: 'bongdawap',
  url: 'https://example.test/bongdawap',
  competition: 'ALL FOOTBALL',
  country: 'GLOBAL',
  render_timezone: 'UTC'
};

test('strict multi-day policy rejects time-only fixture instead of assigning run targetDate', () => {
  const parsed = parseDailyFixtureText(
    source,
    '01:20 Junior Barranquilla vs Jag de Cordoba',
    {
      targetDate: '2026-09-05',
      referenceDate: '2026-09-05',
      timeZone: 'UTC',
      dateContextPolicy: DATE_CONTEXT_POLICIES.EXPLICIT_TEXT_DATE_REQUIRED
    }
  );

  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.telemetry.missingDateAnchorRejected, 1);
  assert.equal(parsed.telemetry.dateContextPolicy, 'EXPLICIT_TEXT_DATE_REQUIRED');
  assert.equal(parsed.rejected[0].reason, 'MISSING_EXPLICIT_DATE_ANCHOR');
  assert.equal(parsed.rejected[0].home, 'Junior Barranquilla');
  assert.equal(parsed.rejected[0].away, 'Jag de Cordoba');
});

test('explicit date anchor preserves the actual next-day date and never shifts it to prior target date', () => {
  const nextDay = parseDailyFixtureText(
    source,
    '06/09/2026\n01:20 Junior Barranquilla vs Jag de Cordoba',
    {
      targetDate: '2026-09-06',
      referenceDate: '2026-09-05',
      timeZone: 'UTC',
      dateContextPolicy: DATE_CONTEXT_POLICIES.EXPLICIT_TEXT_DATE_REQUIRED
    }
  );

  assert.equal(nextDay.candidates.length, 1);
  assert.equal(nextDay.candidates[0].kickoff_utc, '2026-09-06T01:20:00.000Z');
  assert.equal(nextDay.candidates[0].parser_evidence.date_basis, 'DATE_SECTION');
  assert.equal(nextDay.candidates[0].parser_evidence.active_date, '2026-09-06');
  assert.equal(nextDay.candidates[0].parser_evidence.requested_target_date, '2026-09-06');

  const priorDayRun = parseDailyFixtureText(
    source,
    '06/09/2026\n01:20 Junior Barranquilla vs Jag de Cordoba',
    {
      targetDate: '2026-09-05',
      referenceDate: '2026-09-05',
      timeZone: 'UTC',
      dateContextPolicy: DATE_CONTEXT_POLICIES.EXPLICIT_TEXT_DATE_REQUIRED
    }
  );

  assert.equal(priorDayRun.candidates.length, 0);
  assert.equal(
    priorDayRun.candidates.some(row => row.kickoff_utc === '2026-09-05T01:20:00.000Z'),
    false
  );
});

test('default date-scoped policy remains backward-compatible for sources whose snapshot is already target-day scoped', () => {
  const parsed = parseDailyFixtureText(
    { ...source, id: 'daily-date-scoped' },
    '08:30 Home FC vs Away FC',
    {
      targetDate: '2026-09-05',
      referenceDate: '2026-09-05',
      timeZone: 'UTC'
    }
  );

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].kickoff_utc, '2026-09-05T08:30:00.000Z');
  assert.equal(parsed.candidates[0].parser_evidence.date_basis, 'RUN_CONTEXT_TARGET_DATE');
  assert.equal(parsed.telemetry.missingDateAnchorRejected, 0);
});
