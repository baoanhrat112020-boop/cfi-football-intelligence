import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260904091500_add_pc_result_recovery_queue.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/cfi-pc-result-recovery/index.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../pc-node/cfi-result-recovery-worker.mjs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../pc-node/install-result-recovery-task.ps1', import.meta.url), 'utf8');

test('PC result recovery queues only strict selected historical pending snapshots', () => {
  assert.match(migration, /selected_for_match_audit=true/);
  assert.match(migration, /settlement_status='PENDING'/);
  assert.match(migration, /s\.strict_prior=true/);
  assert.match(migration, /h\.target_date < v_today/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /cfi-pc-result-recovery-enqueue-10m/);
});

test('PC result recovery persists valid single-source observations but settles only after accumulated dual-source consensus', () => {
  assert.match(edge, /x-cfi-node-key/);
  assert.match(edge, /action===\"SUBMIT\"/);
  assert.match(edge, /PC_RESULT_RECOVERY_OBSERVATION_V2_FAILOVER/);
  assert.match(edge, /status:\"OBSERVED\"/);
  assert.match(edge, /PARTIAL_STORED/);
  assert.match(edge, /CONFLICT_PENDING/);
  assert.match(edge, /consensusPair/);
  assert.match(edge, /PC_RESULT_RECOVERY_ACCUMULATED_DUAL_SOURCE_V2_FAILOVER/);
  assert.match(edge, /status:\"VERIFIED\"/);
  assert.match(edge, /COMPLETE_FINISHED_HT_FT_REQUIRED/);
  assert.match(edge, /POST_KICKOFF_SNAPSHOT/);
  assert.match(edge, /EXACT_HINT_REQUIRED/);
  assert.match(edge, /\[\"BONGDAWAP\",\"AISCORE\"\]/);
  assert.match(edge, /PC_NODE_RESULT_RECOVERY/);
  assert.match(edge, /cfi_settle_prediction_snapshots/);
});

test('PC result recovery uses the real prediction history settlement columns', () => {
  assert.doesNotMatch(edge, /actual_ht_score/);
  assert.doesNotMatch(edge, /actual_ft_score/);
  assert.match(edge, /actual_ht_home/);
  assert.match(edge, /actual_ht_away/);
  assert.match(edge, /actual_ft_home/);
  assert.match(edge, /actual_ft_away/);
});

test('post-match worker submits every valid observation and no longer discards single-source evidence locally', () => {
  assert.doesNotMatch(worker, /URGENT_FIXTURE_(PULL|QUEUE|ACK)/);
  assert.match(worker, /action:\"SUBMIT\"/);
  assert.match(worker, /sources:events/);
  assert.match(worker, /PARTIAL_STORED/);
  assert.match(worker, /CONFLICT_PENDING/);
  assert.doesNotMatch(worker, /NO_DUAL_SOURCE_CONSENSUS/);
  assert.match(worker, /BONGDAWAP/);
  assert.match(worker, /AISCORE/);
  assert.match(worker, /FLASHSCORE/);
  assert.match(worker, /FOTMOB/);
  assert.match(worker, /SOFASCORE/);
  assert.match(worker, /blockedProviders/);
});

test('R4 installer is one-shot, config-backed, quote-safe and self-verifying', () => {
  assert.match(installer, /CFI-PC-NODE-R4-RESULT-RECOVERY/);
  assert.match(installer, /D:\\CFI\\PC-Node/);
  assert.match(installer, /AUTH_SOURCE=config\.json/);
  assert.match(installer, /DIRECT_SMOKE=PASS/);
  assert.match(installer, /\/XML \$TaskXml/);
  assert.match(installer, /WindowsIdentity/);
  assert.match(installer, /<UserId>\$EscUserSid<\/UserId>/);
  assert.match(installer, /TASK_VERIFY=PASS/);
  assert.match(installer, /FIX_RESULT=PASS/);
  assert.match(installer, /MAIN_RUNNER_MUTATED=FALSE/);
});