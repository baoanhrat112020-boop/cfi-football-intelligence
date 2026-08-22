import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/functions/cfi-segment-calibration-learn/index.ts';
const migrationPath = 'supabase/sql/cfi_segment_calibration_scheduler_auth_v1.sql';
const src = fs.readFileSync(path, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('segment calibration learner is source-controlled and streaming', () => {
  assert.match(src, /CFI_SEGMENT_LEARNER_V1\.2_STREAMING/);
  assert.match(src, /EXPANDING_VS_RECENT20_TOURNAMENT_STREAMING/);
  assert.match(src, /const states = new Map/);
  assert.match(src, /observeRow\(state, row\)/);
  assert.match(src, /complexity: "O\(Nx11\)"/);
});

test('segment learner does not rebuild full expanding history for every fixture', () => {
  assert.doesNotMatch(src, /rows\.slice\(0\s*,\s*i\)/);
  assert.doesNotMatch(src, /prior\.map\(/);
  assert.doesNotMatch(src, /out\.push\(\.\.\./);
});

test('segment learner requires complete scores, bounded recent window, and deterministic order', () => {
  for (const field of ['ht_home', 'ht_away', 'ft_home', 'ft_away']) {
    assert.match(src, new RegExp(`\\.not\\("${field}", "is", null\\)`));
  }
  assert.match(src, /if \(s\.recent\.length > 20\) s\.recent\.shift\(\)/);
  assert.match(src, /\.order\("competition_segment"/);
  assert.match(src, /\.order\("match_date"/);
  assert.match(src, /\.order\("fixture_id"/);
});

test('segment learner requires private scheduler token in addition to JWT', () => {
  assert.match(src, /from\("cfi_scheduler_tokens"\)/);
  assert.match(src, /req\.headers\.get\("x-cfi-scheduler-token"\)/);
  assert.match(src, /UNAUTHORIZED_SCHEDULER/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.cfi_scheduler_tokens from public, anon, authenticated/i);
  assert.match(migration, /x-cfi-scheduler-token/);
});
