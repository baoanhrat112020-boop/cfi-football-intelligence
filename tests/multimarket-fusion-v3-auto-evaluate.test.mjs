import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auto=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_fusion_v3_auto_evaluate_v1.sql',import.meta.url),'utf8');
const prospective=fs.readFileSync(new URL('../supabase/sql/cfi_multimarket_fusion_v3_prospective_v1.sql',import.meta.url),'utf8');

test('Fusion V3 auto evaluator is research-only and cannot promote production',()=>{
  assert.match(auto,/CFI_MULTI_MARKET_FUSION_V3_AUTO_EVALUATE_V1/);
  assert.match(auto,/automaticPromotion',false/);
  assert.match(auto,/productionPromotion',false/);
  assert.match(auto,/decisionUse',false/);
  assert.match(auto,/AUTO_EVALUATE_ONLY_EXPLICIT_PROMOTION_REQUIRED/);
  assert.doesNotMatch(auto,/decision_use\s*=\s*true/i);
  assert.doesNotMatch(auto,/productionEligible\s*=\s*true/i);
  assert.doesNotMatch(auto,/decisionUse\s*[:=]\s*true/i);
});

test('Fusion V3 prospective sample size is fixture-distinct, not snapshot-counted',()=>{
  assert.match(prospective,/One prospective decision per canonical matchup\/date/);
  assert.match(prospective,/s\.target_date=new\.target_date/);
  assert.match(prospective,/s\.home_team=new\.home_team/);
  assert.match(prospective,/s\.away_team=new\.away_team/);
  assert.match(prospective,/count\(distinct \(s\.target_date,s\.home_team,s\.away_team\)\)/);
  assert.match(prospective,/distinct on \(s\.target_date,s\.home_team,s\.away_team\)/);
  assert.match(prospective,/locked-OOS sample size/);
});

test('Fusion V3 trial remains fail-closed at 200 distinct settled fixtures',()=>{
  assert.match(prospective,/min_settled_samples integer not null default 200/);
  assert.match(prospective,/min_settled_samples >= 200/);
  assert.match(prospective,/READY_FOR_PROMOTION_GATE/);
  assert.match(prospective,/lockedOosPass',n>=t\.min_settled_samples/);
  assert.match(prospective,/reconstructed',false/);
  assert.match(prospective,/predictionHistoryReplay',false/);
});
