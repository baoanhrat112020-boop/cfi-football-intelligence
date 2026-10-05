import test from 'node:test';
import assert from 'node:assert/strict';
import { sameTeam, teamKey, parseLiveTime, parseFotmobList, matchPicks, toLive, createLiveClient, daysFor, enrichLive } from '../cloudflare-worker/src/live-fotmob.ts';

const MIN=60*1000;
const T0=Date.parse('2026-10-05T10:00:00Z');

function fmMatch(over:any={}){
  return {id:1,t:T0,home:'Alpha',away:'Beta',started:true,finished:false,cancelled:false,reason:null,scoreH:1,scoreA:0,liveShort:"23‎’‎",liveKey:'',...over};
}

test('team names must match exactly after normalization and suffix must be equal',()=>{
  assert.equal(sameTeam('CD Recoleta','Recoleta'),true);
  assert.equal(sameTeam('Real Madrid','Real Sociedad'),false);
  assert.equal(sameTeam('Manchester United','Manchester City'),false);
  assert.equal(sameTeam('Japan','Japan U21'),false);
  assert.equal(sameTeam('Japan U21','Japan U19'),false);
  assert.equal(sameTeam('Viking 2','Viking'),false);
  assert.equal(sameTeam('Odds Ballklubb 2','Odds BK 2'),false);
  assert.equal(sameTeam('Sønderjyske','Sonderjyske'),true);
  assert.equal(sameTeam('PAOK Thessaloniki FC B','PAOK Thessaloniki B'),true);
  assert.equal(sameTeam('','x'),false);
  assert.deepEqual(teamKey('Brentford Academy'),{core:'brentford',suf:'academy'});
});

test('liveTime parsing strips hidden marks and keeps added time text',()=>{
  assert.deepEqual(parseLiveTime("64‎’‎"),{kind:'minute',minute:64,text:"64'"});
  assert.deepEqual(parseLiveTime("45+2’"),{kind:'minute',minute:45,text:"45+2'"});
  assert.equal(parseLiveTime('IR','interrupted_short').kind,'ir');
  assert.equal(parseLiveTime('HT').kind,'ht');
  assert.equal(parseLiveTime('weird').kind,'other');
  assert.equal(parseLiveTime(null).kind,'other');
});

test('FotMob list parser reads scores, status flags and live time',()=>{
  const list=parseFotmobList({leagues:[{matches:[
    {id:7,home:{name:'A'},away:{name:'B'},status:{utcTime:'2026-10-05T10:00:00.000Z',started:true,finished:false,scoreStr:'2 - 1',liveTime:{short:'64’',shortKey:''}}},
    {id:8,home:{name:'C'},away:{name:'D'},status:{utcTime:'2026-10-05T11:00:00.000Z',cancelled:true,reason:{short:'PP'}}},
    {id:9,home:{name:'E'},away:{name:'F'},status:{utcTime:'bad'}}
  ]}]});
  assert.equal(list.length,2);
  assert.equal(list[0].scoreH,2);
  assert.equal(list[0].scoreA,1);
  assert.equal(list[1].cancelled,true);
  assert.equal(list[1].reason,'PP');
});

test('matching is one-to-one both ways and respects the 15 minute window',()=>{
  const picks=[{key:'p1',home:'Alpha',away:'Beta',kickoff:T0},{key:'p2',home:'Gamma',away:'Delta',kickoff:T0}];
  const fm=[
    fmMatch({id:1,home:'Alpha FC',away:'Beta',t:T0+10*MIN}),
    fmMatch({id:2,home:'Gamma',away:'Delta',t:T0+20*MIN})
  ];
  const misses:string[]=[];
  const out=matchPicks(picks,fm,(p,r)=>misses.push(p.key+':'+r));
  assert.equal(out.size,1);
  assert.equal(out.get('p1')?.id,1);
  assert.deepEqual(misses,['p2:no_match']);
});

