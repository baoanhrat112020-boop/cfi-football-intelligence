import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketChampionFusionV2Challenger } from '../src/prediction/multi-market-champion-fusion.ts';
import { MULTI_MARKET_RESEARCH_GRID_SYMBOL } from '../src/prediction/multi-market-v1.ts';

type Row={score:string;home:number;away:number;total:number;probability:number};
const grid=(rows:Array<[string,number]>):Row[]=>rows.map(([score,probability])=>{const [home,away]=score.split('-').map(Number);return{score,home,away,total:home+away,probability};});
const mirror=(rows:Row[])=>rows.map(r=>({score:`${r.away}-${r.home}`,home:r.away,away:r.home,total:r.total,probability:r.probability}));

const htInc=grid([['0-0',.20],['1-0',.55],['0-1',.15],['1-1',.10]]);
const htOpp=grid([['0-0',.10],['1-0',.08],['0-1',.70],['1-1',.12]]);
const ftInc=grid([['0-0',.18],['1-0',.30],['0-1',.15],['1-1',.22],['2-0',.10],['0-2',.05]]);
const ftFut=grid([['0-0',.14],['1-0',.27],['0-1',.17],['1-1',.23],['2-0',.12],['0-2',.07]]);
const ftHist=grid([['0-0',.20],['1-0',.28],['0-1',.16],['1-1',.24],['2-0',.08],['0-2',.04]]);

function args(swapped=false){
  const pick=(x:Row[])=>swapped?mirror(x):x;
  return{
    targetDate:'2026-09-02',maxEvidenceDate:'2026-09-01',
    ht:{incumbent:pick(htInc),futureSix:pick(htOpp),historical:pick(htOpp)},
    ft:{incumbent:pick(ftInc),futureSix:pick(ftFut),historical:pick(ftHist)},
    context:{evidenceCount:20,h2hCount:1,volatility:.25,extremeScorePressure:.18,dominance:swapped?-.20:.20,goalTempo:.28},
  };
}

function mapGrid(rows:any[]){return new Map(rows.map(r=>[`${r.home}-${r.away}`,Number(r.probability)]));}
function mirroredTv(a:any[],b:any[]){
  const A=mapGrid(a),B=new Map(b.map(r=>[`${r.away}-${r.home}`,Number(r.probability)]));
  const keys=new Set([...A.keys(),...B.keys()]); let s=0;
  for(const k of keys)s+=Math.abs((A.get(k)??0)-(B.get(k)??0));
  return s/2;
}

function reverseScore(score:string){const [h,a]=score.split('-');return `${a}-${h}`;}

test('Fusion V2 challenger is deterministic for identical strict-prior input',()=>{
  const a:any=buildMultiMarketChampionFusionV2Challenger(args(false));
  const b:any=buildMultiMarketChampionFusionV2Challenger(args(false));
  assert.deepEqual(a,b);
  const ga=a.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  const gb=b.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  assert.deepEqual(ga,gb);
  assert.equal(a.status,'CHALLENGER_READY');
  assert.equal(a.decisionUse,false);
});

test('Fusion V2 challenger is invariant under complete HOME/AWAY relabeling',()=>{
  const a:any=buildMultiMarketChampionFusionV2Challenger(args(false));
  const b:any=buildMultiMarketChampionFusionV2Challenger(args(true));
  const ga=a.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  const gb=b.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  assert.ok(mirroredTv(ga.ht,gb.ht)<=1e-12);
  assert.ok(mirroredTv(ga.ft,gb.ft)<=1e-12);
  assert.ok(Math.abs(a.multiMarket.oneXTwo.ht.home-b.multiMarket.oneXTwo.ht.away)<=1e-12);
  assert.ok(Math.abs(a.multiMarket.oneXTwo.ht.draw-b.multiMarket.oneXTwo.ht.draw)<=1e-12);
  assert.ok(Math.abs(a.multiMarket.oneXTwo.ft.home-b.multiMarket.oneXTwo.ft.away)<=1e-12);
  assert.deepEqual(a.multiMarket.overUnder.ht,b.multiMarket.overUnder.ht);
  assert.deepEqual(a.multiMarket.overUnder.ft,b.multiMarket.overUnder.ft);
  for(const line of Object.keys(a.multiMarket.asianHandicap.ht)){
    assert.deepEqual(a.multiMarket.asianHandicap.ht[line].home,b.multiMarket.asianHandicap.ht[line].away);
    assert.deepEqual(a.multiMarket.asianHandicap.ft[line].home,b.multiMarket.asianHandicap.ft[line].away);
  }
  assert.equal(b.champion.top1HT.score,reverseScore(a.champion.top1HT.score));
  assert.equal(b.champion.top1FT.score,reverseScore(a.champion.top1FT.score));
  for(const market of ['3+ HT','7+ FT','Other HT','Other FT'])assert.ok(Math.abs(a.champion.thresholds[market]-b.champion.thresholds[market])<=1e-12);
  assert.equal(a.multiMarket.consistencyGuard.status,'PASS');
  assert.equal(b.multiMarket.consistencyGuard.status,'PASS');
});
