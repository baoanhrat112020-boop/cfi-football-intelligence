import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT,
  parseStructuredAudit,
  normalizeAudit,
  evaluateReviewCorpus,
} from '../tools/cfi-independent-ai-auditor.mjs';

const passBlock=`
Review summary.
CFI_AI_AUDIT_V1
VERDICT: PASS
HIGHEST_SEVERITY: NONE
STRICT_PRIOR: PASS
SETTLEMENT_INTEGRITY: PASS
SHADOW_ISOLATION: PASS
MULTI_MARKET: PASS
ARCHITECTURE: PASS
TEST_EVIDENCE: PASS
END_CFI_AI_AUDIT_V1
`;

test('independent AI audit accepts only complete structured PASS evidence',()=>{
  const parsed=parseStructuredAudit(passBlock);
  assert.equal(parsed.valid,true);
  const result=normalizeAudit(parsed);
  assert.equal(result.contract,CONTRACT);
  assert.equal(result.verdict,'PASS');
  assert.equal(result.promotionAllowed,true);
  assert.equal(result.decisionUse,false);
  assert.equal(result.productionMutationAllowed,false);
});

test('missing structured verdict blocks promotion fail-closed',()=>{
  const result=normalizeAudit(parseStructuredAudit('Looks good to me.'));
  assert.equal(result.verdict,'BLOCK_PROMOTION');
  assert.equal(result.promotionAllowed,false);
  assert.equal(result.reason,'STRUCTURED_VERDICT_MISSING');
});

test('strict-prior failure overrides an AI-declared PASS',()=>{
  const parsed=parseStructuredAudit(passBlock.replace('STRICT_PRIOR: PASS','STRICT_PRIOR: FAIL'));
  const result=normalizeAudit(parsed);
  assert.equal(result.declaredVerdict,'PASS');
  assert.equal(result.verdict,'BLOCK_PROMOTION');
  assert.match(result.reason,/STRICT_PRIOR:FAIL/);
});

test('P1 severity overrides FIX_REQUIRED or PASS into BLOCK_PROMOTION',()=>{
  const parsed=parseStructuredAudit(passBlock.replace('HIGHEST_SEVERITY: NONE','HIGHEST_SEVERITY: P1'));
  const result=normalizeAudit(parsed);
  assert.equal(result.verdict,'BLOCK_PROMOTION');
  assert.match(result.reason,/HIGH_SEVERITY:P1/);
});

test('non-critical unknown evidence requires fixes but does not silently pass',()=>{
  const parsed=parseStructuredAudit(passBlock.replace('ARCHITECTURE: PASS','ARCHITECTURE: UNKNOWN'));
  const result=normalizeAudit(parsed);
  assert.equal(result.verdict,'FIX_REQUIRED');
  assert.equal(result.promotionAllowed,false);
});

test('latest valid AI evidence wins for the audited head corpus',()=>{
  const older=passBlock.replace('VERDICT: PASS','VERDICT: FIX_REQUIRED').replace('HIGHEST_SEVERITY: NONE','HIGHEST_SEVERITY: P2');
  const result=evaluateReviewCorpus([
    {source:'COPILOT_REVIEW',id:1,createdAt:'2026-09-02T01:00:00Z',body:older,url:'https://example.test/1'},
    {source:'COPILOT_REVIEW',id:2,createdAt:'2026-09-02T02:00:00Z',body:passBlock,url:'https://example.test/2'},
  ]);
  assert.equal(result.verdict,'PASS');
  assert.equal(result.evidence.id,2);
});

test('incomplete structured block cannot be treated as approval',()=>{
  const parsed=parseStructuredAudit(`CFI_AI_AUDIT_V1\nVERDICT: PASS\nEND_CFI_AI_AUDIT_V1`);
  assert.equal(parsed.valid,false);
  assert.match(parsed.reason,/STRUCTURED_FIELDS_MISSING/);
  assert.equal(normalizeAudit(parsed).verdict,'BLOCK_PROMOTION');
});
