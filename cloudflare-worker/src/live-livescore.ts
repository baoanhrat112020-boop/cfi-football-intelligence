export type LsEvent={
  eid:string;
  home:string;
  away:string;
  epr:number|null;
  eps:string|null;
  esd:number|null;
  tr1:number|null;
  tr2:number|null;
  rtm:number|null;
};

export type LiveFields={
  live_score_home:number|null;
  live_score_away:number|null;
  live_minute:number|null;
  live_minute_text:string|null;
  live_status:'live'|'ht'|'ir'|'ft'|'postponed'|'cancelled'|'unknown'|null;
  live_source:'livescore'|null;
};

export type LiveMeta={candidates:number;matched:number;eid_missing:number;not_found:number;status:'ok'|'degraded'|'off'};

const API_BASE='https://prod-cdn-mev-api.livescore.com/v1/api/app/date/soccer/';
const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'};
const CACHE_TTL_MS=30*1000;
const MAX_AGE_MS=3*60*1000;
const FETCH_TIMEOUT_MS=3000;
const LIVE_WINDOW_MS=2*60*60*1000;
const MAX_MINUTE=130;
const BREAKER_FAILS=3;
const BLOCK_WAIT_MS=60*60*1000;
const SOFT_WAIT_MS=10*60*1000;
const WARN_EVERY_MS=60*1000;

function toInt(v:any){
  if(v==null||v==='')return null;
  const n=Number(v);
  return Number.isInteger(n)&&n>=0?n:null;
}

export function parseLivescoreDay(json:any):LsEvent[]|null{
  if(!json||!Array.isArray(json.Stages))return null;
  const out:LsEvent[]=[];
  for(const s of json.Stages){
    const evs=Array.isArray(s?.Events)?s.Events:[];
    for(const e of evs){
      if(e?.Eid==null)continue;
      const rtm=Number(e?.Etm?.RTm);
      out.push({
        eid:String(e.Eid),
        home:String(e?.T1?.[0]?.Nm??''),
        away:String(e?.T2?.[0]?.Nm??''),
        epr:Number.isInteger(Number(e.Epr))&&e.Epr!==null&&e.Epr!==''?Number(e.Epr):null,
        eps:e.Eps!=null?String(e.Eps):null,
        esd:Number.isFinite(Number(e.Esd))?Number(e.Esd):null,
        tr1:toInt(e.Tr1),
        tr2:toInt(e.Tr2),
        rtm:Number.isFinite(rtm)&&rtm>=0?rtm:null
      });
    }
  }
  return out;
}

export function emptyLive():LiveFields{
  return{live_score_home:null,live_score_away:null,live_minute:null,live_minute_text:null,live_status:null,live_source:null};
}

