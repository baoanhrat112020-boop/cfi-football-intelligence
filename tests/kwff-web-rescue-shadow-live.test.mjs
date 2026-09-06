import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKwffMatchCardText } from '../tools/cfi-kwff-web-rescue-shadow-live.mjs';

test('KWFF upcoming match card parser extracts exact teams and KST kickoff', () => {
  const parsed = parseKwffMatchCardText(`
24R
09.05.Sat 19:00 Suwon Sports Complex
Suwon FC Women
VS Upcoming
Incheon Hyundai Steel Red Angels Womens Football Club
Match Center
`, { year: 2026 });

  assert.equal(parsed.accepted, true);
  assert.equal(parsed.home, 'Suwon FC Women');
  assert.equal(parsed.away, 'Incheon Hyundai Steel Red Angels Womens Football Club');
  assert.equal(parsed.scheduleDate, '2026-09-05');
  assert.equal(parsed.displayedTime, '19:00');
  assert.equal(parsed.kickoffIso, '2026-09-05T10:00:00.000Z');
});

test('KWFF parser fails closed when card does not prove upcoming status', () => {
  const parsed = parseKwffMatchCardText(`
24R
09.05.Sat 19:00 Suwon Sports Complex
Suwon FC Women
Incheon Hyundai Steel Red Angels Womens Football Club
Match Center
`, { year: 2026 });

  assert.equal(parsed.accepted, false);
  assert.equal(parsed.reason, 'UPCOMING_STATUS_NOT_FOUND');
});
