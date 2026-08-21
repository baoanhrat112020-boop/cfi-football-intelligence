import test from 'node:test';
import assert from 'node:assert/strict';
import { replayDualHistorical } from '../src/learning/dual-historical-replay.ts';
import { scoreReplayAllModels } from '../research/replay-promotion-adapter.mjs';

const fixtures = Array.from({ length: 24 }, (_, i) => ({
  id:`rf${i+1}`,
  matchDate:`2026-02-${String(i+1).padStart(2,'0')}`,
  homeTeam:i%2?'Beta':'Alpha',
  awayTeam:i%2?'Alpha':'Beta',
  ht:{home:i%3===0?2:1,away:i%5===0?1:0},
  ft:{home:i%4===0?5:2,away:i%6===0?2:1},
}));

test('replay exports real date-bounded temporal provenance', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  assert.equal(replay.strictPrior,true);
  assert.equal(replay.sameDateLeakage,false);
  assert.equal(replay.temporalProvenanceComplete,true);
  const eligible = replay.evaluations.filter(r=>r.evidenceCount>0);
  assert.ok(eligible.length>0);
  for (const r of eligible) {
    assert.ok(r.maxEvidenceTimestamp);
    assert.ok(Date.parse(r.maxEvidenceTimestamp) < Date.parse(r.targetTimestamp));
  }
});

test('promotion adapter scores all replay models without inferred timestamps', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  const scored = scoreReplayAllModels(replay,{stability:.9,robustness:1});
  for (const type of ['HISTORICAL_PRODUCTION','FUTURE_SIX_FACTORS','FINAL_CFI']) {
    assert.ok(scored[type]);
    assert.ok(scored[type].sampleCount>0);
    assert.equal(scored[type].productionEligible,false);
    assert.ok(Number.isFinite(scored[type].score));
    assert.ok(!scored[type].hardFailures.includes('STRICT_PRIOR_FAILURE'));
  }
});

test('adapter fails closed when temporal provenance is not verified', () => {
  const replay = replayDualHistorical(fixtures,{minPrior:8});
  replay.temporalProvenanceComplete=false;
  const scored = scoreReplayAllModels(replay);
  for (const result of Object.values(scored)) {
    assert.equal(result.status,'FAIL_HARD_GATE');
    assert.equal(result.shadowEligible,false);
  }
});
