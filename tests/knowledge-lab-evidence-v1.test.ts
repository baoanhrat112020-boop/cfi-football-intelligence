import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCrossTaskLeakage,evaluateAgenticToolPolicy,evaluateHorizonDistillation} from '../src/prediction/knowledge-lab-evidence-v1.ts';

test('K044 fail-closes without enough date-gated rows',()=>{
  const r=evaluateCrossTaskLeakage([{outcome:1,strictPrior:true,targetDate:'2026-01-02',maxEvidenceDate:'2026-01-01',baselineProbability:.5,visibleProbability:.7}]);
  assert.equal(r.shadowEligible,false);
  assert.equal(r.productionEligible,false);
  assert.equal(r.decisionUse,false);
  assert.equal(r.baselineLock,'R0_IMMUTABLE');
  assert.ok(r.hardFailures.includes('MIN_30_DATE_GATED_ROWS_REQUIRED'));
});

test('K044 only becomes shadow eligible on real-form positive visibility uplift contract',()=>{
  const rows=Array.from({length:40},(_,i)=>({outcome:i%2,strictPrior:true,targetDate:'2026-02-02',maxEvidenceDate:'2026-02-01',baselineProbability:.5,visibleProbability:i%2?.8:.2}));
  const r=evaluateCrossTaskLeakage(rows);
  assert.equal(r.shadowEligible,true);
  assert.equal(r.verdict,'LEAKAGE_RISK_VALIDATED');
  assert.equal(r.productionEligible,false);
});

test('K045 forbids unmatured reward and tool-budget violations',()=>{
  const rows=Array.from({length:30},(_,i)=>({outcome:i%2,strictPrior:true,targetDate:'2026-03-02',maxEvidenceDate:'2026-03-01',baselineProbability:.5,candidateProbability:.4,outcomeMatured:i!==0,toolCalls:i===1?3:1,toolBudget:2}));
  const r=evaluateAgenticToolPolicy(rows);
  assert.equal(r.shadowEligible,false);
  assert.ok(r.hardFailures.includes('UNMATURED_OUTCOME_REWARD_FORBIDDEN'));
  assert.ok(r.hardFailures.includes('TOOL_BUDGET_VIOLATION'));
});

test('K046 requires frozen teacher/student and both horizons',()=>{
  const rows=Array.from({length:30},(_,i)=>({outcome:i%2,strictPrior:true,targetDate:'2026-04-02',maxEvidenceDate:'2026-04-01',teacherProbability:i%2?.7:.3,studentProbability:i%2?.69:.31,teacherFrozen:true,studentFrozen:true,horizon:(i%2?'HT':'FT') as 'HT'|'FT',weight:i%2?1.5:1}));
  const r=evaluateHorizonDistillation(rows);
  assert.equal(r.shadowEligible,true);
  assert.equal(r.productionEligible,false);
  assert.equal(r.decisionUse,false);
  assert.equal(r.baselineLock,'R0_IMMUTABLE');
});
