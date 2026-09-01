import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOTBALL_DATA_FORWARD_V2,
  chooseOpening1x2,
  chooseSelection,
  footballDataDateToYmd,
  model1x2,
  normalizeName,
  normalized1x2,
  parseCsv,
  predictionStrictOk,
  zonedDateTimeToUtcIso,
} from '../supabase/functions/cfi-forward-market-v2/football-data.ts';

test('forward V2 is research-only and forbids canonical writes', () => {
  assert.equal(FOOTBALL_DATA_FORWARD_V2.researchOnly, true);
  assert.equal(FOOTBALL_DATA_FORWARD_V2.decisionUse, false);
  assert.equal(FOOTBALL_DATA_FORWARD_V2.productionMutationAllowed, false);
  assert.equal(FOOTBALL_DATA_FORWARD_V2.canonicalWriteAllowed, false);
  assert.equal(FOOTBALL_DATA_FORWARD_V2.sourceTimeZone, 'Europe/London');
});

test('Football-Data date/time is converted from Europe/London with DST', () => {
  assert.equal(footballDataDateToYmd('01/09/2026'), '2026-09-01');
  assert.equal(zonedDateTimeToUtcIso('2026-09-01', '19:45'), '2026-09-01T18:45:00.000Z');
  assert.equal(zonedDateTimeToUtcIso('2026-08-28', '19:30'), '2026-08-28T18:30:00.000Z');
  assert.equal(zonedDateTimeToUtcIso('2026-12-01', '19:45'), '2026-12-01T19:45:00.000Z');
});

test('CSV parser handles BOM, quoted commas and CRLF', () => {
  const rows = parseCsv('\uFEFFDiv,Date,Time,HomeTeam,AwayTeam,AvgH,AvgD,AvgA\r\nE0,01/09/2026,19:45,"Team, One",Team Two,2.1,3.2,3.4\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].HomeTeam, 'Team, One');
  assert.equal(rows[0].AwayTeam, 'Team Two');
});

test('opening 1X2 uses coherent average triplet before individual books', () => {
  const market = chooseOpening1x2({ AvgH:'2.10', AvgD:'3.20', AvgA:'3.40', B365H:'2.00', B365D:'3.10', B365A:'3.30' });
  assert.deepEqual(market, { bookmaker:'FOOTBALL_DATA_AVG_OPENING', home:2.1, draw:3.2, away:3.4, columns:['AvgH','AvgD','AvgA'] });
  const fallback = chooseOpening1x2({ AvgH:'', AvgD:'', AvgA:'', B365H:'2.00', B365D:'3.10', B365A:'3.30' });
  assert.equal(fallback?.bookmaker, 'BET365_OPENING');
});

test('strict-prior and FT 1X2 require real exposed production fields', () => {
  const prediction = {
    strictPriorAudit: { verified:true, evidence:{ verified:true, futureEvidenceCount:0, sameDateEvidenceCount:0, maxEvidenceDate:'2026-08-31' } },
    multiMarket: { oneXTwo:{ ft:{ home:0.5, draw:0.3, away:0.2 } } },
  };
  assert.equal(predictionStrictOk(prediction, '2026-09-01'), true);
  assert.deepEqual(model1x2(prediction), { home:0.5, draw:0.3, away:0.2 });
  assert.equal(predictionStrictOk({ ...prediction, strictPriorAudit:{ verified:true, evidence:{ verified:true, futureEvidenceCount:0, sameDateEvidenceCount:1, maxEvidenceDate:'2026-08-31' } } }, '2026-09-01'), false);
});

test('market normalization and selection are deterministic', () => {
  const market = normalized1x2({ home:2.5, draw:3.4, away:2.8 });
  const pick = chooseSelection({ home:0.48, draw:0.25, away:0.27 }, market);
  assert.equal(pick.selection, 'HOME');
  assert.ok(pick.edge > 0);
});

test('name normalization is accent and punctuation stable', () => {
  assert.equal(normalizeName('Unión La Calera'), 'union la calera');
  assert.equal(normalizeName("O'Higgins"), 'o higgins');
});
