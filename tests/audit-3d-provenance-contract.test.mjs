import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/cfi-gpt-control/index.ts',import.meta.url),'utf8');

test('AUDIT_3D is source controlled and anti-leakage is fail-closed from immutable snapshot provenance',()=>{
  for(const token of ['AUDIT_3D','cfi_prediction_snapshots','strictPriorAudit','temporalEvidenceAudit','futureEvidenceCount','sameDateEvidenceCount','maxEvidenceDate','AUDIT_UNVERIFIED','failClosed:true']) assert.ok(source.includes(token),`missing ${token}`);
  assert.match(source,/const antiLeakage=scoped\.length>0&&unverified\.length===0/);
  assert.match(source,/maxEvidenceDate<target/);
  assert.match(source,/strictAudit\?\.verified===true/);
  assert.match(source,/temporal\?\.verified===true/);
  assert.match(source,/if\(!dates\.length\)return \{status:"AUDIT_EMPTY"[\s\S]*?antiLeakage:false/);
});
