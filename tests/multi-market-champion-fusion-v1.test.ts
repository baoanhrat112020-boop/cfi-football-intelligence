import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChampionFusionV1, CHAMPION_FUSION_VERSION } from '../src/prediction/multi-market-champion-fusion-v1.ts';

function fixture(id:string,date:string,home:string,away:string,hh:number,ha:number,fh:number,fa:number){return{id,matchDate:date,homeTeam:home,awayTeam:away,ht:{home:hh,away:ha},ft:{home:fh,away:fa}};}
function date(day:number){return`2026-07-${String(day).padStart(2,'0')}`;}

function evidence(){
  const home:any[]=[],away:any=[];
  for(let i=1;i<=20;i++){
    home.push(fixture(`h${i}`,date(i),'Alpha',`H${i}`,i%4,(i+1)%3,(i*2)%6,(i+2)%4));
    away.push(fixture(`a${i}`,date(i),'A'+i,'Beta',(i+2)%3,i%4,(i+1)%4,(i*3)%6));
  }
  const h2h=[fixture('x1','2026-06-02','Alpha','Beta',1,0,2,1),fixture('x2','2026-06-12','Beta','Alpha',0,1,1,3)];
  home.push(fixture('same','2026-08-27','Alpha','SameDay',1,1,2,2));
  away.push(fixture('future','2026-08-28','Future','Beta',0,0,0,1));
  return{home,away,h2h};
}

test('Champion Fusion V1 fuses multiple strict-prior score experts into one coherent Multi-Market core',()=>{
  const e=evidence();
  const f:any=buildChampionFusionV1({home:'Alpha',away:'Beta',targetDate:'2026-08-27',homePayload:{fixtures:e.home},awayPayload:{fixtures:e.away},h2hPayload:{fixtures:e.h2h}});
  assert.equal(f.version,CHAMPION_FUSION_VERSION);
  assert.equal(f.status,'SHADOW_RESEARCH');
  assert.equal(f.decisionUse,false);
  assert.equal(f.productionEligible,false);
  assert.equal(f.strictPrior.verified,true);
  assert.equal(f.strictPrior.futureEvidenceCount,0);
  assert.equal(f.strictPrior.sameDateEvidenceCount,0);
  assert.equal(f.strictPrior.excludedFromInput.sameDate,1);
  assert.equal(f.strictPrior.excludedFromInput.future,1);
  assert.ok(f.strictPrior.maxEvidenceDate<'2026-08-27');
  assert.equal(f.multiMarket.version,'CFI_MULTI_MARKET_V1');
  assert.equal(f.multiMarket.model.family,'CFI_CHAMPION_FUSION_SCORE_GRID_V1');
  assert.equal(f.multiMarket.model.singleCore,true);
  assert.equal(f.multiMarket.consistencyGuard.status,'PASS');
  assert.deepEqual(f.multiMarket.consistencyGuard.violations,[]);
  for(const period of ['ht','ft']){
    const w=f.gating[period].weights;
    const sum=Object.values(w).reduce((s:any,x:any)=>s+x,0) as number;
    assert.ok(Math.abs(sum-1)<1e-12);
    for(const name of ['HISTORICAL','RECENT_FORM','FUTURE_SIX','DIRECTIONAL_POISSON'])assert.ok(w[name]>=.05);
    assert.ok(f.gating[period].disagreement>=0&&f.gating[period].disagreement<=1);
  }
  assert.equal(f.champion.top3HT.length,3);
  assert.equal(f.champion.top3FT.length,3);
  assert.ok(Math.abs(f.distributionAudit.ht.mass-1)<1e-12);
  assert.ok(Math.abs(f.distributionAudit.ft.mass-1)<1e-12);
  const ht1x2=f.multiMarket.oneXTwo.ht,ft1x2=f.multiMarket.oneXTwo.ft;
  assert.ok(Math.abs(ht1x2.home+ht1x2.draw+ht1x2.away-1)<1e-9);
  assert.ok(Math.abs(ft1x2.home+ft1x2.draw+ft1x2.away-1)<1e-9);
  assert.ok(Math.abs(f.champion.thresholds['3+ HT']-f.multiMarket.overUnder.ht['2.5'].over.fullWin)<1e-9);
  assert.ok(Math.abs(f.champion.thresholds['7+ FT']-f.multiMarket.overUnder.ft['6.5'].over.fullWin)<1e-9);
});

test('Champion Fusion fails closed when no strict-prior evidence exists',()=>{
  assert.throws(()=>buildChampionFusionV1({home:'Alpha',away:'Beta',targetDate:'2026-08-27',homePayload:{fixtures:[]},awayPayload:{fixtures:[]},h2hPayload:{fixtures:[]}}),/CHAMPION_FUSION_STRICT_PRIOR_EVIDENCE_REQUIRED/);
});
