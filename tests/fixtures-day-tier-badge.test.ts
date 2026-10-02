import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../cloudflare-worker/src/index-gpt-core-v5.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent',external:['cloudflare:*']});
const worker:any=(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;
const env:any={CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'k',SUPABASE_SERVICE_KEY:'svc'};
const ctx:any={waitUntil(){},passThroughOnException(){}};
const day='2099-01-02';
const fx=(i:number,home:string,away:string,away_id:string|null)=>({provider:'CFI_LIVESCORE',providerId:'p'+i,home,away,competition:'L',targetDate:day,kickoffIso:`${day}T1${i}:00:00.000Z`,kickoffLocal:`1${i}:00`,status:'SCHEDULED',canonicalHomeTeamId:'h'+i,canonicalAwayTeamId:away_id});
const rows=[fx(0,'Gor Mahia','KCB',null),fx(1,'Kungsaengens IF','Sunnersta AIF','a1'),fx(2,'Big FC','Large FC','a2')];
const evidence=[{canonical_name:'Gor Mahia',evidence_count:5},{canonical_name:'Kungsaengens IF',evidence_count:2},{canonical_name:'Sunnersta AIF',evidence_count:1},{canonical_name:'Big FC',evidence_count:10},{canonical_name:'Large FC',evidence_count:9}];
async function list(t:any,rpc:any){t.mock.method(globalThis,'fetch',async(u:any)=>{const s=String(u);if(s.includes('/cfi-db/fixtures-day'))return Response.json({status:'OK',version:'CFI_DB_FIXTURES_DAY_V2_AISCORE_BRIDGE',rows});if(s.includes('/rest/v1/rpc/teams_evidence_batch'))return rpc();return new Response('Div,Date,Time,HomeTeam,AwayTeam\n')});const r=await worker.fetch(new Request('https://cfi.test/api/fixtures-day',{method:'POST',body:JSON.stringify({target_date:day,timezone:'Asia/Ho_Chi_Minh'})}),env,ctx);assert.equal(r.status,200);return ((await r.json()) as any).rows}
test('badge matches predict ability: unresolved team is C0, thin evidence is C, enough is A',async t=>{
  const out=await list(t,()=>Response.json(evidence));
  const tier=(h:string)=>out.find((x:any)=>x.home===h)?.tier;
  assert.equal(tier('Gor Mahia'),'C0');
  assert.equal(tier('Kungsaengens IF'),'C');
  assert.equal(tier('Big FC'),'A');
});
