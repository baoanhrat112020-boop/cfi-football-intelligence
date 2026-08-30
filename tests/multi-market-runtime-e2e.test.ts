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
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-multimarket-runtime-e2e-'));
const build=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
assert.equal(build.status,0,`Wrangler bundle failed:\n${build.stdout}\n${build.stderr}`);
function jsFiles(dir:string):string[]{const out:string[]=[];for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())out.push(...jsFiles(path));else if(/\.(?:m?js)$/.test(entry.name))out.push(path);}return out;}
const candidates=jsFiles(bundleDir).sort((a,b)=>statSync(b).size-statSync(a).size);
assert.ok(candidates.length>0,`Wrangler produced no importable JS module in ${bundleDir}`);
const {default:router}=await import(`${pathToFileURL(candidates[0]).href}?v=${Date.now()}`);
process.on('exit',()=>{try{rmSync(bundleDir,{recursive:true,force:true});}catch{}});
function bigDbBody(){const rows=Array.from({length:44},(_,index)=>({id:`mm-${index}`,matchDate:`2026-07-${String((index%28)+1).padStart(2,'0')}`,homeTeam:index<22?HOME:`Opponent ${index}`,awayTeam:index<22?`Opponent ${index}`:AWAY,ht:index%3===0?'1-1':'1-0',ft:index%4===0?'3-2':'2-1'}));return {status:'OK',version:'CFI_BIG_DB_RETRIEVAL_V2.1.2',targetDate:TARGET_DATE,exactTeam:{home:{retrieved:22},away:{retrieved:22},h2h:{retrieved:0}},fixtures:{home:rows.slice(0,22),away:rows.slice(22),h2h:[]},globalPrior:{fixtureCount:100,markets:{}},temporalAudit:{targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-07-28',exactTeamMaxEvidenceDate:'2026-07-28',globalPriorMaxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0}};}
const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;
const env={CFI_DB_BASE_URL:'https://example.test/functions/v1/cfi-db',CFI_DB_KEY:'test-key'};
function request(){return new Request('https://worker.test/api/predict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:HOME,away:AWAY,target_date:TARGET_DATE,language:'vi'})});}
async function withBackend(fn:()=>Promise<void>){const original=globalThis.fetch;globalThis.fetch=async(input:any)=>{const url=typeof input==='string'?input:String(input?.url??input);if(url.includes('cfi-bigdb-retrieval'))return Response.json(bigDbBody()) as any;if(url.includes('cfi-prediction-audit'))return Response.json({status:'RECORDED'}) as any;throw new Error(`UNEXPECTED_FETCH:${url}`);};try{await fn();}finally{globalThis.fetch=original;}}

test('production bundle exposes single-core multi-market shadow without mutating Top-1 primary contract',async()=>{
  await withBackend(async()=>{
    const response=await router.fetch(request(),env,ctx);assert.equal(response.status,200);const body:any=await response.json();
    assert.equal(body.status,'SUCCESS');
    assert.equal(body.engine,'CFI_FINAL_V5.3.0');
    assert.equal(body.runtime.version,'CFI_PRIMARY_TOP1_RUNTIME_V2');
    assert.equal(body.runtime.predictionPath,'NATIVE_V5_3_TOP1_STRICT_PRIOR_BIGDB_V2_1_2');
    assert.equal(body.presentationContract?.contract,'CFI_4_MARKETS_PLUS_TOP1_HT_FT_V1');
    assert.equal(body.primaryTargets?.count,6);
    assert.equal(body.primaryTargetMatrix?.verification?.complete,true);
    assert.ok(body.primaryTargetMatrix?.exactScore?.['Top-1 HT']?.final?.score);
    assert.ok(body.primaryTargetMatrix?.exactScore?.['Top-1 FT']?.final?.score);
    assert.ok(body.markets?.['3+ HT']);assert.ok(body.markets?.['7+ FT']);assert.ok(body.markets?.['Other HT']);assert.ok(body.markets?.['Other FT']);
    assert.equal(body.multiMarket.version,'CFI_MULTI_MARKET_V1');assert.equal(body.multiMarket.status,'SHADOW_RESEARCH');assert.equal(body.multiMarket.decisionUse,false);assert.equal(body.multiMarketIntegration.status,'SHADOW_READY');assert.equal(body.multiMarketIntegration.source,'FINAL_CALIBRATED_SCORE_DISTRIBUTION');assert.equal(body.multiMarketIntegration.singleCore,true);assert.equal(body.multiMarketIntegration.crossCoreConsistency.status,'PASS');assert.equal(body.multiMarketIntegration.championMutation,false);assert.equal(body.multiMarket.consistencyGuard.status,'PASS');
    const ft=body.multiMarket.oneXTwo.ft;assert.ok(Math.abs(ft.home+ft.draw+ft.away-1)<1e-9);assert.ok(Math.abs(body.multiMarket.asianHandicap.ft['-0.5'].home.fullWin-ft.home)<1e-9);assert.equal(body.multiMarket.derivedChecks.ftOver6_5,body.multiMarket.overUnder.ft['6.5'].over.fullWin);
  });
});
