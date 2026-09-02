import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOTBALL_DATA_DIVISIONS,
  HISTORICAL_SOURCES,
  resolveFootballDataDivision,
} from '../local-node/harvester/football-data/historical-registry.mjs';

test('Football-Data division registry remains the single source for historical URLs and canonical keys',()=>{
  assert.equal(FOOTBALL_DATA_DIVISIONS.length,22);
  assert.equal(HISTORICAL_SOURCES.length,242);
  assert.deepEqual(resolveFootballDataDivision('E1'),{
    competition:'E1',
    league:'England Championship',
    country:'England',
    canonicalCompetitionKey:'england:e1',
  });
  assert.equal(resolveFootballDataDivision(' e2 ')?.canonicalCompetitionKey,'england:e2');
  assert.equal(resolveFootballDataDivision('SC0')?.canonicalCompetitionKey,'scotland:sc0');
  assert.equal(resolveFootballDataDivision('UNKNOWN'),null);
  for(const row of FOOTBALL_DATA_DIVISIONS){
    assert.match(row.canonicalCompetitionKey,/^[a-z]+:[a-z0-9]+$/);
    assert.ok(HISTORICAL_SOURCES.some(x=>x.competition===row.competition&&x.league===row.league));
  }
});
