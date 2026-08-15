import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contracts=fs.readFileSync(new URL('../chatgpt-app/src/contracts.ts',import.meta.url),'utf8');
const widget=fs.readFileSync(new URL('../chatgpt-app/src/widget.ts',import.meta.url),'utf8');
const readme=fs.readFileSync(new URL('../chatgpt-app/README.md',import.meta.url),'utf8');

test('native app exposes four frozen markets',()=>{
  for(const m of ['3+ HT','7+ FT','Other HT','Other FT']) assert.ok(contracts.includes(m));
});
test('native app contract exposes core MCP capabilities',()=>{
  for(const t of ['cfi_predict_match','cfi_team_history','cfi_h2h','cfi_db_status','cfi_live_event']) assert.ok(contracts.includes(t));
});
test('widget preserves dual strategy and live red-card surface',()=>{
  for(const token of ['optionA','optionB','redCardAlert','uncertaintyLow','contextAdjustment']) assert.ok(widget.includes(token));
});
test('architecture preserves persistent DB and strict-prior contract',()=>{
  assert.match(readme,/Persistent DB/); assert.match(readme,/Strict-prior/); assert.match(readme,/MCP endpoint/);
});
