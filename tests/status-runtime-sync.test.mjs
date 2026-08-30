import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');

test('status endpoint advertises current Top-1 prematch production runtime while preserving DB payload',()=>{
  for(const token of ['/api/status','CFI_FINAL_V5.3.0','CFI_PRIMARY_TOP1_RUNTIME_V2','NATIVE_V5_3_TOP1_STRICT_PRIOR_BIGDB_V2_1_2','CFI_4_MARKETS_PLUS_TOP1_HT_FT_V1','CFI_BIG_DB_RETRIEVAL_V2.1.2','CFI_MATCH_DIVERSITY_GUARD_V1']) assert.match(router,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(router,/body\.engine=PREMATCH_ENGINE/);
  assert.match(router,/\.\.\.\(body\.runtime\?\?\{\}\)/);
  assert.match(router,/\.\.\.\(body\.bigDbRetrieval\?\?\{\}\)/);
});

test('health endpoint is sourced from current release constants rather than legacy hard-coded engine versions',()=>{
  assert.match(router,/url\.pathname==='\/health'/);
  assert.match(router,/version:PREMATCH_ENGINE/);
  assert.match(router,/engine:PREMATCH_ENGINE/);
  assert.match(router,/version:PREMATCH_RUNTIME/);
  assert.match(router,/predictionPath:PREMATCH_PATH/);
  assert.match(router,/version:BIGDB_VERSION/);
  assert.doesNotMatch(router,/CFI_FINAL_V5\.0\.1/);
});