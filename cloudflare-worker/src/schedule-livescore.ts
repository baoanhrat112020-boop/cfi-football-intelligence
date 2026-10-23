import { toLive, type LsEvent } from './live-livescore.ts';

export type SchedMatch={id:string;h:string;a:string;t:string;st:'ns'|'live'|'ht'|'ir'|'ft'|'postponed'|'cancelled'|'unknown';m:string|null;hs:number|null;as:number|null;hh:number|null;ha:number|null};
export type SchedStage={n:string;c:string;e:SchedMatch[]};
export type SchedResult={stages:SchedStage[];status:'ok'|'degraded'|'off';total:number};

const API_BASE='https://prod-cdn-mev-api.livescore.com/v1/api/app/date/soccer/';
const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'};
const TTL_MS=30*1000;
const STALE_MS=10*60*1000;
const FAIL_WAIT_MS=20*1000;
const TIMEOUT_MS=4000;
const VN_OFFSET_MS=7*3600*1000;

type RawDay={ts:number;stages:any[]};
type Fetcher=(url:string,init:any)=>Promise<any>;

function toInt(v:any){
  if(v==null||v==='')return null;
  const n=Number(v);
  return Number.isInteger(n)&&n>=0?n:null;
}

export function esdToMs(esd:any){
  const s=String(esd??'');
  if(!/^\d{14}$/.test(s))return null;
  const t=Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12),+s.slice(12,14));
  return Number.isFinite(t)?t:null;
}

export function vnDayWindow(day:string){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if(!m)return null;
  const start=Date.UTC(+m[1],+m[2]-1,+m[3])-VN_OFFSET_MS;
  if(!Number.isFinite(start))return null;
  return{start,end:start+24*3600*1000};
}

function utcDays(start:number,end:number){
  const out:string[]=[];
  for(let t=Date.UTC(new Date(start).getUTCFullYear(),new Date(start).getUTCMonth(),new Date(start).getUTCDate());t<end;t+=24*3600*1000)out.push(new Date(t).toISOString().slice(0,10).replace(/-/g,''));
  return out;
}

export function mapEvent(e:any):SchedMatch|null{
  if(e?.Eid==null)return null;
  const ms=esdToMs(e.Esd);
  if(ms==null)return null;
  const ev:LsEvent={
    eid:String(e.Eid),
    home:String(e?.T1?.[0]?.Nm??''),
    away:String(e?.T2?.[0]?.Nm??''),
    epr:e.Epr!==null&&e.Epr!==''&&Number.isInteger(Number(e.Epr))?Number(e.Epr):null,
    eps:e.Eps!=null?String(e.Eps):null,
    esd:ms,
    tr1:toInt(e.Tr1),
    tr2:toInt(e.Tr2),
    rtm:Number.isFinite(Number(e?.Etm?.RTm))&&Number(e?.Etm?.RTm)>=0?Number(e.Etm.RTm):null
  };
  const live=toLive(ev);
  const started=live!=null&&live.live_status!=='postponed'&&live.live_status!=='cancelled';
  return{
    id:ev.eid,h:ev.home,a:ev.away,t:new Date(ms).toISOString(),
    st:live?.live_status??'ns',
    m:live?.live_minute_text??null,
    hs:live?.live_score_home??null,
    as:live?.live_score_away??null,
    hh:started?toInt(e.Trh1):null,
    ha:started?toInt(e.Trh2):null
  };
}

export function createScheduleClient(opts?:{fetchImpl?:Fetcher;now?:()=>number}){
  const fetchImpl:Fetcher=opts?.fetchImpl||((u,i)=>fetch(u,i));
  const nowFn=opts?.now||(()=>Date.now());
  const cache=new Map<string,RawDay>();
  const failedAt=new Map<string,number>();
  const inflight=new Map<string,Promise<RawDay|null>>();

  async function load(day:string):Promise<RawDay|null>{
    try{
      const res=await fetchImpl(`${API_BASE}${day}/0?MD=1`,{headers:HEADERS,signal:AbortSignal.timeout(TIMEOUT_MS)});
      if(!res.ok){failedAt.set(day,nowFn());return null}
      const json=await res.json();
      if(!json||!Array.isArray(json.Stages)||json.Stages.length===0){failedAt.set(day,nowFn());return null}
      const entry={ts:nowFn(),stages:json.Stages};
      cache.set(day,entry);
      failedAt.delete(day);
      return entry;
    }catch(_e){
      failedAt.set(day,nowFn());
      return null;
    }
  }

  async function getRaw(day:string):Promise<{raw:RawDay|null;fresh:boolean}>{
    const now=nowFn();
    const hit=cache.get(day);
    if(hit&&now-hit.ts<TTL_MS)return{raw:hit,fresh:true};
    const stale=hit&&now-hit.ts<=STALE_MS?hit:null;
    const fa=failedAt.get(day);
    if(fa!=null&&now-fa<FAIL_WAIT_MS)return{raw:stale,fresh:false};
    let p=inflight.get(day);
    if(!p){p=load(day).finally(()=>{inflight.delete(day)});inflight.set(day,p)}
    const got=await p;
    return got?{raw:got,fresh:true}:{raw:stale,fresh:false};
  }

  async function getSchedule(vnDay:string,hide:(name:string)=>boolean):Promise<SchedResult|null>{
    const w=vnDayWindow(vnDay);
    if(!w)return null;
    const days=utcDays(w.start,w.end);
    let ok=0,miss=0,degraded=false;
    const stages=new Map<string,SchedStage>();
    let total=0;
    for(const d of days){
      const {raw,fresh}=await getRaw(d);
      if(!raw){miss++;continue}
      ok++;
      if(!fresh)degraded=true;
      for(const s of raw.stages){
        const name=String(s?.Snm??'');
        if(hide(name))continue;
        const list=Array.isArray(s?.Events)?s.Events:[];
        for(const e of list){
          const ms=esdToMs(e?.Esd);
          if(ms==null||ms<w.start||ms>=w.end)continue;
          const m=mapEvent(e);
          if(!m)continue;
          const key=`${s?.Cnm??''}|${name}`;
          let st=stages.get(key);
          if(!st){st={n:name,c:String(s?.Cnm??''),e:[]};stages.set(key,st)}
          st.e.push(m);
          total++;
        }
      }
    }
    const out=[...stages.values()];
    for(const s of out)s.e.sort((x,y)=>x.t.localeCompare(y.t)||x.id.localeCompare(y.id));
    out.sort((x,y)=>x.e[0].t.localeCompare(y.e[0].t)||x.n.localeCompare(y.n));
    const status:SchedResult['status']=ok===0?'off':(miss>0||degraded?'degraded':'ok');
    return{stages:out,status,total};
  }

  return{getSchedule,cache};
}

const defaultClient=createScheduleClient();

export function getSchedule(vnDay:string,hide:(name:string)=>boolean){
  return defaultClient.getSchedule(vnDay,hide);
}
