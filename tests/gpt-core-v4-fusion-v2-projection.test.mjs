import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src=readFileSync(new URL('../cloudflare-worker/src/index-gpt-core-v4.ts',import.meta.url),'utf8');

test('GPT Core V4 compact prediction exposes both Fusion V1 and V2 challenger',()=>{
  assert.match(src,/championFusion:compactFusion\(body\?\.championFusion\)/);
  assert.match(src,/championFusionChallenger:compactFusion\(body\?\.championFusionChallenger\)/);
});

test('compact trimming must not drop top-level Fusion V2 challenger',()=>{
  assert.doesNotMatch(src,/delete\s+compact\.championFusionChallenger/);
});
