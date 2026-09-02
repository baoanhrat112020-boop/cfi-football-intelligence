import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

const bundleDir=mkdtempSync(join(tmpdir(),'cfi-audit3d-route-e2e-'));
const build=process.platform==='win32'
  ? spawnSync('cmd.exe',['/d','/s','/c','npx','wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'})
  : spawnSync('npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
assert.equal(build.status,0,`Wrangler bundle failed:\n${build.stdout}\n${build.stderr}`);
function jsFiles(dir:string):string[]{const out:string[]=[];for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())out.push(...jsFiles(path));else if(/\.(?:m?js)$/.test(entry.name))out.push(path);}return out;}
const candidates=jsFiles(bundleDir).sort((a,b)=>statSync(b).size-statSync(a).size);
assert.ok(candidates.length>0,`Wrangler produced no importable JS module in ${bundleDir}`);
const {default:worker}=await import(`${pathToFileURL(candidates[0]).href}?v=${Date.now()}`);
process.on('exit',()=>{try{rmSync(bundleDir,{recursive:true,force:true});}catch{}});
const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;

test('production bundle GET /api/audit-3d forwards AUDIT_3D to cfi-gpt-control',async()=>{
  const original=globalThis.fetch;
  let observedUrl='';let observedBody:any=null;let observedKey='';
  globalThis.fetch=async(input:any,init:any)=>{
    observedUrl=typeof input==='string'?input:String(input?.url??input);
    observedBody=JSON.parse(String(init?.body??'{}'));
    observedKey=String(init?.headers?.['x-cfi-key']??'');
    return Response.json({status:'AUDIT_UNVERIFIED',action:'AUDIT_3D',antiLeakage:false,antiLeakageAudit:{verified:false,failClosed:true}},{status:200});
  };
  try{
    const req=new Request('https://cfi.example/api/audit-3d?limit=3');
    const res=await worker.fetch(req,{CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'secret'} as any,ctx);
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
