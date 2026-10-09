import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('GPT Core V4 instructions remain supplied-fixture first and under editor limit',()=>{
  const text=read('gpt-action/CFI_GPT_INSTRUCTIONS.md');
  assert.match(text,/PRODUCTION CORE V4/);
  assert.match(text,/Không tự crawl\/fallback để lấp đủ 5 trận/);
  assert.match(text,/Web Search chỉ khi user yêu cầu acquisition ngoài/);
  assert.match(text,/Ảnh prematch → cfiPredictMatch IMAGE_ANALYSIS/);
  assert.match(text,/CHAMPION FUSION V1/);
  assert.ok(text.length<8000,`Instructions length ${text.length} exceeds 8000`);
  assert.doesNotMatch(text,/Mandatory GPT search-first fixture discovery/i);
  assert.doesNotMatch(text,/P0 Discovery-first routing/i);
});

test('GPT Action schema exposes exactly the Core V4 four-action contract',()=>{
  const yaml=read('gpt-action/openapi.yaml');
  assert.match(yaml,/version: 5\.3\.1-core-v4/);
  assert.match(yaml,/summary: Rank supplied real prematch fixtures/);
  assert.match(yaml,/required:\r?\n\s+- target_date\r?\n\s+- response_mode\r?\n\s+- fixture_candidates/);
  assert.match(yaml,/internal_provider_diagnostics:\r?\n\s+type: boolean\r?\n\s+default: false/);
  assert.match(yaml,/enum: \[SINGLE_MATCH, IMAGE_ANALYSIS\]/);
  assert.doesNotMatch(yaml,/Discovery-first/i);
  assert.doesNotMatch(yaml,/cfiGetBetHistory|cfiRecordOrSettleBet/);
  const ids=[...yaml.matchAll(/operationId:\s+(\w+)/g)].map(m=>m[1]);
  assert.deepEqual(ids,[
    'cfiGetStatus',
    'cfiDiscoverOpportunities',
    'cfiPredictMatch',
    'cfiPredictLive'
  ]);
});

test('Knowledge V4 preserves strict-prior, six targets, Fusion shadow and no forced quota',()=>{
  const text=read('gpt-action/CFI-KNOWLEDGE-V4.md');
  assert.match(text,/CFI KNOWLEDGE V4/);
  assert.match(text,/CFI_2_METHODS_X_6_TARGETS_V2/);
  assert.match(text,/CHAMPION FUSION V1/);
  assert.match(text,/SHADOW != ACTIONABLE/);
  assert.match(text,/does NOT need to autonomously crawl until a quota such as five fixtures is reached/);
  assert.match(text,/Raw screenshot content does not automatically become strict-prior model evidence/);
});
