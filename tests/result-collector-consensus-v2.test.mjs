import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/cfi-result-collector/index.ts', import.meta.url), 'utf8');

test('collector keeps FotMob plus exact secondary-source HT/FT consensus authority', () => {
  assert.match(src, /CFI_RESULT_CONSENSUS_V7_FREE_FALLBACK/);
  assert.match(src, /PRIMARY=\["FOTMOB","FLASHSCORE_OR_FOOTBALL_DATA"\]/);
  assert.match(src, /SUPPORTING=\["ESPN","THESPORTSDB"\]/);
  assert.match(src, /STRICT_PRE_KICKOFF_PLUS_EXACT_HT_FT_CONSENSUS_OF_FOTMOB_AND_\(FLASHSCORE_OR_FOOTBALL_DATA\)/);
  assert.match(src, /if\(flp\.status==="MISSING"\).*?FOOTBALL_DATA/s);
  assert.match(src, /if\(key\(rs\[0\]\)!==key\(rs\[1\]\)\)/);
  assert.match(src, /reason:"PRIMARY_SCORE_CONFLICT"/);
  assert.match(src, /reason:"PRIMARY_CONSENSUS_INCOMPLETE"/);
  assert.match(src, /verificationMethod:"PRIMARY_DUAL_SOURCE_EXACT_CONSENSUS_V7"/);
  assert.match(src, /p_source_label:`CONSENSUS:FOTMOB:/);
});

test('old Flashscore fixtures resolve only from provenance event id then direct detail', () => {
  assert.match(src, /CANONICAL_PROVENANCE_EVENT_ID_ONLY/);
  assert.match(src, /FLASHSCORE_EVENT:\(\[A-Za-z0-9\]\+\)/);
  assert.match(src, /df_sui_1_\$\{ev\.id\}/);
  assert.match(src, /dc_1_\$\{ev\.id\}/);
  assert.match(src, /FLASHSCORE_DETAIL_PERIOD_BLOCKS/);
  assert.match(src, /x\.DA==="3"&&x\.DB==="3"/);
  assert.match(src, /FLASHSCORE_DAY_FEED_UNAVAILABLE/);
});

test('old FotMob fixtures resolve by GMT+7 date and deduped search match id', () => {
  assert.match(src, /Asia\/Ho_Chi_Minh/);
  assert.match(src, /api\/data\/search\/suggest/);
  assert.match(src, /const uniq=new Map<string,any>\(\)/);
  assert.match(src, /SEARCH_SUGGEST_LOCAL_DATE/);
  assert.match(src, /api\/data\/matchDetails\?matchId=/);
});

test('FotMob HT parser prefers explicit halftime marker and supports array scores', () => {
  assert.match(src, /FOTMOB_MATCH_DETAIL_HALFTIME_MARKER/);
  assert.match(src, /halfStrShort/);
  assert.match(src, /halftime_short/);
  assert.match(src, /Array\.isArray\(arr\)/);
  assert.match(src, /FOTMOB_MATCH_DETAIL_GOAL_EVENTS_LE45/);
});

test('external kickoff is authoritative for settlement temporal eligibility', () => {
  assert.match(src, /strict_prior!==true/);
  assert.match(src, /STRICT_PRIOR_FLAG_REQUIRED/);
  assert.match(src, /kickoffMs=Date\.parse/);
  assert.match(src, /createdMs=Date\.parse/);
  assert.match(src, /reason:"PRIMARY_KICKOFF_UNVERIFIED"/);
  assert.match(src, /createdMs>=kickoffMs/);
  assert.match(src, /reason:"POST_KICKOFF_SNAPSHOT"/);
});

test('verifyOnly cannot mutate actuals or run settlement', () => {
  assert.match(src, /if\(verifyOnly\)\{verified\+\+/);
  assert.match(src, /if\(!verifyOnly&&verified>0\)/);
  assert.match(src, /if\(!verifyOnly\)await db\.from\("cfi_result_collector_runs"\)/);
});
