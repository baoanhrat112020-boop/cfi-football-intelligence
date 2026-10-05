export type FmMatch={
  id:number;
  t:number;
  home:string;
  away:string;
  started:boolean;
  finished:boolean;
  cancelled:boolean;
  reason:string|null;
  scoreH:number|null;
  scoreA:number|null;
  liveShort:string|null;
  liveKey:string|null;
};

export type LiveFields={
  live_score_home:number|null;
  live_score_away:number|null;
  live_minute:number|null;
  live_minute_text:string|null;
  live_status:'live'|'ht'|'ir'|'ft'|'postponed'|'cancelled'|'unknown'|null;
  live_source:'fotmob'|null;
};

export type LiveMeta={candidates:number;matched:number;status:'ok'|'degraded'|'off'};

const STOP=new Set(['fc','cf','sc','ac','afc','fk','sk','bk','if','ik','cd','ca','club','de','ud','sd','csd','cs']);
const SUFFIX=/^(u\d\d|ii|iii|b|w|2|3|reserves|res|youth|academy|women)$/;
const FOTMOB_URL='https://www.fotmob.com/api/data/matches?date=';
const FOTMOB_HEADERS={
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':'https://www.fotmob.com/',
  'Accept':'application/json'
};
const CACHE_TTL_MS=60*1000;
const MAX_AGE_MS=3*60*1000;
const FETCH_TIMEOUT_MS=3000;
const MATCH_WINDOW_MS=15*60*1000;
const LIVE_WINDOW_MS=2*60*60*1000;
const MINUTE_TOLERANCE=30;
const BREAKER_FAILS=3;
const BLOCK_WAIT_MS=60*60*1000;
const SOFT_WAIT_MS=10*60*1000;
const WARN_EVERY_MS=60*1000;

function foldTokens(s:string){
  let x=String(s??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
  x=x.replace(/ø/g,'o').replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/ß/g,'ss').replace(/đ/g,'d').replace(/ł/g,'l').replace(/ð/g,'d').replace(/þ/g,'th');
  x=x.replace(/[^a-z0-9]+/g,' ').trim();
  return x?x.split(' '):[];
}

export function teamKey(s:string){
  const t=foldTokens(s).filter(x=>!STOP.has(x));
  return{core:t.filter(x=>!SUFFIX.test(x)).join(' '),suf:t.filter(x=>SUFFIX.test(x)).join(' ')};
}

export function sameTeam(a:string,b:string){
  const x=teamKey(a),y=teamKey(b);
  return x.core!==''&&x.core===y.core&&x.suf===y.suf;
}