test('ambiguous candidates are rejected on either side',()=>{
  const dup=[fmMatch({id:1}),fmMatch({id:2})];
  const m1=new Map();
  const out1=matchPicks([{key:'p',home:'Alpha',away:'Beta',kickoff:T0}],dup,(p,r)=>m1.set(p.key,r));
  assert.equal(out1.size,0);
  assert.equal(m1.get('p'),'ambiguous_pick');
  const m2=new Map();
  const out2=matchPicks([{key:'a',home:'Alpha',away:'Beta',kickoff:T0},{key:'b',home:'Alpha FC',away:'Beta',kickoff:T0+5*MIN}],[fmMatch({id:1})],(p,r)=>m2.set(p.key,r));
  assert.equal(out2.size,0);
  assert.equal(m2.get('a'),'ambiguous_fotmob');
});

test('toLive maps statuses and applies sanity checks',()=>{
  const now=T0+23*MIN;
  const live=toLive(fmMatch(),T0,now);
  assert.equal(live?.live_status,'live');
  assert.equal(live?.live_minute,23);
  assert.equal(live?.live_minute_text,"23'");
  assert.equal(live?.live_score_home,1);
  assert.equal(live?.live_source,'fotmob');
  assert.equal(toLive(fmMatch({liveShort:"80’"}),T0,now),null);
  assert.equal(toLive(fmMatch({started:false}),T0,now),null);
  assert.equal(toLive(fmMatch({finished:true,liveShort:null}),T0,T0+20*MIN),null);
  assert.equal(toLive(fmMatch({finished:true,liveShort:null,scoreH:2,scoreA:2}),T0,T0+110*MIN)?.live_status,'ft');
  assert.equal(toLive(fmMatch({liveShort:'IR',liveKey:'interrupted_short'}),T0,now)?.live_status,'ir');
  assert.equal(toLive(fmMatch({liveShort:'HT'}),T0,T0+55*MIN)?.live_status,'ht');
  assert.equal(toLive(fmMatch({liveShort:'HT'}),T0,T0+5*MIN),null);
  assert.equal(toLive(fmMatch({started:false,cancelled:true,reason:'PP'}),T0,now)?.live_status,'postponed');
  assert.equal(toLive(fmMatch({started:false,cancelled:true,reason:'Can'}),T0,now)?.live_status,'cancelled');
  assert.equal(toLive(fmMatch({liveShort:'???'}),T0,now)?.live_status,'unknown');
});

test('days include the adjacent UTC day close to midnight',()=>{
  assert.deepEqual(daysFor([Date.parse('2026-10-05T12:00:00Z')]),['20261005']);
  assert.deepEqual(daysFor([Date.parse('2026-10-05T00:05:00Z')]),['20261004','20261005']);
  assert.deepEqual(daysFor([Date.parse('2026-10-05T23:55:00Z')]),['20261005','20261006']);
});

function mockFetch(script:(n:number,url:string)=>any){
  let n=0;
  const calls:string[]=[];
  const fn=async(url:string)=>{calls.push(url);n++;return script(n,url)};
  return{fn,calls};
}
const okBody=(list:any)=>({ok:true,status:200,json:async()=>({leagues:[{matches:list}]})});
const sample=[{id:1,home:{name:'Alpha'},away:{name:'Beta'},status:{utcTime:'2026-10-05T10:00:00.000Z',started:true,finished:false,scoreStr:'1 - 0',liveTime:{short:'23’'}}}];

test('cache keeps data 60s, reuses stale data up to 3 minutes and then gives up',async()=>{
  let clock=T0;
  let fail=false;
  const f=mockFetch(()=>fail?{ok:false,status:500}:okBody(sample));
  const c=createLiveClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
  let r=await c.getDays(['20261005']);
  assert.equal(r.status,'ok');
  assert.equal(r.matches.length,1);
  clock+=30*1000;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,1);
  fail=true;
  clock+=40*1000;
  r=await c.getDays(['20261005']);
  assert.equal(f.calls.length,2);
  assert.equal(r.status,'degraded');
  assert.equal(r.matches.length,1);
  clock+=3*MIN;
  r=await c.getDays(['20261005']);
  assert.equal(r.status,'off');
  assert.equal(r.matches.length,0);
});

