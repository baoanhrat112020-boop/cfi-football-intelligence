import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFootballDataHistoricalMarketEvidence } from '../research/export-football-data-historical-market-evidence.mjs';

function response(csv, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async arrayBuffer() { return Buffer.from(csv, 'utf8'); },
  };
}

const csv = [
  'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,Avg>2.5,Avg<2.5',
  'E0,15/08/2025,Liverpool,Bournemouth,4,2,1.40,5.00,7.00,1.42,4.90,6.80,1.60,2.30,1.62,2.25',
].join('\n');

test('historical market exporter reuses registry URLs, hashes source and remains read-only', async () => {
  const calls = [];
  const result = await exportFootballDataHistoricalMarketEvidence({
    sourceIds: ['football-data-2526-E0'],
    pauseMs: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      return response(csv);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://www.football-data.co.uk/mmz4281/2526/E0.csv');
  assert.equal(result.status, 'READY');
  assert.equal(result.researchOnly, true);
  assert.equal(result.decisionUse, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.canonicalWriteAllowed, false);
  assert.equal(result.reconstructed, false);
  assert.equal(result.capturedAtFabricated, false);
  assert.equal(result.coverage.sourcesSuccessful, 1);
  assert.equal(result.coverage.evidenceRows, 1);
  assert.match(result.rows[0].source_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.rows[0].temporalProvenance.opening.capturedAt, null);
  assert.equal(result.rows[0].temporalProvenance.opening.strictPriorSemantic, true);
});

test('historical market exporter blocks instead of fabricating evidence when source fails', async () => {
  const result = await exportFootballDataHistoricalMarketEvidence({
    sourceIds: ['football-data-2526-E0'],
    pauseMs: 0,
    fetchImpl: async () => response('blocked', 403),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.hardBlockers.includes('NO_HISTORICAL_MARKET_EVIDENCE'));
  assert.ok(result.hardBlockers.includes('ALL_HISTORICAL_MARKET_SOURCES_FAILED'));
  assert.equal(result.rows.length, 0);
});
