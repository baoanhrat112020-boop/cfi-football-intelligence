import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAssociatedMergedPr } from '../tools/cfi-resolve-associated-pr.mjs';

test('selects most recently merged associated PR with valid head SHA',()=>{
  const old={number:1,merged_at:'2026-09-01T00:00:00Z',head:{sha:'a'.repeat(40)}};
  const recent={number:2,merged_at:'2026-09-02T00:00:00Z',head:{sha:'b'.repeat(40)}};
  assert.equal(selectAssociatedMergedPr([old,recent])?.number,2);
});

test('falls back to a valid associated PR when merged timestamp is absent',()=>{
  const pr={number:3,merged_at:null,head:{sha:'c'.repeat(40)}};
  assert.equal(selectAssociatedMergedPr([pr])?.number,3);
});

test('ignores malformed entries and fails closed when no valid PR remains',()=>{
  assert.equal(selectAssociatedMergedPr([]),null);
  assert.equal(selectAssociatedMergedPr([{number:4,merged_at:'2026-09-02T00:00:00Z',head:{sha:'bad'}}]),null);
  const valid={number:5,merged_at:null,head:{sha:'d'.repeat(40)}};
  assert.equal(selectAssociatedMergedPr([{number:null,head:{sha:'e'.repeat(40)}},valid])?.number,5);
});
