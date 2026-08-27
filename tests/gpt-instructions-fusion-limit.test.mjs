import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text=fs.readFileSync(new URL('../gpt-action/CFI_GPT_INSTRUCTIONS.md',import.meta.url),'utf8');
const words=text.trim().split(/\s+/).filter(Boolean).length;

test('GPT instructions include Champion Fusion and remain below 8000 words',()=>{
  assert.ok(words<8000,`GPT instructions are ${words} words; limit is 8000`);
  assert.match(text,/Champion Fusion V1 — additive SHADOW_RESEARCH contract/);
  assert.match(text,/championFusion\.decisionUse=false/);
  assert.match(text,/immutable prematch `championFusion` snapshot/);
  assert.match(text,/No Action schema change is required/);
  assert.match(text,/F5 Temporal Calibration/);
  assert.match(text,/F10P Pruned Full Fusion/);
});
