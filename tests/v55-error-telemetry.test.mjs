import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');

test('V5.3.0 Top-1 runtime normalizes release telemetry before returning fail-closed prediction errors',()=>{
  assert.match(src,/const ENGINE_VERSION='CFI_FINAL_V5\.3\.0'/);
  assert.match(src,/const RUNTIME_VERSION='CFI_PRIMARY_TOP1_RUNTIME_V2'/);
  assert.match(src,/CFI_4_MARKETS_PLUS_TOP1_HT_FT_V1/);
  assert.match(src,/const BIGDB_VERSION='CFI_BIG_DB_RETRIEVAL_V2\.1\.2'/);
  assert.match(src,/const PRODUCTION_ENTRYPOINT='index-live-router\.ts'/);
  assert.match(src,/const PREMATCH_HANDLER='index-v55\.ts'/);
  assert.match(src,/normalizeReleaseTelemetry\(body\);/);
  assert.doesNotMatch(src,/if\(!response\.ok\)return response/);
  assert.match(src,/body\.engine=ENGINE_VERSION/);
  assert.match(src,/productionEntrypoint:PRODUCTION_ENTRYPOINT/);
  assert.match(src,/prematchHandler:PREMATCH_HANDLER/);
  assert.match(src,/predictionPath:'STRICT_PRIOR_FAIL_CLOSED'/);
});