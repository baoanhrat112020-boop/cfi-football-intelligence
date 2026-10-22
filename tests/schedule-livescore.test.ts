import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleClient, esdToMs, vnDayWindow, mapEvent } from '../cloudflare-worker/src/schedule-livescore.ts';

const stage=(name:string,cnm:string,events:any[])=>({Snm:name,Cnm:cnm,Events:events});
const ev=(eid:string,esd:string,epr:number,tr1:any,tr2:any,eps='NS')=>({Eid:eid,Esd:esd,Epr:epr,Eps:eps,Tr1:tr1,Tr2:tr2,T1:[{Nm:'H'+eid}],T2:[{Nm:'A'+eid}]});

test('esdToMs and vnDayWindow',()=>{
  assert.equal(esdToMs('20261022130000'),Date.UTC(2026,9,22,13,0,0));
  assert.equal(esdToMs('x'),null);
  const w=vnDayWindow('2026-10-22')!;
  assert.equal(new Date(w.start).toISOString(),'2026-10-21T17:00:00.000Z');
  assert.equal(vnDayWindow('bad'),null);
});

test('mapEvent maps live, finished and not started',()=>{
  assert.equal(mapEvent(ev('1','20261022130000',0,null,null))!.st,'ns');
  const l=mapEvent(ev('2','20261022130000',1,1,0,"34'"))!;
  assert.deepEqual([l.st,l.m,l.hs,l.as],['live',"34'",1,0]);
  assert.equal(mapEvent(ev('3','20261022130000',2,2,2,'FT'))!.st,'ft');
});

test('getSchedule filters to the VN day, hides leagues, groups and sorts',async()=>{
  const calls:string[]=[];
  const fetchImpl=async(u:string)=>{
    calls.push(u);
    const d=u.match(/soccer\/(\d{8})\//)![1];
    const body=d==='20261021'
      ?[stage('Premier League','England',[ev('1','20261021180000',0,null,null),ev('2','20261021130000',2,1,1,'FT')])]
      :[stage('Premier League','England',[ev('3','20261022020000',0,null,null),ev('4','20261022180000',0,null,null)]),stage('Oberliga','Germany',[ev('5','20261022020000',0,null,null)])];
    return{ok:true,status:200,json:async()=>({Stages:body})};
  };
  const c=createScheduleClient({fetchImpl,now:()=>1});
  const r=(await c.getSchedule('2026-10-22',n=>/Oberliga/.test(n)))!;
  assert.equal(r.status,'ok');
  assert.equal(r.total,2);
  assert.deepEqual(r.stages[0].e.map(e=>e.id),['1','3']);
  assert.equal(calls.length,2);
  await c.getSchedule('2026-10-22',()=>false);
  assert.equal(calls.length,2);
});

test('getSchedule reports off when source fails and degraded on stale',async()=>{
  let t=0,fail=false;
  const fetchImpl=async()=>fail?{ok:false,status:503,json:async()=>({})}:{ok:true,status:200,json:async()=>({Stages:[stage('L','C',[ev('1','20261022020000',0,null,null)])]})};
  const c=createScheduleClient({fetchImpl,now:()=>t});
  fail=true;
  assert.equal((await c.getSchedule('2026-10-22',()=>false))!.status,'off');
  fail=false;t=100000;
  assert.equal((await c.getSchedule('2026-10-22',()=>false))!.status,'ok');
  fail=true;t=140000;
  assert.equal((await c.getSchedule('2026-10-22',()=>false))!.status,'degraded');
});
