import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');

test('status endpoint advertises current prematch production runtime while preserving DB payload',()=>{
  for(const token of ['/api/status','CFI_FINAL_V5.2.5','CFI_SIX_TARGET_RUNTIME_V1.4','NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2','CFI_BIG_DB_RETRIEVAL_V2.1.2','CFI_MATCH_DIVERSITY_GUARD_V1']) assert.match(router,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(router,/body\.engine=PREMATCH_ENGINE/);
  assert.match(router,/\.\.\.\(body\.runtime\?\?\{\}\)/);
  assert.match(router,/\.\.\.\(body\.bigDbRetrieval\?\?\{\}\)/);
});
