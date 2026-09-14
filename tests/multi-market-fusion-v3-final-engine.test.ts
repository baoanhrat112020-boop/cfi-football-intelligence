import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction } from '../src/prediction/final-engine.ts';

function history(){
  const rows:any[]=[];
  for(let i=1;i<=18;i++){
    const day=String(i).padStart(2,'0');
    rows.push({id:`h${i}`,matchDate:`2026-07-${day}`,homeTeam:'Alpha',awayTeam:`H${i}`,ht:{home:i%3,away:i%2},ft:{home:1+(i%4),away:i%3}});
    rows.push({id:`a${i}`,matchDate:`2026-07-${day}`,homeTeam:`A${i}`,awayTeam:'Beta',ht:{home:i%2,away:(i+1)%3},ft:{home:i%3,away:1+((i+2)%4)}});
  }
  rows.push({id:'hh1',matchDate:'2026-07-20',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:0},ft:{home:2,away:1}});
  rows.push({id:'hh2',matchDate:'2026-07-25',homeTeam:'Beta',awayTeam:'Alpha',ht:{home:0,away:1},ft:{home:1,away:2}});
  return rows;
}

test('final engine exposes BigDB-aware Fusion V3 without mutating incumbent decisions',()=>{
  const rows=history();
  const bigDbContext:any={
    version:'CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE',
    temporalAudit:{targetDate:'2026-08-01',maxEvidenceDate:'2026-07-31',futureEvidenceCount:0,sameDateEvidenceCount:0,verified:true},
    globalPrior:{fixtureCount:74926,markets:{}},
    exactTeam:{home:{retrieved:35,bigDbOnly:20,overlap:8},away:{retrieved:34,bigDbOnly:18,overlap:7},h2h:{retrieved:4,bigDbOnly:2,overlap:1}},
    globalScorelinePrior:{
      ht:[
        {score:'0-0',probability:.31},{score:'1-0',probability:.20},{score:'0-1',probability:.18},{score:'1-1',probability:.17},
        {score:'2-0',probability:.06},{score:'0-2',probability:.04},{score:'2-1',probability:.025},{score:'1-2',probability:.015},
      ],
      ft:[
        {score:'0-0',probability:.08},{score:'1-0',probability:.14},{score:'0-1',probability:.11},{score:'1-1',probability:.16},
        {score:'2-0',probability:.09},{score:'0-2',probability:.07},{score:'2-1',probability:.11},{score:'1-2',probability:.08},
        {score:'2-2',probability:.06},{score:'3-1',probability:.04},{score:'1-3',probability:.025},{score:'3-2',probability:.02},
        {score:'2-3',probability:.01},{score:'4-1',probability:.0025},{score:'1-4',probability:.0025},
      ],
    },
  };
  const prediction:any=buildPrediction({
    home:'Alpha',away:'Beta',targetDate:'2026-08-01',language:'en',
    homePayload:rows,awayPayload:rows,
    h2hPayload:rows.filter(x=>(x.homeTeam==='Alpha'&&x.awayTeam==='Beta')||(x.homeTeam==='Beta'&&x.awayTeam==='Alpha')),
    bigDbContext,
  });

  assert.equal(prediction.status,'DATA_READY');
  assert.equal(prediction.multiMarketFusionV3.version,'CFI_MULTI_MARKET_FUSION_V3');
  assert.equal(prediction.multiMarketFusionV3.researchOnly,true);
  assert.equal(prediction.multiMarketFusionV3.decisionUse,false);
  assert.equal(prediction.multiMarketFusionV3.productionEligible,false);
  assert.equal(prediction.multiMarketFusionV3.bigDb.used,true);
  assert.equal(prediction.multiMarketFusionV3.strictPrior.verified,true);
  assert.equal(prediction.championFusion.decisionUse,false);
  assert.equal(prediction.championFusionChallenger.decisionUse,false);
  assert.equal(prediction.multiMarket.decisionUse,false);
});
