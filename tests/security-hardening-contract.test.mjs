import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auditSource=readFileSync(new URL('../supabase/functions/cfi-prediction-audit/index.ts',import.meta.url),'utf8');
const v50=readFileSync(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/sql/cfi_security_hardening_v1.sql',import.meta.url),'utf8');

test('prediction audit refuses snapshots unless temporal strict-prior provenance is verified',()=>{
  assert.match(auditSource,/STRICT_PRIOR_NOT_VERIFIED/);
  assert.match(auditSource,/audit\?\.verified === true/);
  assert.match(auditSource,/future === 0/);
  assert.match(auditSource,/same === 0/);
  assert.match(auditSource,/maxEvidenceDate < targetDate/);
  assert.match(auditSource,/p_strict_prior: true/);
  assert.doesNotMatch(auditSource,/evidence\?\.strictPrior !== false/);
});

test('prematch worker verifies temporal and exact-team evidence before recordAudit',()=>{
  const temporalAt=v50.indexOf('const temporal=temporalEvidenceAudit(big,targetDate)');
  const exactAt=v50.indexOf('const exact=exactTeamEvidenceAudit(big)');
  const recordAt=v50.indexOf('const audit=await recordAudit');
  assert.ok(exactAt>=0&&temporalAt>exactAt&&recordAt>temporalAt);
  assert.match(v50,/STRICT_PRIOR_GATE_ERROR/);
  assert.match(v50,/SCORE_EVIDENCE_REQUIRED/);
  assert.match(v50,/audit:\{status:'SKIPPED',reason:'STRICT_PRIOR_NOT_VERIFIED'\}/);
});

test('database hardening removes browser-role access to privileged CFI definer seams',()=>{
  assert.match(sql,/revoke execute on function %s from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function %s to service_role/i);
  assert.match(sql,/security_invoker = true/i);
  assert.match(sql,/revoke all on table public\.cfi_prediction_history from anon, authenticated/i);
  assert.match(sql,/revoke all on table public\.cfi_prediction_audit_summary from anon, authenticated/i);
});
