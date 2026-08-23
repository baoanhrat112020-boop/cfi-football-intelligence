import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_verified_fixture_bridge_v1.sql',import.meta.url),'utf8');

test('prospective market snapshots reference verified living fixtures without polluting historical fixtures',()=>{
  assert.match(sql,/add column if not exists verified_fixture_id uuid null references public\.cfi_living_verified_fixtures\(fixture_id\)/i);
  assert.match(sql,/alter column fixture_id drop not null/i);
  assert.match(sql,/num_nonnulls\(fixture_id, verified_fixture_id\) = 1/i);
  assert.match(sql,/CFI_VERIFIED_FIXTURE_REQUIRED/);
  assert.match(sql,/CFI_MARKET_KICKOFF_MISMATCH/);
  assert.match(sql,/CFI_MARKET_CAPTURE_MUST_PRECEDE_KICKOFF/);
  assert.doesNotMatch(sql,/insert\s+into\s+public\.fixtures/i);
});

test('prospective settlement inherits exactly one immutable fixture reference',()=>{
  assert.match(sql,/alter table public\.cfi_market_decision_settlements[\s\S]*verified_fixture_id/i);
  assert.match(sql,/cfi_market_settlement_exactly_one_fixture_ref/i);
  assert.match(sql,/num_nonnulls\(m_fixture,m_verified_fixture\) <> 1/i);
  assert.match(sql,/new\.verified_fixture_id is distinct from m_verified_fixture/i);
  assert.match(sql,/CFI_SETTLEMENT_MUST_FOLLOW_KICKOFF/);
  assert.match(sql,/CFI_RESULT_PROVENANCE_REQUIRED/);
});

test('bridge remains research-only and backward compatible',()=>{
  assert.match(sql,/historical fixture_id path remains backward compatible/i);
  assert.match(sql,/revoke execute on function public\.cfi_market_snapshot_verified_fixture_guard\(\) from public, anon, authenticated/i);
  assert.match(sql,/future schedules are never inserted into historical BigDB/i);
});
