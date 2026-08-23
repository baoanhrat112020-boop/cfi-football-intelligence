import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/sql/cfi_forward_market_capture_staging_v1.sql',import.meta.url),'utf8');
test('forward staging is research-only immutable and verified-sample gated',()=>{
  assert.match(sql,/cfi_forward_market_captures/);
  assert.match(sql,/verification_status='VERIFIED_PREMATCH'/);
  assert.match(sql,/verified_1x2_fixtures>=30/);
  assert.match(sql,/settled_decisions>=30/);
  assert.match(sql,/status='TESTING'/);
  assert.doesNotMatch(sql,/status='SHADOW_ELIGIBLE'/);
  assert.match(sql,/CFI_FORWARD_CAPTURE_IMMUTABLE/);
  assert.match(sql,/research_only boolean not null default true/);
});
