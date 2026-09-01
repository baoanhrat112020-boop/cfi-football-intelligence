import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFootballDataHistoricalMarketEvidence } from '../local-node/harvester/football-data/historical-market-evidence.mjs';

const source = {
  id: 'football-data-2526-E0',
  season: '2025/26',
  competition: 'E0',
  league: 'England Premier League',
  url: 'https://www.football-data.co.uk/mmz4281/2526/E0.csv',
};

test('Football-Data historical odds preserve source-semantic timing without fabricated timestamps', () => {
  const csv = [
    'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,Avg>2.5,Avg<2.5,AHh,B365AHH,B365AHA,AvgAHH,AvgAHA,B365CH,B365CD,B365CA,AvgCH,AvgCD,AvgCA,B365C>2.5,B365C<2.5,AvgC>2.5,AvgC<2.5,AHCh,B365CAHH,B365CAHA,AvgCAHH,AvgCAHA',
    'E0,15/08/2025,Liverpool,Bournemouth,4,2,1.40,5.00,7.00,1.42,4.90,6.80,1.60,2.30,1.62,2.25,-1.25,1.95,1.95,1.94,1.96,1.35,5.50,8.00,1.37,5.30,7.60,1.55,2.45,1.57,2.40,-1.50,2.05,1.85,2.03,1.87',
  ].join('\n');

  const out = parseFootballDataHistoricalMarketEvidence(source, csv, { sourceSha256: 'a'.repeat(64) });
  assert.equal(out.version, 'CFI_FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1');
  assert.equal(out.researchOnly, true);
  assert.equal(out.decisionUse, false);
  assert.equal(out.productionMutationAllowed, false);
  assert.equal(out.capturedAtFabricated, false);
  assert.equal(out.rows.length, 1);

  const row = out.rows[0];
  assert.equal(row.date, '2025-08-15');
  assert.equal(row.opening.oneXTwo.bookmaker.bookmaker, 'Bet365');
  assert.equal(row.opening.oneXTwo.bookmaker.odds_home, 1.4);
  assert.equal(row.opening.oneXTwo.marketAverage.odds_away, 6.8);
  assert.equal(row.opening.overUnder25.line, 2.5);
  assert.equal(row.opening.asianHandicap.line, -1.25);
  assert.equal(row.closing.oneXTwo.bookmaker.odds_home, 1.35);
  assert.equal(row.closing.asianHandicap.line, -1.5);
  assert.equal(row.temporalProvenance.opening.capturedAt, null);
  assert.equal(row.temporalProvenance.opening.strictPriorSemantic, true);
  assert.equal(row.temporalProvenance.opening.decisionEligible, true);
  assert.equal(row.temporalProvenance.closing.capturedAt, null);
  assert.equal(row.temporalProvenance.closing.decisionEligible, false);
  assert.equal(row.providerPolicy.pinnacleUsed, false);
  assert.equal(row.reconstructed, false);
});

test('Football-Data historical market parser fails closed when required result identity columns are missing', () => {
  assert.throws(
    () => parseFootballDataHistoricalMarketEvidence(source, 'Date,HomeTeam,AwayTeam\n15/08/2025,A,B\n'),
    /FOOTBALL_DATA_HISTORICAL_MARKET_MISSING_COLUMN_FTHG/,
  );
});
