import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, MARKET_CODES } from '../src/prediction/final-engine.ts';
import { FUTURE_SIX_SCORELINE_VERSION } from '../src/prediction/future-six-scoreline.ts';

const fixtures=[];
for(let i=0;i<80;i++){const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);const home=i%2===0?'Alpha':'Beta',away=i%2===0?'Beta':'Alpha';const ht=i%9===0?{home:3,away:1}:{home:i%3===0?1:0,away:i%5===0?1:0};const ft=i%11===0?{home:5,away:3}:{home:ht.home+1,away:ht.away+1};fixtures.push({id:String(i),matchDate:d,homeTeam:home,awayTeam:away,ht,ft});}

// HARD GATE: do not weaken this assertion to make CI green. FINAL threshold
// probabilities and the scoreline model must share one coherent probability model.
test('all four final market probabilities are exact integrals of the final score distribution',()=>{const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});for(const market of MARKET_CODES){const row=p.markets[market];assert.ok(Number.isFinite(row.methodA));assert.ok(Number.isFinite(row.methodB));assert.ok(Number.isFinite(row.final));assert.equal(row.final,row.scorelineMass);assert.equal(row.consistency.status,'PASS');assert.equal(row.consistency.finalDelta,0);assert.equal(row.consistency.construction,'FINAL_MARKET_IS_INTEGRAL_OF_FINAL_SCORE_DISTRIBUTION');}});

test('Top-3 scorelines are presentation ranks from complete A/B/final distributions',()=>{const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});for(const side of ['ht','ft']){assert.equal(p.scoreline[side].methodA.length,3);assert.equal(p.scoreline[side].methodB.length,3);assert.equal(p.scoreline[side].final.length,3);}assert.equal(p.scoreline.consistencyWarnings.length,0);});

test('Future Six remains traceable inside every market consistency record',()=>{const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});assert.equal(p.scoreline.futureSix.version,FUTURE_SIX_SCORELINE_VERSION);for(const market of MARKET_CODES)assert.ok(p.markets[market].supportingFactors.includes(`future_six:${FUTURE_SIX_SCORELINE_VERSION}`));});
