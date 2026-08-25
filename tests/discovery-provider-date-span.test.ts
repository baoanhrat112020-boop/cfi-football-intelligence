import test from 'node:test';
import assert from 'node:assert/strict';
import { providerQueryDates, discoverFixtures } from '../src/discovery/cfi-discovery.ts';

test('provider query dates cover adjacent UTC dates for a local discovery day',()=>{
  assert.deepEqual(providerQueryDates('2026-08-26'),['2026-08-25','2026-08-26','2026-08-27']);
});

test('discoverFixtures retains only fixtures landing on requested local date across adjacent provider dates',async()=>{
  const requested:string[]=[];
  const fetchFn=async(input:any)=>{
    const url=String(input);requested.push(url);
    if(url.includes('thesportsdb.com')&&url.includes('d=2026-08-25')){
      return new Response(JSON.stringify({events:[{idEvent:'x1',strHomeTeam:'Home FC',strAwayTeam:'Away FC',strLeague:'Test League',strCountry:'Test',strStatus:'NS',strTimestamp:'2026-08-25T23:30:00Z'}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify(url.includes('thesportsdb.com')?{events:[]}:{events:[]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const out=await discoverFixtures({targetDate:'2026-08-26',timeZone:'Asia/Ho_Chi_Minh',nowMs:Date.parse('2026-08-25T20:00:00Z')},fetchFn as any);
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].provider,'THESPORTSDB');
  assert.equal(out.rows[0].kickoffLocal,'06:30');
  assert.equal(out.rows[0].targetDate,'2026-08-26');
  assert.ok(requested.some(u=>u.includes('d=2026-08-25')));
  assert.ok(requested.some(u=>u.includes('d=2026-08-26')));
  assert.ok(requested.some(u=>u.includes('d=2026-08-27')));
});
