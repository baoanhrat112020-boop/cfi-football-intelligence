import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLivescoreDay, toLive, createLivescoreClient, enrichLive, utcDay } from '../cloudflare-worker/src/live-livescore.ts';

const MIN=60*1000;
const T0=Date.parse('2026-10-05T10:00:00Z');

function ev(over:any={}){
  return{eid:'1',home:'Alpha',away:'Beta',epr:1,eps:"23'",esd:20261005100000,tr1:1,tr2:0,rtm:null,...over};
}

function rawEvent(over:any={}){
  return{Eid:'100',T1:[{Nm:'Alpha'}],T2:[{Nm:'Beta'}],Eps:"23'",Epr:1,Esd:20261005100000,Tr1:'1',Tr2:'0',Etm:{RTm:1380000},...over};
}
const body=(events:any[])=>({Stages:[{Snm:'League',Cnm:'Country',Events:events}]});

test('parser reads Stages and Events and tolerates missing score fields',()=>{
  const list=parseLivescoreDay(body([rawEvent(),rawEvent({Eid:'101',Epr:0,Eps:'NS',Tr1:undefined,Tr2:undefined,Etm:undefined}),{T1:[],T2:[]}]));
  assert.equal(list?.length,2);
  assert.equal(list?.[0].eid,'100');
  assert.equal(list?.[0].tr1,1);
  assert.equal(list?.[0].rtm,1380000);
  assert.equal(list?.[1].tr1,null);
  assert.equal(list?.[1].epr,0);
  assert.equal(parseLivescoreDay({}),null);
  assert.equal(parseLivescoreDay(null),null);
  assert.deepEqual(parseLivescoreDay({Stages:[]}),[]);
});

test('status mapping uses Epr codes',()=>{
  assert.equal(toLive(ev({epr:0,eps:'NS',tr1:null,tr2:null})),null);
  const live=toLive(ev());
  assert.equal(live?.live_status,'live');
  assert.equal(live?.live_minute,23);
  assert.equal(live?.live_minute_text,"23'");
  assert.equal(live?.live_score_home,1);
  assert.equal(live?.live_source,'livescore');
  assert.equal(toLive(ev({epr:2,eps:'FT',tr1:2,tr2:2}))?.live_status,'ft');
  assert.equal(toLive(ev({epr:2,eps:'AET'}))?.live_status,'ft');
  assert.equal(toLive(ev({epr:2,eps:'AP'}))?.live_status,'ft');
  assert.equal(toLive(ev({epr:3,eps:'Canc.',tr1:null,tr2:null}))?.live_status,'cancelled');
  assert.equal(toLive(ev({epr:4,eps:'Postp.',tr1:null,tr2:null}))?.live_status,'postponed');
  assert.equal(toLive(ev({epr:6,eps:'ToFi'}))?.live_status,'ir');
  assert.equal(toLive(ev({epr:6,eps:'ToFi',tr1:null,tr2:null}))?.live_status,'ir');
  assert.equal(toLive(ev({epr:9}))?.live_status,'unknown');
  assert.equal(toLive(ev({epr:null}))?.live_status,'unknown');
});

test('half time, added time and running-clock fallback',()=>{
  assert.equal(toLive(ev({eps:'HT'}))?.live_status,'ht');
  assert.equal(toLive(ev({eps:'HT'}))?.live_minute,null);
  const added=toLive(ev({eps:"45+2'"}));
  assert.equal(added?.live_minute,45);
  assert.equal(added?.live_minute_text,"45+2'");
  const clock=toLive(ev({eps:'weird',rtm:34*MIN}));
  assert.equal(clock?.live_status,'live');
  assert.equal(clock?.live_minute,34);
  const noMinute=toLive(ev({eps:'weird',rtm:null}));
  assert.equal(noMinute?.live_status,'live');
  assert.equal(noMinute?.live_minute,null);
});

test('sanity: minute above 130 or unreadable score is rejected for live states',()=>{
  assert.equal(toLive(ev({eps:"140'"})),null);
  assert.equal(toLive(ev({tr1:null,tr2:null})),null);
  assert.equal(toLive(ev({epr:2,tr1:null,tr2:null})),null);
  assert.equal(toLive(ev({eps:"130'"}))?.live_status,'live');
});

function mockFetch(script:(n:number,url:string)=>any){
  let n=0;
  const calls:string[]=[];
  const fn=async(url:string)=>{calls.push(url);n++;return script(n,url)};
  return{fn,calls};
}
const ok=(events:any[])=>({ok:true,status:200,json:async()=>body(events)});

test('cache lasts 30s, stale data is reused up to 3 minutes and then dropped',async()=>{
  let clock=T0;
  let fail=false;
  const f=mockFetch(()=>fail?{ok:false,status:500}:ok([rawEvent()]));
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
  let r=await c.getDays(['20261005']);
  assert.equal(r.status,'ok');
  assert.equal(r.events.size,1);
  assert.match(f.calls[0],/date\/soccer\/20261005\/0\?MD=1$/);
  clock+=20*1000;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,1);
  fail=true;
  clock+=20*1000;
  r=await c.getDays(['20261005']);
  assert.equal(f.calls.length,2);
  assert.equal(r.status,'degraded');
  assert.equal(r.events.size,1);
  clock+=3*MIN;
  r=await c.getDays(['20261005']);
  assert.equal(r.status,'off');
  assert.equal(r.events.size,0);
});

test('200 responses that are not JSON, lack Stages or return zero events count as soft failures',async()=>{
  for(const bad of [
    {ok:true,status:200,json:async()=>{throw new Error('x')}},
    {ok:true,status:200,json:async()=>({nope:1})},
    {ok:true,status:200,json:async()=>({Stages:[]})}
  ]){
    let clock=T0;
    const f=mockFetch(()=>bad);
    const c=createLivescoreClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
    for(let i=0;i<3;i++){await c.getDays(['20261005']);clock+=1000}
    assert.equal(c.breaker.open,true);
    assert.equal(c.breaker.nextProbeAt-clock<=10*MIN,true);
  }
});

