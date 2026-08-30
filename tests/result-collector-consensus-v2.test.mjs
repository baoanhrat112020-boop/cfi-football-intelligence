import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/cfi-result-collector/index.ts', import.meta.url), 'utf8');

test('result collector v2 makes ESPN supporting-only and requires dual-primary exact consensus', () => {
  assert.match(src, /policy:\"CFI_RESULT_CONSENSUS_V2\"/);
  assert.match(src, /primary:\[\"SOFASCORE\",\"FLASHSCORE\"\]/);
  assert.match(src, /supportingOnly:\[\"ESPN\"\]/);
  assert.match(src, /settlementRequires:\"EXACT_HT_FT_CONSENSUS_OF_BOTH_PRIMARY_SOURCES\"/);
  assert.match(src, /ESPN_SUPPORTING_ONLY_NO_SETTLEMENT_DETAIL/);
  assert.match(src, /pick\(s,listing\.events,\"SOFASCORE\"\)/);
  assert.match(src, /pick\(s,listing\.events,\"FLASHSCORE\"\)/);
  assert.match(src, /if\(key\(rs\[0\]\)!==key\(rs\[1\]\)\)/);
  assert.match(src, /reason:\"PRIMARY_SCORE_CONFLICT\"/);
  assert.match(src, /reason:\"PRIMARY_CONSENSUS_INCOMPLETE\"/);
  assert.match(src, /p_source_label:`CONSENSUS:SOFASCORE:/);
  assert.doesNotMatch(src, /p_source_label:`\$\{[^}]*source[^}]*\}_EVENT:/);
});

test('ESPN evidence is audit-only and never resolved through settlement detail', () => {
  assert.match(src, /authority:\"SUPPORTING_ONLY\"/);
  assert.match(src, /function espnSupport/);
  assert.match(src, /if\(ev\.source===\"ESPN\"\)throw new Error\(\"ESPN_SUPPORTING_ONLY_NO_SETTLEMENT_DETAIL\"\)/);
  assert.match(src, /verification_method:\"PRIMARY_DUAL_SOURCE_EXACT_CONSENSUS\"/);
});
