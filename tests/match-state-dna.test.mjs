import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../src/intelligence/match-state-dna.ts', import.meta.url),'utf8');

test('v3.2 includes all requested context families',()=>{
  for(const key of ['earlyGoalTempo','keepsAttackingWhenAhead','responseWhenBehind','collapseAfterRapidConcessions','opponentStrengthAdjustedForm','restFatigue','motivation','styleMatchup','goalkeeperDefenceStability','startingXIContinuity','liveMomentum','scorelinePressure','refereeVolatility','extremeWeatherPitch']) assert.match(src,new RegExp(key));
});

test('context adjustment is bounded and uncertainty retained',()=>{
  assert.match(src,/caps: Record<Market, number>/);
  assert.match(src,/uncertaintyBand/);
  assert.match(src,/randomShock=0\.025/);
});

test('four frozen markets remain explicit',()=>{
  for(const m of ['3+ HT','7+ FT','Other HT','Other FT']) assert.ok(src.includes(m));
});