test('breaker: soft failures wait 10 minutes, 403/429 wait 60, one success resets',async()=>{
  let clock=T0;
  let mode='soft';
  const f=mockFetch(()=>mode==='soft'?{ok:false,status:503}:mode==='block'?{ok:false,status:429}:ok([rawEvent()]));
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>clock,warn:()=>{}});
  for(let i=0;i<3;i++){await c.getDays(['20261005']);clock+=1000}
  assert.equal(c.breaker.open,true);
  assert.equal(f.calls.length,3);
  clock+=5*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,3);
  clock+=6*MIN;
  mode='block';
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,4);
  clock+=30*MIN;
  await c.getDays(['20261005']);
  assert.equal(f.calls.length,4);
  clock+=31*MIN;
  mode='ok';
  const r=await c.getDays(['20261005']);
  assert.equal(f.calls.length,5);
  assert.equal(r.status,'ok');
  assert.equal(c.breaker.open,false);
  assert.equal(c.breaker.fails,0);
});

test('warnings are throttled',async()=>{
  let clock=T0;
  const warnings:string[]=[];
  const f=mockFetch(()=>{throw Object.assign(new Error('t'),{name:'TimeoutError'})});
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>clock,warn:m=>warnings.push(m)});
  for(let i=0;i<3;i++){await c.getDays(['20261005']);clock+=1000}
  assert.equal(warnings.length,1);
});

test('enrichLive matches by provider id and reports counters',async()=>{
  const now=T0+23*MIN;
  const f=mockFetch(()=>ok([
    rawEvent({Eid:'100'}),
    rawEvent({Eid:'101',Epr:0,Eps:'NS',Tr1:undefined,Tr2:undefined,Etm:undefined}),
    rawEvent({Eid:'102',Epr:2,Eps:'FT',Tr1:'3',Tr2:'1'}),
    rawEvent({Eid:'103',Epr:4,Eps:'Postp.',Tr1:undefined,Tr2:undefined})
  ]));
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>now,warn:()=>{}});
  const k=new Date(T0).toISOString();
  const future={fixture_id:'f0',provider_id:'100',home:'X',away:'Y',kickoff:new Date(now+60*MIN).toISOString()};
  const old={fixture_id:'f9',provider_id:'100',home:'X',away:'Y',kickoff:new Date(now-200*MIN).toISOString()};
  const live={fixture_id:'f1',provider_id:'100',home:'A',away:'B',kickoff:k,pred_home_ft:2};
  const ns={fixture_id:'f2',provider_id:'101',home:'C',away:'D',kickoff:k};
  const ft={fixture_id:'f3',provider_id:'102',home:'E',away:'F',kickoff:k};
  const pp={fixture_id:'f4',provider_id:'103',home:'G',away:'H',kickoff:k};
  const lost={fixture_id:'f5',provider_id:'999',home:'I',away:'J',kickoff:k};
  const noid={fixture_id:'f6',provider_id:null,home:'K',away:'L',kickoff:k};
  const meta=await enrichLive([future,old,live,ns,ft,pp,lost,noid],now,true,c);
  assert.deepEqual(meta,{candidates:6,matched:3,eid_missing:1,not_found:1,status:'ok'});
  assert.equal((live as any).live_status,'live');
  assert.equal((live as any).live_minute,23);
  assert.equal((live as any).pred_home_ft,2);
  assert.equal((ft as any).live_status,'ft');
  assert.equal((ft as any).live_score_home,3);
  assert.equal((pp as any).live_status,'postponed');
  assert.equal((ns as any).live_status,null);
  assert.equal((lost as any).live_status,null);
  assert.equal((noid as any).live_source,null);
  assert.equal((future as any).live_status,undefined);
  assert.equal(f.calls.length,1);
});

test('enrichLive does not fetch when nothing started in the last two hours or no provider ids exist',async()=>{
  const now=T0+23*MIN;
  const f=mockFetch(()=>ok([rawEvent()]));
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>now,warn:()=>{}});
  let meta=await enrichLive([{fixture_id:'a',provider_id:'100',home:'X',away:'Y',kickoff:new Date(now+30*MIN).toISOString()}],now,false,c);
  assert.deepEqual(meta,{candidates:0,matched:0,eid_missing:0,not_found:0,status:'ok'});
  meta=await enrichLive([{fixture_id:'b',home:'X',away:'Y',kickoff:new Date(T0).toISOString()}],now,false,c);
  assert.deepEqual(meta,{candidates:1,matched:0,eid_missing:1,not_found:0,status:'ok'});
  assert.equal(f.calls.length,0);
});

test('enrichLive fetches one list per UTC kickoff date and reports off when the source fails',async()=>{
  const now=Date.parse('2026-10-06T00:30:00Z');
  const f=mockFetch(()=>({ok:false,status:403}));
  const c=createLivescoreClient({fetchImpl:f.fn,now:()=>now,warn:()=>{}});
  const a={fixture_id:'a',provider_id:'1',home:'A',away:'B',kickoff:'2026-10-05T23:30:00Z'};
  const b={fixture_id:'b',provider_id:'2',home:'C',away:'D',kickoff:'2026-10-06T00:00:00Z'};
  const meta=await enrichLive([a,b],now,false,c);
  assert.equal(f.calls.length,2);
  assert.equal(meta.status,'off');
  assert.equal(meta.matched,0);
  assert.equal((a as any).live_status,null);
  assert.equal(utcDay(Date.parse(a.kickoff)),'20261005');
});
