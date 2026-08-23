import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('supabase/functions/cfi-gpt-control/index.ts','utf8');
const worker=fs.readFileSync('cloudflare-worker/src/index-v47.ts','utf8');

test('gpt control keeps custom key auth before service-role client creation',()=>{
  const auth=src.indexOf('req.headers.get("x-cfi-key")!==expectedKey');
  const service=src.indexOf('SUPABASE_SERVICE_ROLE_KEY');
  assert.ok(auth>=0 && service>auth);
  assert.match(src,/UNAUTHORIZED/);
});

test('audit 3d is source-controlled with hard scope semantics and fail-closed provenance',()=>{
  for(const token of ['AUDIT_3D','LATEST_3_DISTINCT_PREDICTION_DATES','cfi_prediction_snapshots','strictPriorAudit','temporalEvidenceAudit','futureEvidenceCount','sameDateEvidenceCount','maxEvidenceDate','AUDIT_UNVERIFIED','failClosed:true','CFI E2E','NONEXISTENT']) assert.ok(src.includes(token),`missing ${token}`);
  assert.match(src,/\.slice\(0,3\)/);
  assert.match(src,/syntheticExcluded:true/);
  assert.match(src,/const antiLeakage=scoped\.length>0&&unverified\.length===0/);
  assert.match(src,/maxEvidenceDate<target/);
  assert.match(src,/strictAudit\?\.verified===true/);
  assert.match(src,/temporal\?\.verified===true/);
  assert.match(src,/if\(!dates\.length\)return \{status:"AUDIT_EMPTY"[\s\S]*?antiLeakage:false/);
  assert.doesNotMatch(src,/antiLeakage:true/,'antiLeakage must never be a hard-coded success assertion');
});

test('worker exposes canonical audit route backed by gpt control',()=>{
  assert.match(worker,/\/api\/audit-3d/);
  assert.match(worker,/callControl\(env,'AUDIT_3D'/);
  assert.match(worker,/audit3d:true/);
});
