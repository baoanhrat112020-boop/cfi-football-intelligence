import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

const TARGET_DATE='2026-08-22';
const PROD_HOST='cfi-football-intelligence.baoanhrat112020.workers.dev';
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-gpt-core-v4-'));
const build=process.platform==='win32'
  ? spawnSync('cmd.exe',['/d','/s','/c','npx','wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'})
  : spawnSync('npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
assert.equal(build.status,0,`Wrangler bundle failed:\n${build.stdout}\n${build.stderr}`);
function jsFiles(dir:string):string[]{const out:string[]=[];for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())out.push(...jsFiles(path));else if(/\.(?:m?js)$/.test(entry.name))out.push(path);}return out;}
const candidates=jsFiles(bundleDir).sort((a,b)=>statSync(b).size-statSync(a).size);
assert.ok(candidates.length>0,'Wrangler produced no importable JS module');
const {default:router}=await import(`${pathToFileURL(candidates[0]).href}?v=${Date.now()}`);
process.on('exit',()=>{try{rmSync(bundleDir,{recursive:true,force:true});}catch{}});

const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;
const env={CFI_DB_BASE_URL:'https://example.test/functions/v1/cfi-db',CFI_DB_KEY:'test-key'};

function bigDbBody(home:string,away:string){
  const rows=Array.from({length:44},(_,i)=>{const homeSide=i<22;return{id:`gpt-v4-${i}`,matchDate:`2026-07-${String((i%28)+1).padStart(2,'0')}`,homeTeam:homeSide?home:`Opp ${i}`,awayTeam:homeSide?`Opp ${i}`:away,ht:i%3===0?'2-1':i%3===1?'1-0':'0-1',ft:i%4===0?'4-2':i%4===1?'2-1':i%4===2?'1-2':'3-2'};});
  return{status:'OK',version:'CFI_BIG_DB_RETRIEVAL_V2.1.2',targetDate:TARGET_DATE,identity:{homeTeamId:`id-${home}`,awayTeamId:`id-${away}`,homeCanonical:home,awayCanonical:away},exactTeam:{home:{retrieved:22},away:{retrieved:22},h2h:{retrieved:0}},fixtures:{home:rows.slice(0,22),away:rows.slice(22),h2h:[]},globalPrior:{fixtureCount:100,markets:{}},temporalAudit:{targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-07-28',exactTeamMaxEvidenceDate:'2026-07-28',globalPriorMaxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0}};
}

async function withMockFetch<T>(run:(calls:{discoveryFeed:number})=>Promise<T>){
  const original=globalThis.fetch;const calls={discoveryFeed:0};
  globalThis.fetch=async(input:any,init?:any)=>{const url=typeof input==='string'?input:String(input?.url??input);const bodyText=typeof init?.body==='string'?init.body:typeof input?.body==='string'?input.body:null;let parsed:any={};try{parsed=bodyText?JSON.parse(bodyText):{}}catch{}if(url.includes('cfi-discovery-feed')){calls.discoveryFeed++;throw new Error('SUPPLIED_MODE_MUST_NOT_CALL_DISCOVERY_FEED');}if(url.includes('cfi-bigdb-retrieval'))return Response.json(bigDbBody(String(parsed?.home??'Home'),String(parsed?.away??'Away'))) as any;if(url.includes('cfi-prediction-audit'))return Response.json({status:'RECORDED'}) as any;return Response.json({status:'OK',runtime:{},bigDbRetrieval:{}}) as any;};
  try{return await run(calls);}finally{globalThis.fetch=original;}
}

test('production-host direct predict returns compact GPT contract while preserving six-target and Fusion surfaces',async()=>{
  await withMockFetch(async()=>{
    const response=await router.fetch(new Request(`https://${PROD_HOST}/api/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:'Compact Home',away:'Compact Away',target_date:TARGET_DATE,language:'vi'})}),env,ctx);
    assert.equal(response.status,200);const body:any=await response.json();assert.equal(body.status,'SUCCESS');assert.equal(body.responseMeta?.contract,'CFI_GPT_PREDICT_COMPACT_V1');assert.equal(body.responseMeta?.mode,'compact');assert.equal(body.presentationContract?.contract,'CFI_2_METHODS_X_6_TARGETS_V2');assert.equal(body.sixTargetMatrix?.verification?.complete,true);assert.equal(body.consistencyGuard?.status,'PASS');assert.ok(body.multiMarketIntegration);assert.ok(body.championFusion,'Champion Fusion must remain visible in compact transport');assert.equal(body.championFusion?.decisionUse,false);assert.equal(Object.prototype.hasOwnProperty.call(body,'scoreline'),false,'raw top-level scoreline internals must be omitted from compact response');assert.ok(Number(body.responseMeta?.bytes)>0);assert.ok(Number(body.responseMeta?.bytes)<100000,`compact response too large: ${body.responseMeta?.bytes}`);
  });
});

test('supplied fixture discovery merges canonical feed and preserves single fallback owner',async()=>{
  await withMockFetch(async calls=>{
    const supplied=[{provider:'GPT_WEB_SEARCH',providerId:'supplied-a',home:'Supplied Home A',away:'Supplied Away A',competition:'Test',country:'Test',kickoffIso:'2026-08-22T12:00:00Z',status:'scheduled',sourceUrls:['https://example.com/a'],discoveredAt:'2026-08-22T00:00:00Z'},{provider:'GPT_WEB_SEARCH',providerId:'supplied-b',home:'Supplied Home B',away:'Supplied Away B',competition:'Test',country:'Test',kickoffIso:'2026-08-22T14:00:00Z',status:'scheduled',sourceUrls:['https://example.com/b'],discoveredAt:'2026-08-22T00:00:00Z'}];
    const response=await router.fetch(new Request('https://worker.test/api/discover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target_date:TARGET_DATE,timezone:'Asia/Ho_Chi_Minh',response_mode:'compact',max_matches:5,internal_provider_diagnostics:false,fixture_candidates:supplied})}),env,ctx);
    assert.equal(response.status,200);const body:any=await response.json();assert.ok(calls.discoveryFeed>=1,'canonical discovery feed must be consulted');assert.equal(body.search?.mode,'GPT_SEARCH_FIRST');assert.equal(body.search?.providerFallbackTriggered,true);assert.equal(body.search?.canonicalFeedOwnsProviderFallback,true);assert.equal(body.search?.workerProviderFallbackAllowed,false);assert.equal(body.rules?.providerFallbackOnShortfall,true);assert.equal(body.counts?.databaseFixtures,0);assert.equal(body.counts?.publicProviderFixtures,0);assert.ok(Number(body.counts?.fixturesDiscovered)<=supplied.length);assert.ok(Number(body.counts?.predictionAttempts)<=supplied.length);const allowed=new Set(supplied.map(row=>`${row.home} vs ${row.away}`));for(const row of body.board??[])assert.ok(allowed.has(row.match),`unexpected fixture added: ${row.match}`);
  });
});
