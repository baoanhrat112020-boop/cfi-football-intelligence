import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {R_HT,poissonPmf,poissonOver,poissonRange,poissonExtraMarkets} from '../src/prediction/poisson-markets.ts';
const fact=(n:number)=>n<2?1:n*fact(n-1);
const pmf=(l:number,k:number)=>Math.exp(-l)*l**k/fact(k);
const near=(a:number,b:number,tol:number)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);

test('poissonPmf matches the closed form',()=>{for(const l of [0.4,1.3,2.8,5.1])for(let k=0;k<10;k++)near(poissonPmf(l,k),pmf(l,k),1e-12);assert.equal(poissonPmf(0,0),1);assert.equal(poissonPmf(0,3),0)});
test('poissonOver(2.8, 2.5) equals 1 - (pmf0 + pmf1 + pmf2)',()=>near(poissonOver(2.8,2.5),1-(pmf(2.8,0)+pmf(2.8,1)+pmf(2.8,2)),1e-6));
test('poissonRange(2.8, 2, 3) equals pmf2 + pmf3',()=>near(poissonRange(2.8,2,3),pmf(2.8,2)+pmf(2.8,3),1e-6));
test('range, over and cdf partitions sum to 1',()=>{for(const l of [0.9,2.8,4.4]){near(poissonRange(l,0,1)+poissonRange(l,2,3)+poissonRange(l,4,6)+poissonOver(l,6),1,1e-9);near(poissonOver(l,3.5)+poissonRange(l,0,3),1,1e-9)}});
test('extra markets expose 8 grouped entries and only BTTS H1 is approximate',()=>{
  const rows=poissonExtraMarkets(1.6,1.0);
  assert.deepEqual(rows.map(r=>[r.market,r.label,r.group]),[['O0.5 HT','Over 0.5 H1','ht_detail'],['O1.5 HT','Over 1.5 H1','ht_detail'],['BTTS H1','BTTS H1','ht_detail'],['O3.5 FT','Over 3.5','ft_detail'],['O4.5 FT','Over 4.5','ft_detail'],['O5.5 FT','Over 5.5','ft_detail'],['2-3 FT','2-3 bàn','range'],['4-6 FT','4-6 bàn','range']]);
  assert.equal(rows.find(r=>r.market==='BTTS H1').approximate,true);
  assert.equal(rows.filter(r=>r.approximate===true).length,1);
  for(const r of rows){assert.ok(r.probability>0&&r.probability<1);assert.equal(r.decision,'WATCH');assert.equal(r.confidence,null);assert.ok(r.fairOdds>1)}
  near(rows[0].probability,1-Math.exp(-2.6*R_HT),1e-4);
  near(rows.find(r=>r.market==='BTTS H1').probability,(1-Math.exp(-1.6*R_HT))*(1-Math.exp(-1.0*R_HT)),1e-4);
  near(rows.find(r=>r.market==='2-3 FT').probability,poissonRange(2.6,2,3),1e-4);
});
test('extra markets carry the Tier C confidence and reject unusable lambdas',()=>{
  assert.ok(poissonExtraMarkets(1.4,1.1,'LOW').every(r=>r.confidence==='LOW'));
  for(const [h,a] of [[NaN,1],[1,Infinity],[-1,1],[0,0]])assert.deepEqual(poissonExtraMarkets(h,a),[]);
});
test('worker adds the Poisson markets to Tier A and Tier C',async()=>{
  const w=await readFile(new URL('../cloudflare-worker/src/index-gpt-core-v5.ts',import.meta.url),'utf8');
  assert.match(w,/import \{ poissonExtraMarkets \} from '\.\.\/\.\.\/src\/prediction\/poisson-markets\.ts'/);
  assert.match(w,/\.\.\.\(lh!==null&&la!==null\?poissonExtraMarkets\(lh,la\):\[\]\)/);
  assert.match(w,/tierCModel:pr\.model,extraMarkets:poissonExtraMarkets\(Number\(pr\.xg_home\),Number\(pr\.xg_away\),'LOW'\)/);
});
