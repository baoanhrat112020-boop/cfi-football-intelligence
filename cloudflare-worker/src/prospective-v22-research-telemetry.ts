import { MULTI_MARKET_RESEARCH_GRID_SYMBOL } from '../../src/prediction/multi-market-v1.ts';

export const PROSPECTIVE_V22_TELEMETRY_VERSION='CFI_PROSPECTIVE_V22_SCORE_GRIDS_V1';

type CompactCell=[number,number,number];

type CompactGrid={
  cells:CompactCell[];
  mass:number;
  count:number;
};

function compactGrid(rows:any[]):CompactGrid|null{
  if(!Array.isArray(rows)||rows.length===0)return null;
  const cells:CompactCell[]=[];
  let mass=0;
  for(const row of rows){
    const home=Number(row?.home),away=Number(row?.away),probability=Number(row?.probability);
    if(!Number.isInteger(home)||home<0||!Number.isInteger(away)||away<0||!Number.isFinite(probability)||probability<0)return null;
    cells.push([home,away,probability]);
    mass+=probability;
  }
  if(Math.abs(mass-1)>1e-9)return null;
  return{cells,mass,count:cells.length};
}

function scoreGrids(multiMarket:any){
  const hidden=multiMarket?.[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  const ht=compactGrid(hidden?.ht),ft=compactGrid(hidden?.ft);
  return ht&&ft?{ht,ft}:null;
}

async function sha256(value:unknown){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

/**
 * Adds PRE-MATCH research telemetry only to the immutable audit payload.
 * The normal prediction response object is never mutated.
 */
export async function buildProspectiveV22AuditPrediction(prediction:any){
  const incumbent=scoreGrids(prediction?.multiMarket);
  const fusionV1=scoreGrids(prediction?.championFusion?.multiMarket);
  const challengerV2=scoreGrids(prediction?.championFusionChallenger?.multiMarket);
  const fusionV3=scoreGrids(prediction?.multiMarketFusionV3?.multiMarket);
  const complete=Boolean(incumbent&&fusionV1&&challengerV2);
  const telemetryCore={
    version:PROSPECTIVE_V22_TELEMETRY_VERSION,
    status:complete?'READY':'BLOCKED_FULL_SCORE_GRIDS_REQUIRED',
    capturedPreMatch:true,
    researchOnly:true,
    decisionUse:false,
    productionEligible:false,
    reconstructed:false,
    engine:String(prediction?.baseEngine??prediction?.engine??''),
    target:prediction?.target??null,
    challengerVersion:prediction?.championFusionChallenger?.version??null,
    challengerLineage:prediction?.championFusionChallenger?.lineage??null,
    protocol:prediction?.championFusionChallenger?.researchProtocol??null,
    fusionV3:{
      version:prediction?.multiMarketFusionV3?.version??null,
      status:prediction?.multiMarketFusionV3?.status??null,
      captured:Boolean(fusionV3),
      fingerprint:prediction?.multiMarketFusionV3?.fusion?.fingerprint??null,
      trajectoryStatus:prediction?.multiMarketFusionV3?.trajectory?.status??null,
      bigDbUsed:prediction?.multiMarketFusionV3?.bigDb?.used===true,
      decisionUse:false,
    },
    scoreGrids:complete?{incumbent,fusionV1,challengerV2,fusionV3:fusionV3??null}:null,
  };
  const telemetry={...telemetryCore,sha256:await sha256(telemetryCore)};
  return{...prediction,researchTelemetry:{...(prediction?.researchTelemetry??{}),prospectiveV22:telemetry}};
}
