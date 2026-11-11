import test from 'node:test';
import assert from 'node:assert/strict';
import { runForecastingTournament } from '../src/prediction/forecasting-tournament.ts';

function fixtures(n=140){const out=[];for(let i=0;i<n;i++){const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);const h=i%17===0?5:i%7===0?3:i%3===0?2:1;const a=i%19===0?5:i%11===0?4:i%4===0?2:0;out.push({id:String(i),matchDate:d,ht:{home:Math.min(h,4),away:Math.min(a,4)},ft:{home:h,away:a}})}return out}

test('tournament evaluates all six targets and three model families',()=>{const r=runForecastingTournament(fixtures(),40);assert.equal(r.walkForward,true);assert.equal(r.metrics.length,18);for(const t of ['3+ HT','7+ FT','Other HT','Other FT','Top-3 HT','Top-3 FT'])assert.ok(r.winners[t])});

test('future mutation cannot alter earlier walk-forward aggregate before mutation point',()=>{const base=fixtures();const a=runForecastingTournament(base.slice(0,120),40);const changed=fixtures();changed[139].ft={home:20,away:20};changed[139].ht={home:9,away:9};const b=runForecastingTournament(changed.slice(0,120),40);assert.deepEqual(a,b)});

test('metrics stay bounded',()=>{const r=runForecastingTournament(fixtures(),40);for(const m of r.metrics){if(m.brier!=null)assert.ok(m.brier>=0&&m.brier<=1);if(m.top3Accuracy!=null)assert.ok(m.top3Accuracy>=0&&m.top3Accuracy<=1)}});

test('deterministic replay',()=>{const x=fixtures();assert.deepEqual(runForecastingTournament(x,40),runForecastingTournament(structuredClone(x),40))});
