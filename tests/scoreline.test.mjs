import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastScorelines, scorelineMarketConsistency } from '../src/prediction/scoreline.ts';

const rows=(n)=>Array.from({length:n},(_,i)=>({matchDate:`2026-0${Math.floor(i/9)+1}-${String((i%9)+1).padStart(2,'0')}`,htHome:i%3===0?1:0,htAway:i%4===0?1:0,ftHome:1+(i%3),ftAway:i%2}));

test('returns top-3 HT and FT scorelines',()=>{
 const f=forecastScorelines({targetDate:'2026-08-15',homeHistory:rows(18),awayHistory:rows(18),h2hHistory:rows(4)});
 assert.equal(f.ht.length,3); assert.equal(f.ft.length,3);
 assert.match(f.mostLikelyPath,/HT .* → FT /);
 for(const x of [...f.ht,...f.ft]) assert.ok(x.probability>0 && x.probability<1);
});

test('is strict-prior and ignores target/future rows',()=>{
 const future={matchDate:'2027-01-01',htHome:9,htAway:9,ftHome:9,ftAway:9};
 const a=forecastScorelines({targetDate:'2026-08-15',homeHistory:rows(12),awayHistory:rows(12)});
 const b=forecastScorelines({targetDate:'2026-08-15',homeHistory:[...rows(12),future],awayHistory:[...rows(12),future]});
 assert.deepEqual(a,b);
});

test('flags obvious market/scoreline inconsistency',()=>{
 const f=forecastScorelines({targetDate:'2026-08-15',homeHistory:[],awayHistory:[]});
 const warnings=scorelineMarketConsistency(f,{'3+ HT':.8,'7+ FT':.8});
 assert.ok(warnings.length>=1);
});