function parseMinute(eps:string|null,rtm:number|null){
  const text=String(eps??'').replace(/[‎‏]/g,'').trim();
  const m=text.match(/^(\d{1,3})(?:\+(\d{1,2}))?['’′]?$/);
  if(m){
    const base=Number(m[1]);
    return{minute:base,text:`${base}${m[2]?`+${m[2]}`:''}'`};
  }
  if(rtm!=null){
    const minute=Math.floor(rtm/60000);
    return{minute,text:`${minute}'`};
  }
  return null;
}

export function toLive(e:LsEvent):LiveFields|null{
  const base:LiveFields={...emptyLive(),live_source:'livescore'};
  const scored=(status:LiveFields['live_status'])=>{
    if(e.tr1==null||e.tr2==null)return null;
    return{...base,live_score_home:e.tr1,live_score_away:e.tr2,live_status:status};
  };
  switch(e.epr){
    case 0:
      return null;
    case 1:{
      if(/^ht$/i.test(String(e.eps??'').trim()))return scored('ht');
      const mn=parseMinute(e.eps,e.rtm);
      if(mn&&mn.minute>MAX_MINUTE)return null;
      const r=scored('live');
      if(!r)return null;
      if(mn){r.live_minute=mn.minute;r.live_minute_text=mn.text}
      return r;
    }
    case 2:
      return scored('ft');
    case 3:
      return{...base,live_status:'cancelled'};
    case 4:
      return{...base,live_status:'postponed'};
    case 6:
      return scored('ir')||{...base,live_status:'ir'};
    default:
      return scored('unknown')||{...base,live_status:'unknown'};
  }
}

type DayEntry={ts:number;events:Map<string,LsEvent>};
type Fetcher=(url:string,init:any)=>Promise<any>;

export function createLivescoreClient(opts?:{fetchImpl?:Fetcher;now?:()=>number;warn?:(msg:string)=>void}){
  const fetchImpl:Fetcher=opts?.fetchImpl||((u,i)=>fetch(u,i));
  const nowFn=opts?.now||(()=>Date.now());
  const warn=opts?.warn||((m:string)=>console.warn(m));
  const cache=new Map<string,DayEntry>();
  const inflight=new Map<string,Promise<Map<string,LsEvent>|null>>();
  const breaker={fails:0,open:false,nextProbeAt:0};
  let lastWarn=0;

  function warnOnce(msg:string){
    const t=nowFn();
    if(t-lastWarn<WARN_EVERY_MS)return;
    lastWarn=t;
    warn(msg);
  }

  function recordFailure(kind:'blocked'|'soft',label:string){
    breaker.fails++;
    if(breaker.fails>=BREAKER_FAILS||breaker.open){
      breaker.open=true;
      breaker.nextProbeAt=nowFn()+(kind==='blocked'?BLOCK_WAIT_MS:SOFT_WAIT_MS);
    }
    warnOnce(`livescore fetch failed: ${label} (fails=${breaker.fails}, open=${breaker.open})`);
  }

  async function fetchDay(day:string):Promise<Map<string,LsEvent>|null>{
    try{
      const res=await fetchImpl(`${API_BASE}${day}/0?MD=1`,{headers:HEADERS,signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
      if(!res.ok){
        recordFailure(res.status===403||res.status===429?'blocked':'soft',`http ${res.status}`);
        return null;
      }
      let json:any;
      try{json=await res.json()}catch(_e){recordFailure('soft','not_json');return null}
      const list=parseLivescoreDay(json);
      if(list===null){recordFailure('soft','bad_structure');return null}
      if(list.length===0){recordFailure('soft','empty_day');return null}
      const events=new Map<string,LsEvent>();
      for(const e of list)events.set(e.eid,e);
      breaker.fails=0;
      breaker.open=false;
      breaker.nextProbeAt=0;
      cache.set(day,{ts:nowFn(),events});
      return events;
    }catch(e:any){
      recordFailure('soft',String(e?.name||'error'));
      return null;
    }
  }

  async function getDay(day:string):Promise<{events:Map<string,LsEvent>|null;degraded:boolean}>{
    const now=nowFn();
    const hit=cache.get(day);
    if(hit&&now-hit.ts<CACHE_TTL_MS)return{events:hit.events,degraded:false};
    const stale=hit&&now-hit.ts<=MAX_AGE_MS?hit.events:null;
    if(breaker.open&&now<breaker.nextProbeAt)return{events:stale,degraded:stale!==null};
    if(breaker.open)breaker.nextProbeAt=now+SOFT_WAIT_MS;
    let p=inflight.get(day);
    if(!p){
      p=fetchDay(day).finally(()=>{inflight.delete(day)});
      inflight.set(day,p);
    }
    const events=await p;
    if(events)return{events,degraded:false};
    return{events:stale,degraded:stale!==null};
  }

  async function getDays(days:string[]){
    const all=new Map<string,LsEvent>();
    let ok=0,missing=0,degraded=false;
    for(const d of days){
      const r=await getDay(d);
      if(r.events){
        ok++;
        for(const [k,v] of r.events)all.set(k,v);
        if(r.degraded)degraded=true;
      }else missing++;
    }
    const status:LiveMeta['status']=ok===0?'off':(missing>0||degraded?'degraded':'ok');
    return{events:all,status};
  }

  return{getDays,breaker,cache};
}

export function utcDay(t:number){
  return new Date(t).toISOString().slice(0,10).replace(/-/g,'');
}

const defaultClient=createLivescoreClient();

export async function enrichLive(matches:any[],now:number,debug:boolean,client=defaultClient){
  const cands=matches.filter(m=>{
    const t=Date.parse(String(m?.kickoff??''));
    return Number.isFinite(t)&&t<now&&t>now-LIVE_WINDOW_MS;
  });
  const meta:LiveMeta={candidates:cands.length,matched:0,eid_missing:0,not_found:0,status:'ok'};
  if(cands.length===0)return meta;
  for(const m of cands)Object.assign(m,emptyLive());
  const withEid=cands.filter(m=>m.provider_id!=null&&String(m.provider_id)!=='');
  meta.eid_missing=cands.length-withEid.length;
  const misses:string[]=[];
  const note=(reason:string,m:any)=>{if(debug)misses.push(JSON.stringify({tag:'live_miss',reason,home:m.home,away:m.away}))};
  if(debug)for(const m of cands)if(!withEid.includes(m))note('eid_missing',m);
  if(withEid.length===0){
    if(debug&&misses.length)console.log(misses.join('\n'));
    return meta;
  }
  const days=[...new Set(withEid.map(m=>utcDay(Date.parse(m.kickoff))))].sort();
  const {events,status}=await client.getDays(days);
  meta.status=status;
  if(status==='off')return meta;
  for(const m of withEid){
    const ev=events.get(String(m.provider_id));
    if(!ev){meta.not_found++;note('not_found',m);continue}
    const info=toLive(ev);
    if(!info){note(ev.epr===0?'not_started':'sanity',m);continue}
    Object.assign(m,info);
    meta.matched++;
  }
  if(debug&&misses.length)console.log(misses.join('\n'));
  return meta;
}
