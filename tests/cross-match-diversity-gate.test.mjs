import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, MARKET_CODES } from '../src/prediction/final-engine.ts';
const targetDate='2026-08-20';
const mk=(team,opp,tag,p)=>Array.from({length:20},(_,i)=>{const home=i%2===0,d=String(i+1).padStart(2,'0');return{id:`${tag}-${i}`,matchDate:`2026-07-${d}`,homeTeam:home?team:opp,awayTeam:home?opp:team,ht:{home:home?p.htgf(i):p.htga(i),away:home?p.htga(i):p.htgf(i)},ft:{home:home?p.gf(i):p.ga(i),away:home?p.ga(i):p.gf(i)}}});
const P={
 low:{gf:i=>i%5?1:0,ga:i=>i%4?1:0,htgf:i=>i%6?0:1,htga:()=>0},
 high:{gf:i=>4+i%3,ga:i=>2+i%2,htgf:i=>2+i%2,htga:i=>1+i%2},
 strong:{gf:i=>3+i%2,ga:i=>i%4?0:1,htgf:i=>1+i%2,htga:()=>0},
 weak:{gf:i=>i%3?1:0,ga:i=>3+i%2,htgf:()=>0,htga:i=>1+i%2},
 volatile:{gf:i=>[0,5,1,4,2][i%5],ga:i=>[4,0,3,1,5][i%5],htgf:i=>[0,3,0,2,1][i%5],htga:i=>[2,0,2,0,3][i%5]}
};
function pred(tag,hp,ap){const home=`${tag} Home`,away=`${tag} Away`;return buildPrediction({home,away,targetDate,homePayload:mk(home,'H Opp',`${tag}h`,hp),awayPayload:mk(away,'A Opp',`${tag}a`,ap),h2hPayload:[]});}
const vec=p=>MARKET_CODES.map(m=>p.markets[m].final);
const t3=p=>[...p.scoreline.ht.final.map(x=>x.score),...p.scoreline.ft.final.map(x=>x.score)].join('|');
const dist=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
test('five materially different profiles cannot collapse to one six-target output',()=>{const xs=[pred('low',P.low,P.low),pred('high',P.high,P.high),pred('home',P.strong,P.low),pred('away',P.low,P.strong),pred('volatile',P.volatile,P.volatile)];for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)assert.equal(dist(vec(xs[i]),vec(xs[j]))<1e-9&&t3(xs[i])===t3(xs[j]),false,`collapsed ${i}/${j}`);assert.ok(new Set(xs.map(x=>vec(x).map(v=>v.toFixed(8)).join('|'))).size>=4);assert.ok(new Set(xs.map(t3)).size>=4);});
test('HOME/AWAY swap changes asymmetric prediction',()=>{const home='Swap Strong',away='Swap Weak',strong=mk(home,'Opp S','ss',P.strong),weak=mk(away,'Opp W','sw',P.weak);const a=buildPrediction({home,away,targetDate,homePayload:strong,awayPayload:weak,h2hPayload:[]}),b=buildPrediction({home:away,away:home,targetDate,homePayload:weak,awayPayload:strong,h2hPayload:[]});assert.notDeepEqual(vec(a),vec(b));assert.notEqual(t3(a),t3(b));});
test('diversity profile remains deterministic over 25 runs',()=>{const args={home:'Repeat Home',away:'Repeat Away',targetDate,homePayload:mk('Repeat Home','Opp H','rh',P.volatile),awayPayload:mk('Repeat Away','Opp A','ra',P.low),h2hPayload:[]};const base=buildPrediction(args);for(let i=0;i<25;i++)assert.deepEqual(buildPrediction(args),base);});
