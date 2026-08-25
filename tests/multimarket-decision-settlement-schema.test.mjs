import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_decision_settlement_v1.sql',import.meta.url),'utf8');

test('settlement schema is research-only append-only and auditable',()=>{
  assert.match(sql,/add column if not exists selection text/i);
  assert.match(sql,/FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS/i);
  assert.match(sql,/decision_snapshot_id uuid not null unique/i);
  assert.match(sql,/CFI_SETTLEMENT_MUST_FOLLOW_KICKOFF/);
  assert.match(sql,/CFI_RESULT_PROVENANCE_REQUIRED/);
  assert.match(sql,/cfi_multimarket_snapshot_immutable_guard/);
  assert.match(sql,/research_only boolean not null default true check \(research_only = true\)/i);
  assert.match(sql,/revoke all on public\.cfi_market_decision_settlements from anon, authenticated/i);
});
