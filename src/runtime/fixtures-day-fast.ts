type FetchLike=typeof fetch;

export type FixtureDayEnv={
  CFI_DB_BASE_URL?:string;
  CFI_DB_KEY?:string;
};

export type DayFixtureRow={
  provider:string;
  providerId:string;
  home:string;
  away:string;
  competition:string|null;
  country:string|null;
  kickoff:number|null;
  kickoffIso:string|null;
  kickoffLocal:string|null;
  targetDate:string;
  status:string;
  canonicalHomeTeamId?:string|null;
  canonicalAwayTeamId?:string|null;
  provenance?:string|null;
  sourceProviders?:string[];
};

type Window={targetDate:string;timeZone:string;nowMs?:number};

const TARGET_ROWS=20;
const PRIMARY_TIMEOUT_MS=2500;
const FALLBACK_TIMEOUT_MS=1800;

const FOOTBALL_DATA_URL='https://www.football-data.co.uk/fixtures.csv';
const FOOTBALL_DATA_TZ:Record<string,string>={
  EC:'Europe/London',
  E0:'Europe/London',E1:'Europe/London',E2:'Europe/London',E3:'Europe/London',
  SC0:'Europe/London',SC1:'Europe/London',SC2:'Europe/London',SC3:'Europe/London',
  D1:'Europe/Berlin',D2:'Europe/Berlin',
  I1:'Europe/Rome',I2:'Europe/Rome',
  SP1:'Europe/Madrid',SP2:'Europe/Madrid',
  F1:'Europe/Paris',F2:'Europe/Paris',
  N1:'Europe/Amsterdam',
  P1:'Europe/Lisbon',
  B1:'Europe/Brussels',
  T1:'Europe/Istanbul'
};

async function getJson(fetchFn:FetchLike,url:string,timeoutMs:number,init:RequestInit={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchFn(url,{...init,signal:controller.signal});
    if(!response.ok){
      const raw=await response.text().catch(()=>'');
      return{ok:false,status:response.status,payload:null,error:`HTTP_${response.status}:${raw.slice(0,240)}`};
    }
    return{ok:true,status:response.status,payload:await response.json(),error:null};
  }catch(error:any){
    return{ok:false,status:null,payload:null,error:String(error?.message||error)};
  }finally{clearTimeout(timer);}
}

async function getText(fetchFn:FetchLike,url:string,timeoutMs:number,init:RequestInit={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchFn(url,{...init,signal:controller.signal});
    if(!response.ok)return{ok:false,status:response.status,text:null,error:`HTTP_${response.status}`};
    return{ok:true,status:response.status,text:await response.text(),error:null};
  }catch(error:any){
    return{ok:false,status:null,text:null,error:String(error?.message||error)};
  }finally{clearTimeout(timer);}
}

const clean=(value:any)=>String(value??'').trim();
const fold=(value:string)=>clean(value)
  .normalize('NFKD').replace(/\p{M}+/gu,'').toLowerCase()
  .replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ')
  .replace(/\b(fc|cf|afc|ac|sc|fk|sk|club|football|soccer)\b/g,' ')
  .replace(/\s+/g,' ').trim();

function fixtureKey(row:DayFixtureRow){
  const home=clean(row.canonicalHomeTeamId)||fold(row.home);
  const away=clean(row.canonicalAwayTeamId)||fold(row.away);
  return `${home}|${away}|${row.targetDate}`;
}