export function parseLiveTime(short:string|null|undefined,key?:string|null){
  const text=String(short??'').replace(/[‎‏]/g,'').trim();
  if(String(key??'').toLowerCase().includes('interrupted')||/^ir$/i.test(text))return{kind:'ir' as const,minute:null,text:null};
  if(/^ht$/i.test(text))return{kind:'ht' as const,minute:null,text:null};
  const m=text.match(/^(\d{1,3})(?:\+(\d{1,2}))?['’′]?$/);
  if(m){
    const base=Number(m[1]);
    return{kind:'minute' as const,minute:base,text:`${base}${m[2]?`+${m[2]}`:''}'`};
  }
  return{kind:'other' as const,minute:null,text:null};
}

export function parseFotmobList(json:any):FmMatch[]{
  const out:FmMatch[]=[];
  const leagues=Array.isArray(json?.leagues)?json.leagues:[];
  for(const l of leagues){
    const ms=Array.isArray(l?.matches)?l.matches:[];
    for(const m of ms){
      const s=m?.status??{};
      const t=Date.parse(String(s.utcTime??''));
      if(!Number.isFinite(t)||!m?.home?.name||!m?.away?.name)continue;
      let sh:number|null=null,sa:number|null=null;
      const sm=String(s.scoreStr??'').match(/^(\d+)\s*-\s*(\d+)$/);
      if(sm){sh=Number(sm[1]);sa=Number(sm[2])}
      else if(Number.isFinite(Number(m.home.score))&&Number.isFinite(Number(m.away.score))&&m.home.score!=null&&m.away.score!=null){sh=Number(m.home.score);sa=Number(m.away.score)}
      out.push({
        id:Number(m.id),
        t,
        home:String(m.home.name),
        away:String(m.away.name),
        started:s.started===true,
        finished:s.finished===true,
        cancelled:s.cancelled===true,
        reason:s.reason?.short?String(s.reason.short):null,
        scoreH:sh,
        scoreA:sa,
        liveShort:s.liveTime?.short!=null?String(s.liveTime.short):null,
        liveKey:s.liveTime?.shortKey!=null?String(s.liveTime.shortKey):null
      });
    }
  }
  return out;
}

export type PickRef={key:string;home:string;away:string;kickoff:number};

export function matchPicks(picks:PickRef[],fm:FmMatch[],onMiss?:(p:PickRef,reason:string)=>void){
  const cand=new Map<string,FmMatch[]>();
  const claims=new Map<number,number>();
  for(const p of picks){
    const list=fm.filter(m=>Math.abs(m.t-p.kickoff)<=MATCH_WINDOW_MS&&sameTeam(p.home,m.home)&&sameTeam(p.away,m.away));
    cand.set(p.key,list);
    for(const m of list)claims.set(m.id,(claims.get(m.id)||0)+1);
  }
  const out=new Map<string,FmMatch>();
  for(const p of picks){
    const list=cand.get(p.key)||[];
    if(list.length===0){onMiss?.(p,'no_match');continue}
    if(list.length>1){onMiss?.(p,'ambiguous_pick');continue}
    if((claims.get(list[0].id)||0)>1){onMiss?.(p,'ambiguous_fotmob');continue}
    out.set(p.key,list[0]);
  }
  return out;
}

export function emptyLive():LiveFields{
  return{live_score_home:null,live_score_away:null,live_minute:null,live_minute_text:null,live_status:null,live_source:null};
}

export function toLive(m:FmMatch,kickoff:number,now:number):LiveFields|null{
  const sinceKo=(now-kickoff)/60000;
  const base:LiveFields={...emptyLive(),live_source:'fotmob'};
  if(m.cancelled){
    return{...base,live_status:m.reason==='PP'?'postponed':'cancelled'};
  }
  if(!m.started)return null;
  const scored={...base,live_score_home:m.scoreH,live_score_away:m.scoreA};
  if(m.finished){
    if(sinceKo<70)return null;
    return{...scored,live_status:'ft'};
  }
  const lt=parseLiveTime(m.liveShort,m.liveKey);
  if(lt.kind==='minute'){
    if(Math.abs((lt.minute as number)-sinceKo)>MINUTE_TOLERANCE)return null;
    return{...scored,live_status:'live',live_minute:lt.minute,live_minute_text:lt.text};
  }
  if(lt.kind==='ht'){
    if(sinceKo<35)return null;
    return{...scored,live_status:'ht'};
  }
  if(lt.kind==='ir')return{...scored,live_status:'ir'};
  return{...scored,live_status:'unknown'};
}

type DayEntry={ts:number;list:FmMatch[]};
type Fetcher=(url:string,init:any)=>Promise<any>;

export function createLiveClient(opts?:{fetchImpl?:Fetcher;now?:()=>number;warn?:(msg:string)=>void}){
  const fetchImpl:Fetcher=opts?.fetchImpl||((u,i)=>fetch(u,i));
  const nowFn=opts?.now||(()=>Date.now());
  const warn=opts?.warn||((m:string)=>console.warn(m));
  const cache=new Map<string,DayEntry>();
  const inflight=new Map<string,Promise<FmMatch[]|null>>();
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
    warnOnce(`fotmob fetch failed: ${label} (fails=${breaker.fails}, open=${breaker.open})`);
  }

  async function fetchDay(day:string):Promise<FmMatch[]|null>{
    try{
      const res=await fetchImpl(FOTMOB_URL+day,{headers:FOTMOB_HEADERS,signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
      if(!res.ok){
        recordFailure(res.status===403||res.status===429?'blocked':'soft',`http ${res.status}`);
        return null;
      }
      const list=parseFotmobList(await res.json());
      breaker.fails=0;
      breaker.open=false;
      breaker.nextProbeAt=0;
      cache.set(day,{ts:nowFn(),list});
      return list;
    }catch(e:any){
      recordFailure('soft',String(e?.name||'error'));
      return null;
    }
  }

  async function getDay(day:string):Promise<{list:FmMatch[]|null;degraded:boolean}>{
    const now=nowFn();
    const hit=cache.get(day);
    if(hit&&now-hit.ts<CACHE_TTL_MS)return{list:hit.list,degraded:false};
    const stale=hit&&now-hit.ts<=MAX_AGE_MS?hit.list:null;
    if(breaker.open&&now<breaker.nextProbeAt)return{list:stale,degraded:stale!==null};
    if(breaker.open){
      breaker.nextProbeAt=now+SOFT_WAIT_MS;
    }
    let p=inflight.get(day);
    if(!p){
      p=fetchDay(day).finally(()=>{inflight.delete(day)});
      inflight.set(day,p);
    }
    const list=await p;
    if(list)return{list,degraded:false};
    return{list:stale,degraded:stale!==null};
  }

  async function getDays(days:string[]){
    const lists:FmMatch[]=[];
    let ok=0,missing=0,degraded=false;
    for(const d of days){
      const r=await getDay(d);
      if(r.list){ok++;lists.push(...r.list);if(r.degraded)degraded=true}
      else missing++;
    }
    const status:LiveMeta['status']=ok===0?'off':(missing>0||degraded?'degraded':'ok');
    return{matches:lists,status};
  }

  return{getDays,breaker,cache};
}

function utcDay(t:number){
  return new Date(t).toISOString().slice(0,10).replace(/-/g,'');
}

export function daysFor(kickoffs:number[]){
  const set=new Set<string>();
  const DAY=24*60*60*1000;
  for(const k of kickoffs){
    set.add(utcDay(k));
    const startOfDay=Math.floor(k/DAY)*DAY;
    if(k-startOfDay<=MATCH_WINDOW_MS)set.add(utcDay(k-MATCH_WINDOW_MS));
    if(startOfDay+DAY-k<=MATCH_WINDOW_MS)set.add(utcDay(k+MATCH_WINDOW_MS));
  }
  return [...set].sort();
}

const defaultClient=createLiveClient();

export async function enrichLive(matches:any[],now:number,debug:boolean,client=defaultClient){
  const cands=matches.filter(m=>{
    const t=Date.parse(String(m?.kickoff??''));
    return Number.isFinite(t)&&t<now&&t>now-LIVE_WINDOW_MS;
  });
  const meta:LiveMeta={candidates:cands.length,matched:0,status:'ok'};
  if(cands.length===0)return meta;
  for(const m of cands)Object.assign(m,emptyLive());
  const picks:PickRef[]=cands.map(m=>({key:String(m.fixture_id),home:String(m.home),away:String(m.away),kickoff:Date.parse(m.kickoff)}));
  const {matches:fm,status}=await client.getDays(daysFor(picks.map(p=>p.kickoff)));
  meta.status=status;
  if(status==='off')return meta;
  const misses:string[]=[];
  const mapped=matchPicks(picks,fm,(p,reason)=>{if(debug)misses.push(JSON.stringify({tag:'live_miss',reason,home:p.home,away:p.away}))});
  for(const m of cands){
    const fmm=mapped.get(String(m.fixture_id));
    if(!fmm)continue;
    const info=toLive(fmm,Date.parse(m.kickoff),now);
    if(!info){
      if(debug)misses.push(JSON.stringify({tag:'live_miss',reason:'sanity',home:m.home,away:m.away}));
      continue;
    }
    Object.assign(m,info);
    meta.matched++;
  }
  if(debug&&misses.length)console.log(misses.join('\n'));
  return meta;
}
