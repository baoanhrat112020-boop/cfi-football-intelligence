import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');

test('native BigDB layer must never directly shrink match-specific outputs',()=>{
  assert.match(worker,/CONTEXT_ONLY/);
  assert.match(worker,/NO_DIRECT_GLOBAL_SCORELINE_SHRINKAGE/);
  assert.match(worker,/thresholdGlobalPriorDirectShrinkage:false/);
  assert.match(worker,/scorelineGlobalPriorDirectShrinkage:false/);
  assert.doesNotMatch(worker,/function applyMarketPriors/);
  assert.doesNotMatch(worker,/function applyScorelinePriors/);
  assert.doesNotMatch(worker,/function shrinkTop3/);
});

test('global prior telemetry cannot mutate Method A B FINAL',()=>{
  const attach=worker.slice(worker.indexOf('function attachGlobalPriorTelemetry'),worker.indexOf('function sixTargetMatrix'));
  assert.doesNotMatch(attach,/\.methodA\s*=/);
  assert.doesNotMatch(attach,/\.methodB\s*=/);
  assert.doesNotMatch(attach,/\.final\s*=/);
  assert.doesNotMatch(attach,/\.probability\s*=/);
});

test('six-target contract still exposes native A B FINAL and Top3',()=>{
  assert.match(worker,/methodA:r\.methodA/);
  assert.match(worker,/methodB:r\.methodB/);
  assert.match(worker,/final:r\.final/);
  assert.match(worker,/prediction\?\.scoreline\?\.ht\?\.methodA/);
  assert.match(worker,/prediction\?\.scoreline\?\.ft\?\.final/);
  assert.match(worker,/verification:\{thresholdComplete,scorelineComplete,complete:thresholdComplete&&scorelineComplete\}/);
});

test('diversity fix remains strict about persistent BigDB retrieval',()=>{
  assert.match(worker,/source:'PERSISTENT_DB'/);
  assert.match(worker,/BIG_DB_V2_FAILED/);
  assert.match(worker,/buildPrediction\(\{home:predictionHome,away:predictionAway,targetDate/);
  assert.match(worker,/prediction\.target=\{home,away,date:targetDate\}/);
});