function mergeRows(rows:DayFixtureRow[]){
  const map=new Map<string,DayFixtureRow>();
  for(const row of rows){
    if(!row.home||!row.away)continue;
    const key=fixtureKey(row),prev=map.get(key);
    if(!prev){
      map.set(key,{...row,sourceProviders:[row.provider]});
      continue;
    }
    const providers=[...new Set([...(prev.sourceProviders||[prev.provider]),row.provider])];
    map.set(key,{
      ...prev,
      competition:prev.competition||row.competition||null,
      country:prev.country||row.country||null,
      kickoff:prev.kickoff??row.kickoff??null,
      kickoffIso:prev.kickoffIso||row.kickoffIso||null,
      kickoffLocal:prev.kickoffLocal||row.kickoffLocal||null,
      canonicalHomeTeamId:prev.canonicalHomeTeamId||row.canonicalHomeTeamId||null,
      canonicalAwayTeamId:prev.canonicalAwayTeamId||row.canonicalAwayTeamId||null,
      sourceProviders:providers
    });
  }
  return [...map.values()].sort((a,b)=>{
    const at=a.kickoffLocal||'99:99',bt=b.kickoffLocal||'99:99';
    return at.localeCompare(bt)||a.home.localeCompare(b.home);
  });
}

function localParts(iso:string,timeZone:string){
  const p=new Intl.DateTimeFormat('en-CA',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(iso));
  const g=(t:string)=>p.find(x=>x.type===t)?.value??'';
  return{date:`${g('year')}-${g('month')}-${g('day')}`,time:`${g('hour')}:${g('minute')}`};
}

function getTimeZoneOffsetMs(date:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const values=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const representedAsUtc=Date.UTC(
    Number(values.year),Number(values.month)-1,Number(values.day),
    Number(values.hour),Number(values.minute),Number(values.second)
  );
  return representedAsUtc-date.getTime();
}

function zonedLocalToUtc(localIso:string,timeZone:string){
  const m=localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if(!m)return null;
  const [,y,mo,d,h,mi,s]=m;
  const wall=Date.UTC(Number(y),Number(mo)-1,Number(d),Number(h),Number(mi),Number(s));
  let guess=wall;
  for(let i=0;i<3;i++)guess=wall-getTimeZoneOffsetMs(new Date(guess),timeZone);
  return new Date(guess).toISOString();
}

function splitCsvLine(line:string){
  const out:string[]=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){value+='"';i++;}
      else quoted=!quoted;
    }else if(ch===','&&!quoted){out.push(value);value='';}
    else value+=ch;
  }
  out.push(value);return out;
}

export function parseFootballDataFixturesCsv(csv:string,window:Window):DayFixtureRow[]{
  const lines=String(csv||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return[];
  const headers=splitCsvLine(lines[0]).map(x=>x.trim());
  const index=Object.fromEntries(headers.map((h,i)=>[h,i]));
  if(index.Date===undefined||index.HomeTeam===undefined||index.AwayTeam===undefined)return[];
  const out:DayFixtureRow[]=[];
  for(const line of lines.slice(1)){
    const row=splitCsvLine(line);
    const rawDate=clean(row[index.Date]);
    const m=rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!m)continue;
    const matchDate=`${m[3]}-${m[2]}-${m[1]}`;
    if(matchDate!==window.targetDate)continue;
    const home=clean(row[index.HomeTeam]),away=clean(row[index.AwayTeam]);
    if(!home||!away)continue;
    const div=index.Div===undefined?'':clean(row[index.Div]);
    const time=index.Time===undefined?'':clean(row[index.Time]);
    let kickoffIso:string|null=null,kickoffLocal:string|null=null,kickoff:number|null=null;
    const sourceTz=FOOTBALL_DATA_TZ[div];
    if(sourceTz&&/^\d{1,2}:\d{2}$/.test(time)){
      const hhmm=time.padStart(5,'0');
      kickoffIso=zonedLocalToUtc(`${matchDate}T${hhmm}:00`,sourceTz);
      if(kickoffIso){
        kickoff=Date.parse(kickoffIso);
        kickoffLocal=localParts(kickoffIso,window.timeZone).time;
      }
    }
    out.push({
      provider:'FOOTBALL_DATA',
      providerId:['FD',div,matchDate,home,away].join('-'),
      home,away,competition:div||null,country:null,
      kickoff,kickoffIso,kickoffLocal,targetDate:window.targetDate,
      status:'scheduled',provenance:'FOOTBALL_DATA_FIXTURES_CSV'
    });
  }
  return mergeRows(out);
}

