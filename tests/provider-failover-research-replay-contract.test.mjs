import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge=fs.readFileSync('supabase/functions/cfi-pc-result-recovery/index.ts','utf8');
const worker=fs.readFileSync('pc-node/cfi-result-recovery-worker.mjs','utf8');
const migration=fs.readFileSync('supabase/migrations/20260907065000_provider_failover_research_replay.sql','utf8')+'\n'+fs.readFileSync('supabase/migrations/20260907065100_research_replay_alias_resolver.sql','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

test('result recovery has persistent provider circuit breaker and AiScore exact-hint path',()=>{
  assert.match(edge,/V6_PROVIDER_FAILOVER_AISCORE/);
  assert.match(edge,/"AISCORE"/);
  assert.match(edge,/DISCOVER_AISCORE_HINT/);
  assert.match(edge,/cfi_result_provider_health/);
  assert.match(edge,/httpStatus===403/);
  assert.match(edge,/mins=360/);
  assert.match(edge,/EXACT_HINT_REQUIRED/);
  assert.match(worker,/blockedProviders/);
  assert.match(worker,/ensureAiScoreHint/);
  assert.match(worker,/source:"AISCORE"/);
  assert.match(worker,/action:"PROVIDER_HEALTH"/);
  assert.match(worker,/BLOCKED:/);
});

test('historical replay is strict-prior research only and cannot mutate production predictions',()=>{
  assert.match(migration,/CFI_HISTORICAL_STRICT_PRIOR_REPLAY_V1/);
  assert.match(migration,/cfi_research_future_six_live/);
  assert.match(migration,/max_ev>=r\.target_date/);
  assert.match(migration,/futureEvidenceCount/);
  assert.match(migration,/sameDateEvidenceCount/);
  assert.match(migration,/research_only boolean not null default true check \(research_only is true\)/);
  assert.match(migration,/decision_use boolean not null default false check \(decision_use is false\)/);
  assert.match(migration,/production_mutation_allowed boolean not null default false check \(production_mutation_allowed is false\)/);
  assert.doesNotMatch(migration,/insert\s+into\s+(?:public\.)?cfi_prediction_snapshots/i);
  assert.doesNotMatch(migration,/update\s+(?:public\.)?cfi_prediction_snapshots/i);
  assert.match(migration,/HISTORICAL_REPLAY_NOT_PREMATCH/);
});

test('one command runs the last two completed Vietnam calendar days',()=>{
  assert.equal(pkg.scripts['cfi:research:last2d'],'node research/replay-last-two-days.mjs');
  const runner=fs.readFileSync('research/replay-last-two-days.mjs','utf8');
  assert.match(runner,/Asia\/Ho_Chi_Minh/);
  assert.match(runner,/addDays\(today,-2\)/);
  assert.match(runner,/addDays\(today,-1\)/);
  assert.match(runner,/cfi_research_replay_audit_range/);
});