test('breaker opens after 3 soft failures, probes after 10 minutes and closes on one success',async()=>{
  let clock=T0;
  let mode='fail';
  const f=mockFetch(()=>mode==='fail'?{ok:false,status:503}:okBody(sample));
  const c=createLiveClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
  for(let i=0;i<3;i++){
    const r=await c.getDays(['20261005']);
    assert.equal(r.status,'off');
    clock+=1000;
  }
  assert.equal(c.breaker.open,true);
  assert.equal(f.calls.length,3);
  clock+=5*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,3);
  clock+=6*MIN;
  mode='ok';
  const r=await c.getDays(['20261005']);
  assert.equal(f.calls.length,4);
  assert.equal(r.status,'ok');
  assert.equal(c.breaker.open,false);
  assert.equal(c.breaker.fails,0);
});

test('blocked responses (403/429) wait 60 minutes between single probes',async()=>{
  let clock=T0;
  const f=mockFetch(()=>({ok:false,status:403}));
  const c=createLiveClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
  for(let i=0;i<3;i++){await c.getDays(['20261005']);clock+=1000}
  assert.equal(c.breaker.open,true);
  assert.equal(f.calls.length,3);
  clock+=30*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,3);
  clock+=31*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,4);
  assert.equal(c.breaker.open,true);
  clock+=10*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,4);
});

test('warnings are throttled and timeouts count as soft failures',async()=>{
  let clock=T0;
  const warnings:string[]=[];
  const f=mockFetch(()=>{throw Object.assign(new Error('t'),{name:'TimeoutError'})});
  const c=createLiveClient({fetchImpl:f.fn,now:()=>clock,warn:m=>warnings.push(m)});
  for(let i=0;i<3;i++){await c.getDays(['20261005']);clock+=1000}
  assert.equal(warnings.length,1);
  assert.equal(c.breaker.open,true);
});

test('enrichLive only calls FotMob when a pick started within the last two hours and never throws away other fields',async()=>{
  const now=T0+23*MIN;
  const f=mockFetch(()=>okBody(sample));
  const c=createLiveClient({fetchImpl:f.fn,now:()=>now,warn:()=>{}});
  const future={fixture_id:'f0',home:'X',away:'Y',kickoff:new Date(now+60*MIN).toISOString(),pred_home_ft:1};
  const old={fixture_id:'f1',home:'Alpha',away:'Beta',kickoff:new Date(now-200*MIN).toISOString()};
  let meta=await enrichLive([future,old],now,false,c);
  assert.deepEqual(meta,{candidates:0,matched:0,status:'ok'});
  assert.equal(f.calls.length,0);
  assert.equal((future as any).live_status,undefined);
  const cur={fixture_id:'f2',home:'Alpha FC',away:'Beta',kickoff:new Date(T0).toISOString(),pred_home_ft:2};
  const other={fixture_id:'f3',home:'No',away:'Match',kickoff:new Date(T0).toISOString()};
  meta=await enrichLive([cur,other],now,false,c);
  assert.deepEqual(meta,{candidates:2,matched:1,status:'ok'});
  assert.equal((cur as any).live_status,'live');
  assert.equal((cur as any).live_minute,23);
  assert.equal((cur as any).pred_home_ft,2);
  assert.equal((other as any).live_status,null);
  assert.equal((other as any).live_source,null);
  assert.equal(f.calls.length,1);
});

test('enrichLive reports off and leaves fields null when FotMob is unavailable',async()=>{
  const now=T0+23*MIN;
  const f=mockFetch(()=>({ok:false,status:403}));
  const c=createLiveClient({fetchImpl:f.fn,now:()=>now,warn:()=>{}});
  const cur={fixture_id:'f2',home:'Alpha',away:'Beta',kickoff:new Date(T0).toISOString()};
  const meta=await enrichLive([cur],now,false,c);
  assert.equal(meta.status,'off');
  assert.equal(meta.matched,0);
  assert.equal((cur as any).live_status,null);
});