function parseBigDbRows(payload:any,window:Window):DayFixtureRow[]{
  return (Array.isArray(payload?.rows)?payload.rows:[]).map((row:any)=>{
    const kickoffIso=clean(row?.kickoffIso)||null;
    const kickoff=kickoffIso&&Number.isFinite(Date.parse(kickoffIso))?Date.parse(kickoffIso):null;
    return{
      provider:clean(row?.provider)||'CFI_BIGDB',
      providerId:clean(row?.providerId)||clean(row?.fixture_id),
      home:clean(row?.home),
      away:clean(row?.away),
      competition:clean(row?.competition)||null,
      country:clean(row?.country)||null,
      kickoff,
      kickoffIso,
      kickoffLocal:clean(row?.kickoffLocal)||null,
      targetDate:window.targetDate,
      status:clean(row?.status)||'CANONICAL',
      canonicalHomeTeamId:clean(row?.canonicalHomeTeamId)||null,
      canonicalAwayTeamId:clean(row?.canonicalAwayTeamId)||null,
      provenance:clean(row?.provenance)||'PERSISTENT_DB_CANONICAL_FIXTURE',
      sourceProviders:Array.isArray(row?.sourceProviders)?row.sourceProviders.map((x:any)=>clean(x)).filter(Boolean):undefined
    };
  }).filter((row:DayFixtureRow)=>row.providerId&&row.home&&row.away);
}

async function bigDbDay(window:Window,env:FixtureDayEnv,fetchFn:FetchLike){
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY){
    return{rows:[] as DayFixtureRow[],attempt:{stage:'BIGDB',provider:'CFI_BIGDB',ok:false,rows:0,error:'BIGDB_CONFIG_MISSING'}};
  }
  const base=env.CFI_DB_BASE_URL.replace(/\/$/,'');
  const url=`${base}/fixtures-day?target_date=${encodeURIComponent(window.targetDate)}`;
  const result:any=await getJson(fetchFn,url,PRIMARY_TIMEOUT_MS,{
    method:'GET',
    headers:{accept:'application/json','x-cfi-key':env.CFI_DB_KEY}
  });
  const rows=result.ok?parseBigDbRows(result.payload,window):[];
  return{rows,attempt:{stage:'BIGDB',provider:'CFI_BIGDB',ok:result.ok,httpStatus:result.status??null,rows:rows.length,error:result.error??null}};
}

async function footballDataDay(window:Window,fetchFn:FetchLike){
  const result:any=await getText(fetchFn,FOOTBALL_DATA_URL,PRIMARY_TIMEOUT_MS,{
    headers:{accept:'text/csv,text/plain,*/*','user-agent':'CFI-Football-Intelligence/1.4'}
  });
  const rows=result.ok?parseFootballDataFixturesCsv(result.text||'',window):[];
  return{rows,attempt:{stage:'FOOTBALL_DATA',provider:'FOOTBALL_DATA',ok:result.ok,httpStatus:result.status??null,rows:rows.length,error:result.error??null}};
}

async function bongdaWapDay(window:Window,fetchFn:FetchLike){
  const [year,month,day]=window.targetDate.split('-');
  const url=`https://bongdawap.com/lich-thi-dau-bong-da-ngay-${day}-${month}-${year}.html`;
  const result:any=await getText(fetchFn,url,FALLBACK_TIMEOUT_MS,{
    headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0'}
  });
  const rows=result.ok?parseBongdaWapSchedule(result.text||'',window):[];
  return{rows,attempt:{stage:'BONGDAWAP_FALLBACK',provider:'BONGDAWAP',ok:result.ok,httpStatus:result.status??null,rows:rows.length,error:result.error??null}};
}

function htmlCell(raw:string){
  return raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
}

