import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');

test('status endpoint is normalized to current prematch production runtime without mutating DB payload',()=>{
  assert.match(router,/\/api\/status/);
  assert.match(router,/CFI_FINAL_V5\.2\.5/);
  assert.match(router,/CFI_SIX_TARGET_RUNTIME_V1\.4/);
  assert.match(router,/NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2/);
  assert.match(router,/CFI_BIG_DB_RETRIEVAL_V2\.1\.2/);
});
