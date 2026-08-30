import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

const TARGET_DATE='2026-08-22';
const HOME='Cardiff';
const AWAY='Plymouth';
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-live-router-e2e-'));
const build=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
assert.equal(build.status,0,`Wrangler bundle failed:\n${build.stdout}\n${build.stderr}`);
function jsFiles(dir:string):string[]{const out:string[]=[];for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())out.push(...jsFiles(path));else if(/\.(?:m?js)$/.test(entry.name))out.push(path);}return out;}
const candidates=jsFiles(bundleDir).sort((a,b)=>statSync(b).size-statSync(a).size);
assert.ok(candidates.length>0,`Wrangler produced no importable JS module in ${bundleDir}`);
const {default:router}=await import(`${pathToFileURL(candidates[0]).href}?v=${Date.now()}`);
process.on('exit',()=>{try{rmSync(bundleDir,{recursive:true,force:true});}catch{}});
function historicalRows(){return Array.from({length:44},(_,index)=>({id:`fx-${index}`,matchDate:`2026-07-${String((index%28)+1).padStart(2,'0')}`,homeTeam:index%2?HOME:`Opponent ${index}`,awayTeam:index%2?`Opponent ${index}`:AWAY,ht:index%3===0?'1-1':'1-0',ft:index%4===0?'3-2':'2-1'}));}
function temporalAudit(overrides:any={}){return {targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-07-28',exactTeamMaxEvidenceDate:'2026-07-28',globalPriorMaxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0,...overrides};}
function bigDbBody(overrides:any={}){const rows=historicalRows();return {status:'OK',version:'CFI_BIG_DB_RETRIEVAL_V2.1.2',targetDate:TARGET_DATE,exactTeam:{home:{retrieved:21},away:{retrieved:21},h2h:{retrieved:2}},fixtures:{home:rows.slice(0,21),away:rows.slice(21,42),h2h:rows.slice(42)},globalPrior:{fixtureCount:100,markets:{}},temporalAudit:temporalAudit(),...overrides};}
const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;
const env={CFI_DB_BASE_URL:'https://example.test/functions/v1/cfi-db'};
function liveRequest(extra:any={}){return new Request('https://worker.test/api/predict-live',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:HOME,away:AWAY,target_date:TARGET_DATE,fixtureStatus:'LIVE',live:{minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:5,shotsOnTargetAway:3,dangerousAttacksHome:42,dangerousAttacksAway:31,redCardsHome:0,redCardsAway:0},...extra})});}
async function withBigDb(body:any,fn:()=>Promise<void>){const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json(body) as any;try{await fn();}finally{globalThis.fetch=originalFetch;}}

test('E2E live router preserves Top-1 release contract, strict-prior isolation and determinism',async()=>{
  await withBigDb(bigDbBody(),async()=>{
    const first=await router.fetch(liveRequest(),env,ctx),second=await router.fetch(liveRequest(),env,ctx);
    assert.equal(first.status,200);assert.equal(second.status,200);
    const a:any=await first.json(),b:any=await second.json();
    assert.deepEqual(a,b);assert.equal(a.status,'SUCCESS');assert.equal(a.engine,'CFI_LIVE_V1');assert.equal(a.runtime.version,'CFI_LIVE_RUNTIME_V1');assert.equal(a.runtime.predictionPath,'PREMATCH_V5_3_TOP1_PRIOR_PLUS_LIVE_STATE_V1');assert.equal(a.runtime.prematchEngine,'CFI_FINAL_V5.3.0');assert.equal(a.strictPrior.verified,true);assert.equal(a.temporalEvidenceAudit.futureEvidenceCount,0);assert.equal(a.temporalEvidenceAudit.sameDateEvidenceCount,0);assert.equal(a.bigDbRetrieval.version,'CFI_BIG_DB_RETRIEVAL_V2.1.2');assert.equal(a.isolation.prematchFrozen,true);assert.equal(a.isolation.prematchSnapshotWrite,false);assert.equal(a.isolation.liveSnapshotWrite,false);assert.equal(a.isolation.liveEvidenceSeparated,true);assert.deepEqual(a.scoreline.ht.final,[{score:'0-1',probability:1}]);
  });
});
test('E2E live router fails closed when BigDB temporal audit contains future evidence',async()=>{const bad=bigDbBody({temporalAudit:temporalAudit({verified:false,futureEvidenceCount:1})});await withBigDb(bad,async()=>{const response=await router.fetch(liveRequest(),env,ctx);assert.equal(response.status,500);const body:any=await response.json();assert.equal(body.status,'STRICT_PRIOR_GATE_ERROR');assert.equal(body.error,'TEMPORAL_FUTURE_OR_SAME_DATE_EVIDENCE');assert.equal(body.strictPrior.verified,false);assert.equal(body.strictPrior.failClosed,true);assert.equal(body.runtime.predictionPath,'LIVE_PRIOR_STRICT_FAIL_CLOSED');});});
test('E2E live router rejects terminal match states without touching BigDB',async()=>{let calls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{calls+=1;return Response.json(bigDbBody()) as any;};try{const response=await router.fetch(liveRequest({fixtureStatus:'FT',live:undefined}),env,ctx);assert.equal(response.status,409);const body:any=await response.json();assert.equal(body.status,'MATCH_STATE_ERROR');assert.equal(body.error,'MATCH_NOT_PREDICTABLE');assert.equal(calls,0);}finally{globalThis.fetch=originalFetch;}});
