import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverFixtures } from '../src/discovery/cfi-discovery.ts';

const event=(id:string,home:string,away:string,ts:string,league:string)=>({
  idEvent:id,strHomeTeam:home,strAwayTeam:away,strLeague:league,strCountry:'Europe',strTimestamp:ts,strStatus:'NS'
});

test('five-row discovery combines league next and league-filtered day without crossing local date',async()=>{
  const targetDate='2026-08-27';
  const nowMs=Date.parse('2026-08-27T11:00:00Z');
  const fetchFn:any=async(url:string)=>{
    if(url.includes('sofascore.com'))return Response.json({events:[]});
    if(url.includes('eventsday.php')&&url.includes('s=Soccer'))return Response.json({events:[]});
    if(url.includes('eventsnextleague.php?id=4481'))return Response.json({events:[event('e1','Ararat-Armenia','Universitatea Craiova','2026-08-27T16:00:00','UEFA Europa League')]});
    if(url.includes('eventsnextleague.php?id=5071'))return Response.json({events:[event('c1','KuPS','Shamrock Rovers','2026-08-27T15:00:00','UEFA Conference League')]});
    if(url.includes('eventsnextleague.php'))return Response.json({events:[]});
    if(url.includes('eventsday.php?d=2026-08-27&l=4481'))return Response.json({events:[
      event('e1','Ararat-Armenia','Universitatea Craiova','2026-08-27T16:00:00','UEFA Europa League'),
      event('e2','Iberia 1999','Jagiellonia Bialystok','2026-08-27T16:00:00','UEFA Europa League'),
      event('e3','Viktoria Plzen','Crvena Zvezda','2026-08-27T17:00:00','UEFA Europa League'),
    ]});
    if(url.includes('eventsday.php?d=2026-08-27&l=5071'))return Response.json({events:[
      event('c1','KuPS','Shamrock Rovers','2026-08-27T15:00:00','UEFA Conference League'),
      event('c2','Freiburg','Motherwell','2026-08-27T16:45:00','UEFA Conference League'),
      event('c3','Monaco','Gornik Zabrze','2026-08-27T16:45:00','UEFA Conference League'),
    ]});
    if(url.includes('thesportsdb.com'))return Response.json({events:[]});
    if(url.includes('site.api.espn.com'))throw new Error('ESPN should not be reached after five rows are found');
    return Response.json({events:[]});
  };

  const out=await discoverFixtures({targetDate,timeZone:'Asia/Ho_Chi_Minh',nowMs,minimumRows:5},fetchFn);
  assert.equal(out.rows.length,5);
  assert.equal(out.search.targetSatisfied,true);
  assert.equal(out.search.espnLeaguesAttempted,0);
  assert.deepEqual(out.rows.map((row:any)=>row.home),['KuPS','Ararat-Armenia','Iberia 1999','Freiburg','Monaco']);
  assert.ok(out.rows.every((row:any)=>row.targetDate===targetDate));
  assert.ok(out.rows.every((row:any)=>row.kickoffLocal<'24:00'));
  assert.equal(out.rows.some((row:any)=>row.home==='Viktoria Plzen'),false);
});
