import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEPENDENT_AI_AUDIT_CONTRACT,
  evaluateIndependentAiPromotionGate,
} from '../research/independent-ai-promotion-gate.mjs';

const passAudit={
  contract:INDEPENDENT_AI_AUDIT_CONTRACT,
  verdict:'PASS',
  promotionAllowed:true,
  decisionUse:false,
  productionMutationAllowed:false,
};

test('promotion gate fails closed when independent AI audit is missing',()=>{
  const r=evaluateIndependentAiPromotionGate(null);
  assert.equal(r.pass,false);
  assert.equal(r.status,'BLOCK_PROMOTION');
  assert.equal(r.reason,'INDEPENDENT_AI_AUDIT_REQUIRED');
});

test('promotion gate rejects non-PASS AI verdicts',()=>{
  for(const verdict of ['FIX_REQUIRED','BLOCK_PROMOTION']){
    const r=evaluateIndependentAiPromotionGate({...passAudit,verdict,promotionAllowed:false});
    assert.equal(r.pass,false);
    assert.equal(r.status,'BLOCK_PROMOTION');
    assert.equal(r.promotionAllowed,false);
  }
});

test('promotion gate rejects AI audit that can mutate production',()=>{
  const r=evaluateIndependentAiPromotionGate({...passAudit,productionMutationAllowed:true});
  assert.equal(r.pass,false);
  assert.equal(r.reason,'INDEPENDENT_AI_AUDIT_ISOLATION_INVALID');
});

test('promotion gate accepts only explicit isolated PASS audit',()=>{
  const r=evaluateIndependentAiPromotionGate(passAudit);
  assert.equal(r.pass,true);
  assert.equal(r.status,'PASS');
  assert.equal(r.promotionAllowed,true);
  assert.equal(r.decisionUse,false);
  assert.equal(r.productionMutationAllowed,false);
});
