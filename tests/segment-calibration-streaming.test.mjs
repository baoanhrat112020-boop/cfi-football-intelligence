import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/functions/cfi-segment-calibration-learn/index.ts';
const src = fs.readFileSync(path, 'utf8');

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

test('segment learner requires complete HT and FT scores and bounded recent window', () => {
  for (const field of ['ht_home', 'ht_away', 'ft_home', 'ft_away']) {
    assert.match(src, new RegExp(`\\.not\\("${field}", "is", null\\)`));
  }
  assert.match(src, /if \(s\.recent\.length > 20\) s\.recent\.shift\(\)/);
});
