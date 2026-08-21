import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');

test('V5.2.5 wrapper never recalibrates threshold FINAL after native score distributions are built',()=>{
  assert.doesNotMatch(source,/restoreMatchSpecificThresholds/);
  assert.doesNotMatch(source,/r\.final\s*=\s*calibrate/);
  assert.match(source,/consistencyViolations\(body\)/);
  assert.match(source,/SCORELINE_MARKET_INCONSISTENCY/);
  assert.match(source,/predictionPath:'CONSISTENCY_FAIL_CLOSED'/);
});

test('V5.2.5 declares both global-prior direct shrinkage paths disabled',()=>{
  assert.match(source,/thresholdGlobalPriorDirectShrinkage:false/);
  assert.match(source,/scorelineGlobalPriorDirectShrinkage:false/);
  assert.match(source,/mode:'NATIVE_MATCH_SPECIFIC_DISTRIBUTION_ONLY'/);
});

test('production Wrangler entrypoint is V5.2.5 wrapper',()=>{
  const wrangler=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(wrangler,/"main"\s*:\s*"cloudflare-worker\/src\/index-v55\.ts"/);
});
