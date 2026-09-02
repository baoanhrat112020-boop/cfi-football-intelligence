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
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-integrity-e2e-'));
const build=process.platform==='win32'
  ? spawnSync('cmd.exe',['/d','/s','/c','npx','wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'})
  : spawnSync('npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
assert.equal(build.status,0,`Wrangler bundle failed:\n${build.stdout}\n${build.stderr}`);

function jsFiles(dir:string):string[]{
  const out:string[]=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...jsFiles(path));
    else if(/\.(?:m?js)$/.test(entry.name))out.push(path);
  }
  return out;
}
const candidates=jsFiles(bundleDir).sort((a,b)=>statSync(b).size-statSync(a).size);
assert.ok(candidates.length>0,`Wrangler produced no importable JS module in ${bundleDir}`);
const {default:router}=await import(`${pathToFileURL(candidates[0]).href}?v=${Date.now()}`);
process.on('exit',()=>{try{rmSync(bundleDir,{recursive:true,force:true});}catch{}});

function historicalRows(scored=true){
  return Array.from({length:44},(_,index)=>({
    id:`fx-${index}`,
    matchDate:`2026-07-${String((index%28)+1).padStart(2,'0')}`,
    homeTeam:index<22?HOME:`Opponent ${index}`,
    awayTeam:index<22?`Opponent ${index}`:AWAY,
    ht:scored?(index%3===0?'1-1':'1-0'):null,
    ft:scored?(index%4===0?'3-2':'2-1'):null,
  }));
}

function bigDbBody({temporalAudit,scored=true,exactHome=22,exactAway=22}:{temporalAudit?:any;scored?:boolean;exactHome?:number;exactAway?:number}={}){
  const rows=historicalRows(scored);
  return {
    status:'OK',
    version:'CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE',
    targetDate:TARGET_DATE,
    exactTeam:{home:{retrieved:exactHome},away:{retrieved:exactAway},h2h:{retrieved:0}},
    fixtures:{home:rows.slice(0,22),away:rows.slice(22),h2h:[]},
    globalPrior:{fixtureCount:100,markets:{}},
    temporalAudit:temporalAudit??{
      targetDate:TARGET_DATE,
      verified:true,
      observable:true,
      maxEvidenceDate:'2026-07-28',
      exactTeamMaxEvidenceDate:'2026-07-28',
      globalPriorMaxEvidenceDate:'2026-07-28',
      futureEvidenceCount:0,
      sameDateEvidenceCount:0,
    },
  };
}

const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;
const env={CFI_DB_BASE_URL:'https://example.test/functions/v1/cfi-db',CFI_DB_KEY:'test-key'};

function liveRequest(extra:any={}){
  return new Request('https://worker.test/api/predict-live',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({
      home:HOME,away:AWAY,target_date:TARGET_DATE,fixtureStatus:'LIVE',
      live:{minute:62,period:'2H',homeGoals:1,awayGoals:1,htHomeGoals:0,htAwayGoals:1,shotsOnTargetHome:5,shotsOnTargetAway:3,dangerousAttacksHome:42,dangerousAttacksAway:31,redCardsHome:0,redCardsAway:0},
      ...extra,
    }),
  });
}

function prematchRequest(){
  return new Request('https://worker.test/api/predict',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({home:HOME,away:AWAY,target_date:TARGET_DATE,language:'vi'}),
  });
}

async function withBackend(big:any,fn:(calls:string[])=>Promise<void>){
  const originalFetch=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=async(input:any)=>{
    const url=typeof input==='string'?input:String(input?.url??input);
    calls.push(url);
    if(url.includes('cfi-bigdb-retrieval'))return Response.json(big) as any;
    if(url.includes('cfi-prediction-audit'))return Response.json({status:'RECORDED'}) as any;
    throw new Error(`UNEXPECTED_FETCH:${url}`);
  };
  try{await fn(calls);}finally{globalThis.fetch=originalFetch;}
}

