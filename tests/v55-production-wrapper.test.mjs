import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

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

test('production entrypoint may add GPT transport or P0 discovery but must delegate prematch through live router to V5.2.5',()=>{
  const wrangler=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  const liveRouter=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');
  const p0Url=new URL('../cloudflare-worker/src/index-p0-router.ts',import.meta.url);
  const gptCoreUrl=new URL('../cloudflare-worker/src/index-gpt-core-v4.ts',import.meta.url);
  const usesP0=/"main"\s*:\s*"cloudflare-worker\/src\/index-p0-router\.ts"/.test(wrangler);
  const usesLive=/"main"\s*:\s*"cloudflare-worker\/src\/index-live-router\.ts"/.test(wrangler);
  const usesGptCore=/"main"\s*:\s*"cloudflare-worker\/src\/index-gpt-core-v4\.ts"/.test(wrangler);
  assert.equal(usesP0||usesLive||usesGptCore,true,'production entrypoint must be canonical live/P0 chain or guarded GPT Core wrapper');
  if(usesGptCore){
    assert.equal(existsSync(gptCoreUrl),true,'configured GPT Core V4 wrapper must exist');
    const gptCore=readFileSync(gptCoreUrl,'utf8');
    assert.match(gptCore,/import core from '\.\/index-p0-router\.ts'/);
    assert.match(gptCore,/CFI_GPT_PREDICT_COMPACT_V1/);
    assert.match(gptCore,/SUPPLIED_FIXTURE_ONLY/);
    assert.match(gptCore,/return core\.fetch\(request,env,ctx\)/);
  }
  if(usesP0||usesGptCore){
    assert.equal(existsSync(p0Url),true,'canonical P0 router must exist');
    const p0=readFileSync(p0Url,'utf8');
    assert.match(p0,/import base from '\.\/index-live-router\.ts'/);
    assert.match(p0,/return base\.fetch\(request,env,ctx\)/);
  }
  assert.match(liveRouter,/import prematch from '\.\/index-v55\.ts'/);
  assert.match(liveRouter,/if\(url\.pathname!=='\/api\/predict-live'/);
  assert.match(liveRouter,/return prematch\.fetch\(request,env,ctx\)/);
});
