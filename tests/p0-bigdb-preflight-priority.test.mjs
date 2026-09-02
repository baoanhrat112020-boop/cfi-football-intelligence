import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../cloudflare-worker/src/index-p0-router.ts',import.meta.url),'utf8');

test('P0 feed never runs provider crawler before BigDB preflight',()=>{
  const feedStart=src.indexOf('async function feed(');
  const deferredStart=src.indexOf('async function runDeferredProviderDiagnostics');
  assert.ok(feedStart>=0&&deferredStart>feedStart,'feed/deferred diagnostic functions must exist');
  const feedBlock=src.slice(feedStart,deferredStart);
  assert.doesNotMatch(feedBlock,/discoverFixtures\s*\(/,'feed must not call public provider crawler');
  assert.match(feedBlock,/workerProviderFallbackAllowed:false/,'worker provider fallback must be disabled in candidate feed');
  assert.match(feedBlock,/providerDiagnosticsPriority:'AFTER_BIGDB_PREFLIGHT_AND_PREDICTION'/);
});

test('P0 deferred provider diagnostics execute only after preflight and prediction loop',()=>{
  const preflight=src.indexOf('const evidenceReady=');
  const prediction=src.indexOf('const results=await Promise.all');
  const deferredCall=src.indexOf('await runDeferredProviderDiagnostics(input,targetDate,timeZone)');
  assert.ok(preflight>=0&&prediction>preflight&&deferredCall>prediction,'diagnostics must run after BigDB preflight and prediction execution');
  assert.match(src,/bigDbPreflightPriority:true/);
  assert.match(src,/providerDiagnosticsInBandBeforePreflight:false/);
});
