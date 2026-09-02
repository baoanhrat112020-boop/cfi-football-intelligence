import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMultiMarketFromScoreGrids } from '../src/prediction/multi-market-v1.ts';
import { buildProspectiveV22AuditPrediction, PROSPECTIVE_V22_TELEMETRY_VERSION } from '../cloudflare-worker/src/prospective-v22-research-telemetry.ts';

const grid=(homeBias=0)=>[
  {score:'0-0',probability:0.25,total:0},
  {score:'1-0',probability:0.25+homeBias,total:1},
  {score:'0-1',probability:0.25-homeBias,total:1},
  {score:'1-1',probability:0.25,total:2},
];

function multi(homeBias=0){return buildMultiMarketFromScoreGrids({ht:grid(homeBias),ft:grid(homeBias/2)});}

test('prospective V2.2 telemetry captures full grids without mutating normal prediction',async()=>{
  const prediction:any={
    engine:'CFI_FINAL_V5.3.1',baseEngine:'CFI_FINAL_V5.3.1',target:{home:'A',away:'B',date:'2026-09-03'},
    multiMarket:multi(),
    championFusion:{multiMarket:multi(0.02)},
    championFusionChallenger:{
      version:'CFI_MULTI_MARKET_CHAMPION_FUSION_V2_CHALLENGER',
      lineage:'CFI_FUSION_RESEARCH_V2_HT_STABILITY',
      researchProtocol:{developmentOnly:true,sameCohortPromotionAllowed:false,prospectiveResetRequired:true},
      multiMarket:multi(0.01),
    },
  };
  const before=JSON.stringify(prediction);
  const audit=await buildProspectiveV22AuditPrediction(prediction);
  assert.equal(JSON.stringify(prediction),before);
  assert.equal((prediction as any).researchTelemetry,undefined);
  const t=audit.researchTelemetry.prospectiveV22;
  assert.equal(t.version,PROSPECTIVE_V22_TELEMETRY_VERSION);
  assert.equal(t.status,'READY');
  assert.equal(t.capturedPreMatch,true);
  assert.equal(t.reconstructed,false);
  assert.equal(t.decisionUse,false);
  assert.equal(t.protocol.sameCohortPromotionAllowed,false);
  assert.equal(t.protocol.prospectiveResetRequired,true);
  assert.equal(t.scoreGrids.incumbent.ht.count,4);
  assert.equal(t.scoreGrids.fusionV1.ft.count,4);
  assert.equal(t.scoreGrids.challengerV2.ht.count,4);
  assert.match(t.sha256,/^[0-9a-f]{64}$/);
});

test('cloudflare wrapper preserves numerical engine identity and telemetry stays audit-only',async()=>{
  const source=await readFile(new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),'utf8');
  assert.match(source,/const ENGINE_VERSION=FINAL_VERSION;/);
  assert.match(source,/prediction\.baseEngine=FINAL_VERSION;\s*prediction\.engine=ENGINE_VERSION;/);
  assert.match(source,/const auditPrediction=await buildProspectiveV22AuditPrediction\(auditBase\);/);
  assert.match(source,/recordAudit\(env,input,auditPrediction\)/);
  assert.doesNotMatch(source,/return Response\.json\(\{\.\.\.auditPrediction/);
  assert.match(source,/CFI_SIX_TARGET_RUNTIME_V1\.2\.2/);
});
