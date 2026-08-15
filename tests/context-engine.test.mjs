import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreTrend,
  deriveContextSignal,
  applyContextToProbability,
  analyzeRedCard,
} from '../src/prediction/context-engine.ts';

const fixtures = [
  {matchDate:'2026-08-10',homeTeam:'A',awayTeam:'X',htHome:2,htAway:1,ftHome:5,ftAway:2},
  {matchDate:'2026-08-01',homeTeam:'Y',awayTeam:'A',htHome:0,htAway:2,ftHome:1,ftAway:4},
  {matchDate:'2026-07-20',homeTeam:'A',awayTeam:'Z',htHome:1,htAway:1,ftHome:3,ftAway:2},
  {matchDate:'2026-07-10',homeTeam:'Q',awayTeam:'A',htHome:1,htAway:0,ftHome:2,ftAway:1},
];

test('score trend is compact and specific', () => {
  const trend = buildScoreTrend({team:'A',fixtures});
  assert.ok(trend.length > 0 && trend.length <= 6);
  assert.ok(trend.every(x => /^\d+-\d+$/.test(x.score)));
});

test('context adjustment remains probabilistic', () => {
  const signal = deriveContextSignal({team:'A',fixtures,homeAway:'home',tablePosition:3,tableSize:18,lineupStrength:.72});
  const out = applyContextToProbability(.48,signal,'7+ FT');
  assert.ok(out.probability >= 0 && out.probability <= 1);
  assert.ok(out.uncertaintyBand[0] <= out.probability && out.uncertaintyBand[1] >= out.probability);
  assert.equal(out.randomShockWeight,.025);
});

test('red-card history can trigger live alert and boosts FT tails', () => {
  const out = analyzeRedCard({
    whenReduced:[
      {minute:22,goalsAfterFor:0,goalsAfterAgainst:3,collapsed:true},
      {minute:50,goalsAfterFor:0,goalsAfterAgainst:2,collapsed:true},
      {minute:70,goalsAfterFor:0,goalsAfterAgainst:0,collapsed:false},
    ],
    opponentVsReduced:[
      {minute:30,goalsAfterFor:3,aggressiveSurge:true},
      {minute:60,goalsAfterFor:2,aggressiveSurge:true},
    ],
  }, {minute:31,scoreHome:1,scoreAway:0,redCardTeam:'away'});
  assert.equal(out.alert,true);
  assert.ok(out.marketBoost['7+ FT'] > 0);
  assert.ok(out.marketBoost['Other FT'] > 0);
});
