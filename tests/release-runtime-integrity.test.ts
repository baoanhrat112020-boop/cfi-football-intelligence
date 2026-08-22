import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

const TARGET_DATE='2026-08-22';
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-release-runtime-e2e-'));
const build=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler','deploy','--dry-run','--outdir',bundleDir],{encoding:'utf8'});
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

const ctx={waitUntil(){},passThroughOnException(){}} as ExecutionContext;
const env={CFI_DB_BASE_URL:'https://example.test/functions/v1/cfi-db',CFI_DB_KEY:'test-key'};

type Profile='low'|'high'|'home'|'away'|'volatile';
const patterns={
  low:(i:number)=>({ht:i%6===0?'1-0':'0-0',ft:i%5===0?'1-1':'1-0'}),
  high:(i:number)=>({ht:i%2?'3-1':'2-2',ft:i%2?'6-3':'5-4'}),
  home:(i:number)=>({ht:i%3?'2-0':'3-0',ft:i%3?'4-0':'5-1'}),
  away:(i:number)=>({ht:i%3?'0-2':'0-3',ft:i%3?'0-4':'1-5'}),
  volatile:(i:number)=>({ht:['0-0','3-2','0-2','2-0','1-3'][i%5],ft:['0-0','6-2','1-5','5-1','2-6'][i%5]}),
};

function body(home:string,away:string,profile:Profile){
  const rows=Array.from({length:44},(_,i)=>{
    const p=patterns[profile](i), homeSide=i<22;
    return {id:`${profile}-${i}`,matchDate:`2026-07-${String((i%28)+1).padStart(2,'0')}`,homeTeam:homeSide?home:`Opp ${i}`,awayTeam:homeSide?`Opp ${i}`:away,ht:p.ht,ft:p.ft};
  });
  return {
    status:'OK',version:'CFI_BIG_DB_RETRIEVAL_V2.1.2',targetDate:TARGET_DATE,
    exactTeam:{home:{retrieved:22},away:{retrieved:22},h2h:{retrieved:0}},
    fixtures:{home:rows.slice(0,22),away:rows.slice(22),h2h:[]},
    globalPrior:{fixtureCount:100,markets:{}},
    temporalAudit:{targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-07-28',exactTeamMaxEvidenceDate:'2026-07-28',globalPriorMaxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0},
  };
}

async function predict(home:string,away:string,profile:Profile){
  const original=globalThis.fetch;
  globalThis.fetch=async(input:any)=>{
    const url=typeof input==='string'?input:String(input?.url??input);
    if(url.includes('cfi-bigdb-retrieval'))return Response.json(body(home,away,profile)) as any;
    if(url.includes('cfi-prediction-audit'))return Response.json({status:'RECORDED'}) as any;
    return Response.json({status:'OK',runtime:{}}) as any;
  };
  try{
    return await router.fetch(new Request('https://worker.test/api/predict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home,away,target_date:TARGET_DATE,language:'en'})}),env,ctx);
  }finally{globalThis.fetch=original;}
}

async function status(){
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({status:'OK',runtime:{},bigDbRetrieval:{}}) as any;
  try{return await router.fetch(new Request('https://worker.test/api/status'),env,ctx);}finally{globalThis.fetch=original;}
}

const fingerprint=(b:any)=>JSON.stringify({markets:['3+ HT','7+ FT','Other HT','Other FT'].map(m=>Number(b.markets[m].final).toFixed(8)),ht:b.scoreline.ht.final.map((x:any)=>x.score),ft:b.scoreline.ft.final.map((x:any)=>x.score)});

test('status and prematch prediction expose one worker entrypoint and an explicit prematch handler',async()=>{
  const statusResponse=await status();
  assert.equal(statusResponse.status,200);
  const statusBody:any=await statusResponse.json();
  const predictionResponse=await predict('Telemetry Home','Telemetry Away','volatile');
  assert.equal(predictionResponse.status,200);
  const prediction:any=await predictionResponse.json();
  assert.equal(prediction.status,'SUCCESS');
  for(const b of [statusBody,prediction]){
    assert.equal(b.runtime.productionEntrypoint,'index-live-router.ts');
    assert.equal(b.runtime.prematchHandler??b.runtime.prematchEntrypoint,'index-v55.ts');
  }
  assert.equal(prediction.release.productionEntrypoint,'index-live-router.ts');
  assert.equal(prediction.release.prematchHandler,'index-v55.ts');
});

test('full /api/predict BigDB path does not collapse materially different matches',async()=>{
  const profiles:Profile[]=['low','high','home','away','volatile'];
  const outputs=[] as any[];
  for(const profile of profiles){
    const response=await predict(`${profile} Home`,`${profile} Away`,profile);
    assert.equal(response.status,200);
    const b:any=await response.json();
    assert.equal(b.status,'SUCCESS');
    assert.equal(b.strictPrior?.verified,true);
    outputs.push(b);
  }
  assert.ok(new Set(outputs.map(fingerprint)).size>=4,outputs.map(fingerprint).join('\n'));
  const volatile=outputs[4];
  const thresholdDifferent=['3+ HT','7+ FT','Other HT','Other FT'].some(m=>Math.abs(Number(volatile.markets[m].methodA)-Number(volatile.markets[m].methodB))>1e-9);
  const scorelineDifferent=JSON.stringify(volatile.scoreline.ht.methodA)!==JSON.stringify(volatile.scoreline.ht.methodB)||JSON.stringify(volatile.scoreline.ft.methodA)!==JSON.stringify(volatile.scoreline.ft.methodB);
  assert.equal(thresholdDifferent||scorelineDifferent,true,'Method A/B must be behaviorally distinct on the divergence fixture');
});

test('full-router prediction remains deterministic across repeats',async()=>{
  const seen=[] as string[];
  for(let i=0;i<3;i++){
    const response=await predict('Repeat Home','Repeat Away','volatile');
    assert.equal(response.status,200);
    seen.push(fingerprint(await response.json()));
  }
  assert.equal(new Set(seen).size,1);
});
