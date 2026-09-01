import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=fileURLToPath(new URL('../',import.meta.url));
const researchRoot=join(repoRoot,'research');
const authoritative='research/multimarket-promotion-gate-v2.mjs';
const legacyImplementation='research/promotion-gate.mjs';

async function listMjs(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const out=[];
  for(const entry of entries){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await listMjs(path));
    else if(entry.isFile()&&entry.name.endsWith('.mjs'))out.push(path);
  }
  return out;
}

test('active research paths cannot import the legacy promotion gate or Top-3 research requirements',async()=>{
  const violations=[];
  for(const file of await listMjs(researchRoot)){
    const rel=relative(repoRoot,file).replaceAll('\\','/');
    if(rel===legacyImplementation)continue;
    const src=await readFile(file,'utf8');
    if(/from\s+['"](?:\.\.\/)*promotion-gate\.mjs['"]|from\s+['"]\.\/promotion-gate\.mjs['"]/.test(src))violations.push(`${rel}:LEGACY_PROMOTION_IMPORT`);
    if(/\bTOP3_HT\b|\bTOP3_FT\b|\btop3HT\b|\btop3FT\b/.test(src))violations.push(`${rel}:LEGACY_TOP3_RESEARCH_REQUIREMENT`);
    if(rel!==authoritative&&/shadowEligible\s*:\s*true/.test(src))violations.push(`${rel}:DIRECT_SHADOW_ELIGIBLE_TRUE`);
  }
  assert.deepEqual(violations,[]);
});

test('authoritative research gate remains the only source allowed to compute shadow eligibility',async()=>{
  const src=await readFile(join(repoRoot,authoritative),'utf8');
  assert.match(src,/evaluateMultiMarketPromotion/);
  assert.match(src,/CFI_MULTI_MARKET_RESEARCH_CONTRACT_V2_2/);
  assert.doesNotMatch(src,/\bTOP3_HT\b|\bTOP3_FT\b/);
});
