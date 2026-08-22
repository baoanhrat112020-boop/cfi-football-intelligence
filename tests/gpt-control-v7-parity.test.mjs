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

test('audit 3d is source-controlled with hard scope semantics',()=>{
  assert.match(src,/action==="AUDIT_3D"/);
  assert.match(src,/LATEST_3_DISTINCT_PREDICTION_DATES/);
  assert.match(src,/\.slice\(0,3\)/);
  assert.match(src,/syntheticExcluded:true/);
  assert.match(src,/antiLeakage:true/);
  assert.match(src,/CFI E2E/);
  assert.match(src,/NONEXISTENT/);
});

test('worker exposes canonical audit route backed by gpt control',()=>{
  assert.match(worker,/\/api\/audit-3d/);
  assert.match(worker,/callControl\(env,'AUDIT_3D'/);
  assert.match(worker,/audit3d:true/);
});
