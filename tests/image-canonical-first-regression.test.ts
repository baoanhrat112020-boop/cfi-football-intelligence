import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { bridgeProviderTeamName } from '../supabase/functions/_shared/cfi-provider-team-bridge.ts';

const TARGET_DATE='2026-09-02';
const RAW_HOME='Gintra Universitetas W';
const RAW_AWAY='Sturm Graz / Stattegg W';
const CANONICAL_HOME='Gintra Universitetas Women';
const CANONICAL_AWAY='Sturm Graz/Stattegg Women';
const bundleDir=mkdtempSync(join(tmpdir(),'cfi-image-canonical-first-'));
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

function scoredRows(){
  const home=Array.from({length:20},(_,i)=>({id:`gintra-${i}`,matchDate:`2026-08-${String((i%20)+1).padStart(2,'0')}`,homeTeam:CANONICAL_HOME,awayTeam:`Home Opp ${i}`,ht:i%3===0?'2-1':'1-0',ft:i%4===0?'4-2':'3-1'}));
  const away=Array.from({length:20},(_,i)=>({id:`sturm-${i}`,matchDate:`2026-08-${String((i%20)+1).padStart(2,'0')}`,homeTeam:`Away Opp ${i}`,awayTeam:CANONICAL_AWAY,ht:i%3===0?'1-2':'0-1',ft:i%4===0?'2-4':'1-3'}));
  return{home,away};
}

function verifiedBigDb(){
  const rows=scoredRows();
  return{
    status:'OK',
    version:'CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE',
    targetDate:TARGET_DATE,
    identity:{
      homeFound:true,
      awayFound:true,
      homeTeamId:'team-gintra-women',
      awayTeamId:'team-sturm-stattegg-women',
      homeCanonical:CANONICAL_HOME,
      awayCanonical:CANONICAL_AWAY,
      homeResolution:'PROVIDER_TEAM_BRIDGE',
      awayResolution:'PROVIDER_TEAM_BRIDGE',
    },
    exactTeam:{home:{retrieved:20},away:{retrieved:20},h2h:{retrieved:1}},
    fixtures:{home:rows.home,away:rows.away,h2h:[{id:'h2h-1',matchDate:'2026-07-01',homeTeam:CANONICAL_HOME,awayTeam:CANONICAL_AWAY,ht:'1-1',ft:'3-2'}]},
    globalPrior:{fixtureCount:100,markets:{}},
    temporalAudit:{targetDate:TARGET_DATE,verified:true,observable:true,maxEvidenceDate:'2026-08-20',exactTeamMaxEvidenceDate:'2026-08-20',globalPriorMaxEvidenceDate:'2026-08-20',futureEvidenceCount:0,sameDateEvidenceCount:0},
  };
}

function request(){
  return new Request('https://worker.test/api/predict',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({home:RAW_HOME,away:RAW_AWAY,target_date:TARGET_DATE,language:'vi',input_mode:'IMAGE_ANALYSIS',image_evidence:{image_count:10,extracted_fields:['home','away']}}),
  });
}

async function withBigDb(big:any,run:()=>Promise<void>){
  const original=globalThis.fetch;
  globalThis.fetch=async(input:any)=>{
    const url=typeof input==='string'?input:String(input?.url??input);
    if(url.includes('cfi-bigdb-retrieval'))return Response.json(big) as any;
    if(url.includes('cfi-prediction-audit'))return Response.json({status:'RECORDED'}) as any;
    throw new Error(`UNEXPECTED_FETCH:${url}`);
  };
  try{await run();}finally{globalThis.fetch=original;}
}

test('IMAGE_ANALYSIS Gintra/Sturm exact aliases preserve Women scope',()=>{
  assert.equal(bridgeProviderTeamName(RAW_HOME),CANONICAL_HOME);
  assert.equal(bridgeProviderTeamName(RAW_AWAY),CANONICAL_AWAY);
  assert.equal(bridgeProviderTeamName('Gintra Universitetas U19'),'Gintra Universitetas U19');
  assert.equal(bridgeProviderTeamName('Sturm Graz / Stattegg Reserves'),'Sturm Graz / Stattegg Reserves');
});