export function parseBongdaWapSchedule(html:string,window:Window):DayFixtureRow[]{
  const out:DayFixtureRow[]=[];
  const rowRe=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let rowMatch:RegExpExecArray|null;
  while((rowMatch=rowRe.exec(html))){
    const cells:string[]=[];const cellRe=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let cell:RegExpExecArray|null;
    while((cell=cellRe.exec(rowMatch[1])))cells.push(htmlCell(cell[1]));
    if(cells.length<6)continue;
    const league=cells[0],time=cells[1],home=cells[3].replace(/^\[[^\]]+\]\s*/,'').trim(),score=cells[4],away=cells[5].replace(/\s*\[[^\]]+\]$/,'').trim();
    if(!/^\d{1,2}:\d{2}$/.test(time)||!home||!away)continue;
    const padded=time.padStart(5,'0');
    const iso=zonedLocalToUtc(`${window.targetDate}T${padded}:00`,'Asia/Ho_Chi_Minh');
    const kickoff=iso?Date.parse(iso):null;
    out.push({
      provider:'BONGDAWAP',providerId:['BDW',window.targetDate,padded,home,away].join('-'),
      home,away,competition:league||null,country:null,kickoff,kickoffIso:iso,kickoffLocal:padded,
      targetDate:window.targetDate,status:/^\d+\s*-\s*\d+$/.test(score)?'finished':'scheduled',
      provenance:'BONGDAWAP_FALLBACK'
    });
  }
  return mergeRows(out);
}

export async function discoverDayFixturesFast(
  window:Window,
  env:FixtureDayEnv={},
  fetchFn:FetchLike=fetch
){
  const attempts:any[]=[];
  const [big,fd,bdw]=await Promise.all([
    bigDbDay(window,env,fetchFn),
    footballDataDay(window,fetchFn),
    bongdaWapDay(window,fetchFn)
  ]);

  attempts.push(big.attempt,fd.attempt,bdw.attempt);

  // Daily fixture discovery is a browse surface, not a prediction gate.
  // Use every available read-only source in parallel so BigDB remains canonical
  // while public fixture feeds expand coverage instead of being skipped once a
  // small minimum has been reached.
  const rows=mergeRows([
    ...big.rows,
    ...fd.rows,
    ...bdw.rows
  ]);

  const providers=[...new Set(rows.flatMap(row=>row.sourceProviders||[row.provider]))];
  return{
    provider:rows.length?(providers.length>1?'MULTI_SOURCE':providers[0]):'NONE',
    providers,rows:rows.slice(0,500),attempts,
    latencyMode:'PARALLEL_ALL_DAY_MULTI_SOURCE',
    targetRows:TARGET_ROWS,
    primarySources:['CFI_BIGDB_WITH_AISCORE_PC_BRIDGE','FOOTBALL_DATA'],
    coverageSources:['BONGDAWAP']
  };
}

export async function handleFixturesDayRequest(
  request:Request,
  env:FixtureDayEnv={},
  fetchFn:FetchLike=fetch,
  nowMs=Date.now()
){
  let input:any={};
  try{input=await request.clone().json()}catch{
    return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});
  }
  const targetDate=String(input?.target_date??'').slice(0,10);
  const timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)){
    return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});
  }

  const found=await discoverDayFixturesFast({targetDate,timeZone,nowMs},env,fetchFn);
  return Response.json({
    status:'OK',
    action:'CFI_FIXTURES_DAY',
    version:'CFI_FIXTURES_DAY_V5_PARALLEL_ALL_DAY',
    source:found.provider,
    providers:found.providers,
    targetDate,timeZone,
    counts:{fixtures:found.rows.length,targetRows:found.targetRows},
    rows:found.rows,
    attempts:found.attempts,
    sourcePolicy:{
      primary:found.primarySources,
      coverage:found.coverageSources,
      mode:found.latencyMode
    }
  });
}
