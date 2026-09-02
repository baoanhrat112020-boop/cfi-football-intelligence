import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const p0=fs.readFileSync(new URL('../cloudflare-worker/src/index-p0-router.ts',import.meta.url),'utf8');

test('discovery provenance never references feed-local variables outside scope',()=>{
  assert.match(p0,/noDuplicateWorkerProviderCrawler:true/);
  assert.doesNotMatch(p0,/noDuplicateWorkerProviderCrawler:database!==null/);
  assert.doesNotMatch(p0,/noDuplicateWorkerProviderCrawler:!usePublicProviders/);
  assert.match(p0,/const database=await databaseFeed/);
  assert.match(p0,/workerProviderFallbackAllowed:false/);
  assert.match(p0,/providerDiagnosticsPriority:'AFTER_BIGDB_PREFLIGHT_AND_PREDICTION'/);
  assert.match(p0,/canonicalFeedOwnsProviderFallback:true/);
  assert.match(p0,/CANONICAL_DATABASE_FEED_OWNS_PROVIDER_FALLBACK/);
  assert.match(p0,/bigDbPreflightPriority:true/);
  assert.match(p0,/providerDiagnosticsInBandBeforePreflight:false/);
});
