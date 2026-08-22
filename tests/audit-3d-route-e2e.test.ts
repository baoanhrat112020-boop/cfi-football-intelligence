import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/src/index-v55.ts';

test('GET /api/audit-3d forwards AUDIT_3D to cfi-gpt-control',async()=>{
  const original=globalThis.fetch;
  let observedUrl='';let observedBody:any=null;let observedKey='';
  globalThis.fetch=async(input:any,init:any)=>{
    observedUrl=String(input);
    observedBody=JSON.parse(String(init?.body??'{}'));
    observedKey=String(init?.headers?.['x-cfi-key']??'');
    return Response.json({status:'AUDIT_UNVERIFIED',action:'AUDIT_3D',antiLeakage:false,antiLeakageAudit:{verified:false,failClosed:true}},{status:200});
  };
  try{
    const req=new Request('https://cfi.example/api/audit-3d?limit=3');
    const res=await worker.fetch(req,{CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'secret'} as any,{} as any);
    const body:any=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.action,'AUDIT_3D');
    assert.equal(body.antiLeakage,false);
    assert.match(observedUrl,/\/cfi-gpt-control$/);
    assert.equal(observedBody.action,'AUDIT_3D');
    assert.equal(observedBody.limit,3);
    assert.equal(observedKey,'secret');
  } finally { globalThis.fetch=original; }
});
