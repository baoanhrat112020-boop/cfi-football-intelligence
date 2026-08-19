import { strict as assert } from 'node:assert';
import { PRIMARY_TARGET_CODES, scorelineRank } from '../src/prediction/calibration-learning.ts';

const top3 = [
  { score: '1-0' },
  { score: '1-1' },
  { score: '2-1' },
];

assert.equal(scorelineRank(top3, '1-0'), 1);
assert.equal(scorelineRank(top3, '1-1'), 2);
assert.equal(scorelineRank(top3, '2-1'), 3);
assert.equal(scorelineRank(top3, '0-0'), null);
assert.deepEqual(PRIMARY_TARGET_CODES, ['3+ HT','7+ FT','Other HT','Other FT','Top-3 HT','Top-3 FT']);

console.log('PASS calibration-learning-top3');
