import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const p0=fs.readFileSync(new URL('../cloudflare-worker/src/index-p0-router.ts',import.meta.url),'utf8');

test('discovery provenance never references feed-local variables outside scope',()=>{
  assert.match(p0,/noDuplicateWorkerProviderCrawler:f\.search\?\.workerProviderFallbackAllowed===false/);
  assert.doesNotMatch(p0,/noDuplicateWorkerProviderCrawler:database!==null/);
  assert.doesNotMatch(p0,/noDuplicateWorkerProviderCrawler:!usePublicProviders/);
  assert.match(p0,/const database=await databaseFeed/);
  assert.match(p0,/workerProviderFallbackAllowed=explicitProviderDiagnostics\|\|providerFallbackTriggered/);
  assert.match(p0,/providerFallbackTriggered=verifiedBeforeProviders\.length<requestedRows/);
});
