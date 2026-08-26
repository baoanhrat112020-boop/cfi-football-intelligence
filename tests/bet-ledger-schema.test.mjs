import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../supabase/sql/cfi_user_bet_ledger_v1.sql',import.meta.url),'utf8');

test('user bet ledger is append-only, explicit-confirmation-only, and isolated from model evidence',()=>{
  assert.match(sql,/create table if not exists public\.cfi_user_bets/i);
  assert.match(sql,/confirmed_by_user boolean not null default true check \(confirmed_by_user = true\)/i);
  assert.match(sql,/create table if not exists public\.cfi_user_bet_settlements/i);
  assert.match(sql,/cfi_user_bet_immutable_guard/);
  assert.match(sql,/before update or delete on public\.cfi_user_bets/i);
  assert.match(sql,/before update or delete on public\.cfi_user_bet_settlements/i);
  assert.match(sql,/result_provenance jsonb not null/i);
  assert.match(sql,/end as status/i);
  assert.match(sql,/revoke all on public\.cfi_user_bets from anon, authenticated/i);
  assert.match(sql,/never places a wager or feeds model training/i);
});

test('user bet ledger constrains market-family and champion period semantics',()=>{
  assert.match(sql,/cfi_user_bets_selection_family/);
  assert.match(sql,/cfi_user_bets_champion_period/);
  assert.match(sql,/market_family not in \('OVER_UNDER','ASIAN_HANDICAP'\) or line is not null/i);
});
