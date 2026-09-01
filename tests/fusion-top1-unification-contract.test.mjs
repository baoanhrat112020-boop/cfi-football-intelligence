import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const active=[
  'src/prediction/multi-market-champion-fusion.ts',
  'cloudflare-worker/src/index-v50.ts',
  'cloudflare-worker/src/index-v55.ts',
  'cloudflare-worker/src/discovery-compact.ts',
  'gpt-action/CFI_GPT_INSTRUCTIONS.md',
];
const forbidden=['top3HT','top3FT','Top-3 HT','Top-3 FT','TOP-3 HT','TOP-3 FT'];

test('active production and Fusion paths expose only Top-1 exact-score targets',()=>{
  for(const path of active){
    const src=read(path);
    for(const token of forbidden)assert.equal(src.includes(token),false,`${path}:${token}`);
  }
  const fusion=read('src/prediction/multi-market-champion-fusion.ts');
  assert.match(fusion,/TOP1_HT_PLUS_TOP1_FT/);
  assert.match(fusion,/top1HT/);
  assert.match(fusion,/top1FT/);
  const v50=read('cloudflare-worker/src/index-v50.ts');
  assert.match(v50,/PRIMARY_CONTRACT/);
  assert.match(v50,/Top-1 HT/);
  assert.match(v50,/Top-1 FT/);
  const v55=read('cloudflare-worker/src/index-v55.ts');
  assert.match(v55,/NATIVE_V5_3_TOP1_STRICT_PRIOR_BIGDB_V2_1_2/);
});

test('legacy Top-3 compatibility is isolated to immutable settlement reader only',()=>{
  const settlement=read('supabase/functions/cfi-multimarket-settlement-eval/index.ts');
  assert.match(settlement,/LEGACY_SNAPSHOT_FIRST_RANK_AS_TOP1/);
  assert.match(settlement,/legacySnapshotsReadOnlyCompatibility:true/);
  assert.match(settlement,/top1Only:true/);
  assert.match(settlement,/CFI_CHAMPION_FUSION_SETTLEMENT_V2_TOP1/);
});
