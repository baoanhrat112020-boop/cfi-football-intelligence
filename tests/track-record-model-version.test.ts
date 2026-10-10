import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../cloudflare-worker/src/index-gpt-core-v5.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent'});
const worker:any=(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;
const env:any={CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'k',SUPABASE_SERVICE_KEY:'svc'};
const ctx:any={waitUntil(){},passThroughOnException(){}};
async function call(t:any,qs:string){
  const bodies:any[]=[];
  t.mock.method(globalThis,'fetch',async(u:any,init:any)=>{
    if(String(u).includes('/rest/v1/rpc/cfi_suggest_track_record')){bodies.push(JSON.parse(init.body));return Response.json({counts:{scored:0},by_top_market:[],recent_settled:[]})}
    return new Response('unexpected',{status:500});
  });
  const res=await worker.fetch(new Request('https://w.example/api/track-record'+qs),env,ctx);
  return {res,bodies};
}
test('track-record without model_version sends no p_model_version',async t=>{
  const {res,bodies}=await call(t,'?days=all');
  assert.equal(res.status,200);
  assert.equal(bodies.length,1);
  assert.equal('p_model_version' in bodies[0],false);
});
test('track-record forwards a valid model_version as p_model_version',async t=>{
  for(const v of ['v1_ht045','v2_ht050','v3_dynamic']){
    const {res,bodies}=await call(t,'?days=all&model_version='+v);
    assert.equal(res.status,200);
    assert.equal(bodies[0].p_model_version,v);
    t.mock.restoreAll();
  }
});
test('track-record rejects an unknown model_version with 400 and does not call the database',async t=>{
  const {res,bodies}=await call(t,'?days=all&model_version=xxx');
  assert.equal(res.status,400);
  assert.deepEqual(await res.json(),{error:'invalid model_version'});
  assert.equal(bodies.length,0);
});
