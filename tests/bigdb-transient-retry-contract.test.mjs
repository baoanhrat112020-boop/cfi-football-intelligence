import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const retry=fs.readFileSync(new URL('../cloudflare-worker/src/index-v50-resilient.ts',import.meta.url),'utf8');
const v51=fs.readFileSync(new URL('../cloudflare-worker/src/index-v51.ts',import.meta.url),'utf8');

test('prematch retries only transient BigDB 500 class and preserves fail-closed behavior',()=>{
  assert.match(v51,/import v50 from '\.\/index-v50-resilient\.ts'/);
  assert.match(retry,/MAX_ATTEMPTS=3/);
  assert.match(retry,/BIG_DB_V2_PREDICTION_FAILURE/);
  assert.match(retry,/BIG_DB_V2_FAILED/);
  assert.match(retry,/HTTP_429/);
  assert.match(retry,/request\.clone\(\)/);
  assert.match(retry,/recovered:false,exhausted:true/);
  assert.doesNotMatch(retry,/status===400|status===401|status===403/);
});
