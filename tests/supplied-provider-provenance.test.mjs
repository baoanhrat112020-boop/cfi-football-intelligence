import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../cloudflare-worker/src/index-gpt-core-v4.ts',import.meta.url),'utf8');

test('GPT supplied-only board preserves supplied provider and uses a neutral fallback',()=>{
  assert.match(source,/function suppliedProvider\(row:FeedRow,input:any\)/);
  assert.match(source,/candidate\?\.provider\?\?''/);
  assert.match(source,/\|\|'EXTERNAL_SUPPLIED'/);
  assert.match(source,/provider:suppliedProvider\(row,input\)/);
  assert.match(source,/suppliedProviders:\[\.\.\.new Set\(rows\.map\(row=>suppliedProvider\(row,input\)\)\)\]/);
  assert.doesNotMatch(source,/provider:'GPT_WEB_SEARCH'/);
});
