import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text=fs.readFileSync(new URL('../gpt-action/CFI_GPT_INSTRUCTIONS.md',import.meta.url),'utf8');

test('GPT instructions include Champion Fusion shadow safety and remain below 8000 characters',()=>{
  assert.ok(text.length<8000,`GPT instructions are ${text.length} characters; editor limit is 8000`);
  assert.match(text,/CHAMPION FUSION V1/);
  assert.match(text,/decisionUse=false hoặc SHADOW_RESEARCH → SHADOW only/);
  assert.match(text,/immutable prematch championFusion snapshot/);
  assert.match(text,/không override incumbent FINAL/);
  assert.match(text,/F5\/F10P\/K048\/K034 giữ đúng status runtime/);
  assert.match(text,/không tự promote/);
});