test('E2E terminal state cannot be reopened by stale 2H fields and never touches backend',async()=>{
  let calls=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls+=1;return Response.json(bigDbBody()) as any;};
  try{
    const response=await router.fetch(liveRequest({fixtureStatus:'FT'}),env,ctx);
    assert.equal(response.status,409);
    const body:any=await response.json();
    assert.equal(body.status,'MATCH_STATE_ERROR');
    assert.equal(body.error,'MATCH_NOT_PREDICTABLE');
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('E2E live route uses production expectedGoals seam and remains strict-prior clean',async()=>{
  await withBackend(bigDbBody(),async(calls)=>{
    const response=await router.fetch(liveRequest(),env,ctx);
    assert.equal(response.status,200);
    const body:any=await response.json();
    assert.equal(body.status,'SUCCESS');
    assert.equal(body.engine,'CFI_LIVE_V1');
    assert.equal(body.strictPrior.verified,true);
    assert.equal(body.temporalEvidenceAudit.futureEvidenceCount,0);
    assert.equal(body.temporalEvidenceAudit.sameDateEvidenceCount,0);
    assert.ok(Number.isFinite(body.audit.prematchFtExpectation.total));
    assert.notEqual(body.audit.prematchFtExpectation.total,2.7,'production prematch expectation must not silently use the 1.35+1.35 fallback');
    assert.equal(calls.filter(x=>x.includes('cfi-prediction-audit')).length,0,'LIVE must never write prematch snapshots');
  });
});

test('E2E live route rejects zero exact-team evidence before default prior construction',async()=>{
  await withBackend(bigDbBody({exactHome:0}),async(calls)=>{
    const response=await router.fetch(liveRequest(),env,ctx);
    assert.equal(response.status,422);
    const body:any=await response.json();
    assert.equal(body.status,'INSUFFICIENT_DATA');
    assert.equal(body.error,'ZERO_EXACT_TEAM_EVIDENCE');
    assert.equal(body.exactTeam.verified,false);
    assert.equal(calls.filter(x=>x.includes('cfi-bigdb-retrieval')).length,1);
    assert.equal(calls.filter(x=>x.includes('cfi-prediction-audit')).length,0);
  });
});

test('E2E live route rejects scoreless prior instead of using default goal expectations',async()=>{
  await withBackend(bigDbBody({scored:false}),async(calls)=>{
    const response=await router.fetch(liveRequest(),env,ctx);
    assert.equal(response.status,422);
    const body:any=await response.json();
    assert.equal(body.status,'INSUFFICIENT_DATA');
    assert.equal(body.error,'LIVE_PRIOR_SCORE_EVIDENCE_REQUIRED');
    assert.equal(body.evidence.htCoverage,0);
    assert.equal(body.evidence.ftCoverage,0);
    assert.equal(calls.filter(x=>x.includes('cfi-prediction-audit')).length,0);
  });
});

test('E2E live temporal gate requires explicit counters and target-date provenance',async()=>{
  const missingCounters=bigDbBody({temporalAudit:{targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-07-28'}});
  await withBackend(missingCounters,async()=>{
    const response=await router.fetch(liveRequest(),env,ctx);
    assert.equal(response.status,500);
    const body:any=await response.json();
    assert.equal(body.status,'STRICT_PRIOR_GATE_ERROR');
    assert.equal(body.error,'TEMPORAL_COUNTS_REQUIRED');
    assert.equal(body.strictPrior.verified,false);
  });
  const wrongTarget=bigDbBody({temporalAudit:{targetDate:'2026-08-21',verified:true,observable:true,maxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0}});
  await withBackend(wrongTarget,async()=>{
    const response=await router.fetch(liveRequest(),env,ctx);
    assert.equal(response.status,500);
    const body:any=await response.json();
    assert.equal(body.error,'TEMPORAL_TARGET_DATE_MISMATCH');
    assert.equal(body.strictPrior.verified,false);
  });
});

test('E2E prematch rejects dirty temporal audit before prediction snapshot write',async()=>{
  const dirty=bigDbBody({temporalAudit:{targetDate:TARGET_DATE,verified:false,observable:true,maxEvidenceDate:TARGET_DATE,futureEvidenceCount:0,sameDateEvidenceCount:1}});
  await withBackend(dirty,async(calls)=>{
    const response=await router.fetch(prematchRequest(),env,ctx);
    assert.equal(response.status,500);
    const body:any=await response.json();
    assert.equal(body.status,'STRICT_PRIOR_GATE_ERROR');
    assert.equal(body.strictPrior.verified,false);
    assert.equal(calls.filter(x=>x.includes('cfi-prediction-audit')).length,0);
  });
});

test('E2E prematch with scoreless evidence rows fails insufficient-data and never snapshots defaults',async()=>{
  await withBackend(bigDbBody({scored:false}),async(calls)=>{
    const response=await router.fetch(prematchRequest(),env,ctx);
    assert.equal(response.status,422);
    const body:any=await response.json();
    assert.equal(body.status,'INSUFFICIENT_DATA');
    assert.equal(body.error,'SCORE_EVIDENCE_REQUIRED');
    assert.equal(calls.filter(x=>x.includes('cfi-prediction-audit')).length,0);
    assert.equal(body.renderedReport,undefined);
  });
});
