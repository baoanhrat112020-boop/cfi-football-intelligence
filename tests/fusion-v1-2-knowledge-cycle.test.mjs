import test from 'node:test';
import assert from 'node:assert/strict';
import { conformalQuantile, selectStrictPriorResiduals, buildRccpInterval } from '../research/fusion/rccp-uncertainty.mjs';
import { assessLeakageAdjustedGate } from '../research/fusion/leakage-adjusted-gate.mjs';
import { evaluateExternalModelRun } from '../research/external-model-promotion-gate.mjs';

test('RCCP residual selection is strictly prior and prefers local support',()=>{
  const rows=[];
  for(let i=0;i<120;i++) rows.push({market:'7+ FT',targetDate:`2026-07-${String((i%28)+1).padStart(2,'0')}`,regimeKey:'A',residual:.05+i/10000});
  rows.push({market:'7+ FT',targetDate:'2026-08-22',regimeKey:'A',residual:.99});
  const x=selectStrictPriorResiduals({rows,targetDate:'2026-08-22',regimeKey:'A',market:'7+ FT',minLocal:100});
  assert.equal(x.scope,'LOCAL');
  assert.equal(x.rows.some(r=>r.targetDate==='2026-08-22'),false);
});

test('RCCP falls back global when local support is insufficient',()=>{
  const rows=[{market:'Other FT',targetDate:'2026-08-01',regimeKey:'A',residual:.1},{market:'Other FT',targetDate:'2026-08-02',regimeKey:'B',residual:.2}];
  const x=selectStrictPriorResiduals({rows,targetDate:'2026-08-22',regimeKey:'A',market:'Other FT',minLocal:10});
  assert.equal(x.scope,'GLOBAL_FALLBACK');
  assert.equal(x.rows.length,2);
});

test('conformal interval uses finite-sample quantile and stays in probability bounds',()=>{
  const q=conformalQuantile([.01,.02,.03,.04,.05,.06,.07,.08,.09,.1],.1);
  assert.ok(q>=.09);
  const x=buildRccpInterval({probability:.97,residuals:[{residual:.1},{residual:.2},{residual:.3}],alpha:.1});
  assert.ok(x.lower>=0 && x.upper<=1);
});

test('external pretrained historical-only model requires matched clean control',()=>{
  const x=assessLeakageAdjustedGate({externalPretrainedModel:true,historicalOnly:true,matchedCleanControl:false,prospectiveUnseen:false});
  assert.equal(x.pass,false);
  assert.equal(x.reason,'EXTERNAL_MODEL_CLEAN_CONTROL_REQUIRED');
});

test('prospective unseen evidence satisfies external model leakage gate',()=>{
  const x=assessLeakageAdjustedGate({externalPretrainedModel:true,historicalOnly:false,matchedCleanControl:false,prospectiveUnseen:true});
  assert.equal(x.pass,true);
});

test('external model wrapper fails closed before leakage scoring without full Multi-Market input',()=>{
  const rows=[];
  for(let i=0;i<30;i++) rows.push({targetTimestamp:`2026-01-${String((i%28)+1).padStart(2,'0')}T12:00:00Z`,maxEvidenceTimestamp:'2025-12-31T12:00:00Z',probabilities:{a:i%2?0.95:0.05,b:i%3?0.9:0.1,c:i%4?0.85:0.15,d:i%5?0.8:0.2},actual:{a:i%2?1:0,b:i%3?1:0,c:i%4?1:0,d:i%5?1:0}});
  const r=evaluateExternalModelRun(rows,{markets:['a','b','c','d'],externalModelAudit:{externalPretrainedModel:true,historicalOnly:true,matchedCleanControl:false,prospectiveUnseen:false}});
  assert.equal(r.status,'FAIL_HARD_GATE');
  assert.equal(r.shadowEligible,false);
  assert.ok(r.hardFailures.includes('MULTIMARKET_EVALUATION_REQUIRED'));
  assert.equal(r.decisionUse,false);
});
