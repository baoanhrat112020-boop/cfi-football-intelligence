import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260904091500_add_pc_result_recovery_queue.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/cfi-pc-result-recovery/index.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../pc-node/cfi-result-recovery-worker.mjs', import.meta.url), 'utf8');

test('PC result recovery queues only strict selected historical pending snapshots', () => {
  assert.match(migration, /selected_for_match_audit=true/);
  assert.match(migration, /settlement_status='PENDING'/);
  assert.match(migration, /s\.strict_prior=true/);
  assert.match(migration, /h\.target_date < v_today/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /cfi-pc-result-recovery-enqueue-10m/);
});

test('PC result recovery API is node-authenticated and settlement-aware', () => {
  assert.match(edge, /x-cfi-node-key/);
  assert.match(edge, /independentSources:2/);
  assert.match(edge, /completeHtFt:true/);
  assert.match(edge, /kickoffAgreementMinutes:30/);
  assert.match(edge, /cfi_settle_prediction_snapshots/);
  assert.match(edge, /settlement_status===\"SETTLED\"/);
});

test('post-match worker is separate from prematch urgent bridge and requires consensus', () => {
  assert.doesNotMatch(worker, /URGENT_FIXTURE_(PULL|QUEUE|ACK)/);
  assert.match(worker, /RESULT_CONSENSUS/);
  assert.match(worker, /consensusPair/);
  assert.match(worker, /FLASHSCORE/);
  assert.match(worker, /FOTMOB/);
  assert.match(worker, /SOFASCORE/);
  assert.match(worker, /kickoffClose/);
});
