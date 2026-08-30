import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/cfi-result-collector/index.ts', import.meta.url), 'utf8');

test('result collector v3 requires FotMob + Flashscore exact HT/FT consensus', () => {
  assert.match(src, /CFI_RESULT_CONSENSUS_V3/);
  assert.match(src, /PRIMARY=\["FOTMOB","FLASHSCORE"\]/);
  assert.match(src, /SUPPORTING=\["ESPN","THESPORTSDB","SOFASCORE"\]/);
  assert.match(src, /EXACT_HT_FT_CONSENSUS_OF_FOTMOB_AND_FLASHSCORE/);
  assert.match(src, /pick\(s,listing\.events,"FOTMOB"\)/);
  assert.match(src, /pick\(s,listing\.events,"FLASHSCORE"\)/);
  assert.match(src, /if\(key\(rs\[0\]\)!==key\(rs\[1\]\)\)/);
  assert.match(src, /reason:"PRIMARY_SCORE_CONFLICT"/);
  assert.match(src, /reason:"PRIMARY_CONSENSUS_INCOMPLETE"/);
  assert.match(src, /p_source_label:`CONSENSUS:FOTMOB:/);
});

test('blocked or weak sources cannot authorize settlement', () => {
  assert.match(src, /authority:"SUPPORTING_ONLY"/);
  assert.match(src, /SOFASCORE_DIAGNOSTIC_ONLY/);
  assert.match(src, /DIAGNOSTIC_ONLY_403_CHALLENGE/);
  assert.match(src, /if\(ev\.source==="FOTMOB"\)return fotmobDetail\(ev\)/);
  assert.match(src, /if\(ev\.source==="FLASHSCORE"\)return flashDetail\(ev\)/);
  assert.match(src, /SUPPORTING_ONLY_NO_SETTLEMENT_DETAIL/);
  assert.doesNotMatch(src, /CONSENSUS:ESPN/);
  assert.doesNotMatch(src, /CONSENSUS:THESPORTSDB/);
  assert.doesNotMatch(src, /CONSENSUS:SOFASCORE/);
});

test('FotMob HT evidence is derived from match-detail first-half goal events', () => {
  assert.match(src, /api\/data\/matches\?date=/);
  assert.match(src, /api\/data\/matchDetails\?matchId=/);
  assert.match(src, /FOTMOB_MATCH_DETAIL_GOAL_EVENTS_LE45/);
  assert.match(src, /m===null\|\|m>45/);
  assert.match(src, /FOTMOB_HT_DERIVATION_FAILED/);
});