test('IMAGE_ANALYSIS production bundle verifies canonical identity before 20/20/1 exact evidence and propagates practical gate',async()=>{
  await withBigDb(verifiedBigDb(),async()=>{
    const response=await router.fetch(request(),env,ctx);
    assert.equal(response.status,200);
    const body:any=await response.json();
    assert.equal(body.status,'SUCCESS');
    assert.equal(body.fixtureIdentityVerified,true);
    assert.equal(body.fixtureIdentity?.source,'SHARED_IDENTITY_BRIDGE');
    assert.equal(body.fixtureIdentity?.homeCanonical,CANONICAL_HOME);
    assert.equal(body.fixtureIdentity?.awayCanonical,CANONICAL_AWAY);
    assert.equal(body.bigDbRetrieval?.exactTeam?.home?.retrieved,20);
    assert.equal(body.bigDbRetrieval?.exactTeam?.away?.retrieved,20);
    assert.equal(body.bigDbRetrieval?.exactTeam?.h2h?.retrieved,1);
    assert.equal(body.outputV3?.input?.mode,'IMAGE_ANALYSIS');
    assert.equal(body.outputV3?.gates?.fixtureIdentityVerified,true);
  });
});

test('unresolved canonical identity is rejected before ZERO_EXACT_TEAM_EVIDENCE',async()=>{
  const big=verifiedBigDb();
  big.identity={homeFound:false,awayFound:true,homeTeamId:null,awayTeamId:'team-sturm-stattegg-women',homeCanonical:null,awayCanonical:CANONICAL_AWAY,homeResolution:'UNRESOLVED',awayResolution:'PROVIDER_TEAM_BRIDGE'} as any;
  big.exactTeam={home:{retrieved:0},away:{retrieved:20},h2h:{retrieved:0}};
  await withBigDb(big,async()=>{
    const response=await router.fetch(request(),env,ctx);
    assert.equal(response.status,422);
    const body:any=await response.json();
    assert.equal(body.error,'CANONICAL_IDENTITY_UNRESOLVED');
    assert.notEqual(body.error,'ZERO_EXACT_TEAM_EVIDENCE');
    assert.equal(body.fixtureIdentityVerified,false);
  });
});

test('canonical self-match is rejected before exact evidence gate',async()=>{
  const big=verifiedBigDb();
  big.identity={homeFound:true,awayFound:true,homeTeamId:'same-team',awayTeamId:'same-team',homeCanonical:CANONICAL_HOME,awayCanonical:CANONICAL_HOME,homeResolution:'TEST',awayResolution:'TEST'} as any;
  await withBigDb(big,async()=>{
    const response=await router.fetch(request(),env,ctx);
    assert.equal(response.status,422);
    const body:any=await response.json();
    assert.equal(body.error,'CANONICAL_SELF_MATCH_REJECTED');
    assert.notEqual(body.error,'ZERO_EXACT_TEAM_EVIDENCE');
  });
});

test('ZERO_EXACT gate is structurally ordered after shared identity and practical propagation precedes V3',()=>{
  const v50=readFileSync(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
  const identityCall=v50.indexOf('const identity=fixtureIdentityAudit(big)');
  const exactCall=v50.indexOf('const exact=exactTeamEvidenceAudit(big)');
  assert.ok(identityCall>=0);
  assert.ok(exactCall>identityCall,'ZERO_EXACT evidence audit must run after canonical identity audit');
  const v55=readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');
  const propagation=v55.indexOf('input.fixture_identity=');
  const practical=v55.indexOf('attachCfiOutputV3(body,input)');
  assert.ok(propagation>=0&&practical>propagation,'verified identity must propagate before practical output V3');
});