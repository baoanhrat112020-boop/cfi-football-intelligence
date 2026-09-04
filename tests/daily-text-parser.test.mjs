import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDailyFixtureText } from '../local-node/browser/fixture-collector/daily-text-parser.mjs';

const baseSource = {
  id: 'daily-aiscore',
  provider: 'aiscore',
  url: 'https://www.aiscore.com/live',
  competition: 'ALL FOOTBALL',
  country: 'GLOBAL',
  render_timezone: 'Asia/Ho_Chi_Minh'
};

const targetDate = '2026-09-05';

test('AiScore-style time plus joined team text creates exact prospective fixture candidate', () => {
  const parsed = parseDailyFixtureText(baseSource, `
    2026/09/05
    14:30
    Chelsea FC Women vs Aston Villa Women Live
    15:00
    Nordsjaelland U19 vs Midtjylland U19 Live
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].home_team, 'Chelsea FC Women');
  assert.equal(parsed.candidates[0].away_team, 'Aston Villa Women');
  assert.equal(parsed.candidates[0].kickoff_utc, '2026-09-05T07:30:00.000Z');
  assert.equal(parsed.candidates[0].parser_evidence.extraction, 'TIME_PLUS_JOINED_TEAMS');
});

test('BongdaWap-style time followed by two team lines is parsed without inventing competition details', () => {
  const source = {
    ...baseSource,
    id: 'daily-bongdawap',
    provider: 'bongdawap',
    url: 'https://bongdawap.com/lich-thi-dau-bong-da.html'
  };
  const parsed = parseDailyFixtureText(source, `
    Lịch thi đấu 05/09/2026
    16:00
    Arkonia Szczecin U19
    Polonia Warszawa Youth
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].home_team, 'Arkonia Szczecin U19');
  assert.equal(parsed.candidates[0].away_team, 'Polonia Warszawa Youth');
  assert.equal(parsed.candidates[0].kickoff_utc, '2026-09-05T09:00:00.000Z');
  assert.equal(parsed.candidates[0].competition, 'ALL FOOTBALL');
});

test('BongdaWap standings decorations are stripped from team identity', () => {
  const source = {
    ...baseSource,
    id: 'daily-bongdawap',
    provider: 'bongdawap',
    url: 'https://bongdawap.com/lich-thi-dau-bong-da.html'
  };
  const parsed = parseDailyFixtureText(source, `
    18:30 - [5] Newcastle vs Bournemouth [14] -
    21:00 - [Đông B-3] Fujieda MYFC vs Vanraure Hachinohe [Đông A-9] -
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].home_team, 'Newcastle');
  assert.equal(parsed.candidates[0].away_team, 'Bournemouth');
  assert.equal(parsed.candidates[1].home_team, 'Fujieda MYFC');
  assert.equal(parsed.candidates[1].away_team, 'Vanraure Hachinohe');
});

test('Flashscore-style inline time and teams is accepted', () => {
  const source = {
    ...baseSource,
    id: 'daily-flashscore',
    provider: 'flashscore',
    url: 'https://www.flashscore.com/football/'
  };
  const parsed = parseDailyFixtureText(source, `
    17:15 Hammarby Women - IFK Norrkoping DFK Women
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].home_team, 'Hammarby Women');
  assert.equal(parsed.candidates[0].away_team, 'IFK Norrkoping DFK Women');
  assert.equal(parsed.candidates[0].kickoff_utc, '2026-09-05T10:15:00.000Z');
  assert.equal(parsed.candidates[0].parser_evidence.extraction, 'INLINE_TIME_TEAMS');
});

test('fixture identity without explicit kickoff time is kept identity-only and never fabricated into a candidate', () => {
  const parsed = parseDailyFixtureText(baseSource, `
    2026/09/05 Chelsea FC Women vs Aston Villa Women Live
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.identityOnly.length, 1);
  assert.equal(parsed.identityOnly[0].reason, 'MISSING_EXPLICIT_KICKOFF_TIME');
});

test('explicit other-date section does not leak into target-date candidates', () => {
  const parsed = parseDailyFixtureText(baseSource, `
    2026/09/04
    14:00
    Old Home vs Old Away Live
    2026/09/05
    15:30
    New Home vs New Away Live
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].home_team, 'New Home');
  assert.equal(parsed.candidates[0].away_team, 'New Away');
});

test('duplicate fixture observations inside one snapshot are deduplicated', () => {
  const parsed = parseDailyFixtureText(baseSource, `
    14:30 Chelsea FC Women vs Aston Villa Women Live
    14:30 Chelsea FC Women vs Aston Villa Women Live
  `, { targetDate, timeZone: 'Asia/Ho_Chi_Minh' });

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.telemetry.duplicatesRemoved, 1);
});

test('unsupported timezone fails closed instead of guessing an offset', () => {
  const parsed = parseDailyFixtureText(baseSource, `14:30 Home A vs Away B`, {
    targetDate,
    timeZone: 'Europe/London'
  });

  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.rejected[0].reason, 'UNSUPPORTED_TIMEZONE_OR_INVALID_KICKOFF');
});
