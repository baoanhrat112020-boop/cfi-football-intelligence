import {
  dedupeFixtures,
  parseEspnScoreboard,
  parseSofascoreScheduled,
  parseTheSportsDbEvents,
  providerQueryDates,
  localDateNow,
  type DiscoveredFixture,
  type DiscoveryWindow,
} from '../discovery/cfi-discovery.ts';

type FetchLike=typeof fetch;

const ESPN_LEAGUES=[
  'uefa.champions','uefa.europa','uefa.europa.conf','eng.1','eng.2','eng.3','eng.4','eng.5',
  'esp.1','esp.2','ger.1','ger.2','ita.1','ita.2','fra.1','fra.2','ned.1','por.1',
  'bel.1','sco.1','tur.1','usa.1','mex.1','bra.1','arg.1','col.1','aus.1','jpn.1',
  'kor.1','eng.w.1','usa.nwsl','uefa.wchampions',
] as const;
const TSDB_NEXT=['4480','4481','5071','4328'] as const;
const REQUEST_TIMEOUT_MS=3200;

async function getJson(fetchFn:FetchLike,url:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetchFn(url,{
      headers:{accept:'application/json','user-agent':'CFI-Football-Intelligence/1.2'},
      signal:controller.signal
    });
    if(!response.ok)return{ok:false,status:response.status,payload:null};
    return{ok:true,status:response.status,payload:await response.json()};
  }catch(error:any){
    return{ok:false,status:null,payload:null,error:String(error?.message||error)};
  }finally{
    clearTimeout(timer);
  }
}


function decodeHtml(value:string){
  return value
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/\s+/g,' ')
    .trim();
}

function cleanTeam(value:string){
  return decodeHtml(value)
    .replace(/\[[^\]]+\]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function vnKickoff(targetDate:string,time:string,timeZone:string){
  const suffix=timeZone==='Asia/Ho_Chi_Minh'?'+07:00':'Z';
  const ms=Date.parse(`${targetDate}T${time}:00${suffix}`);
  return Number.isFinite(ms)?ms:null;
}

export function parseBongdaWapSchedule(html:string,window:DiscoveryWindow):DiscoveredFixture[]{
  const out:DiscoveredFixture[]=[];
  const now=Number(window.nowMs??Date.now());
  const today=localDateNow(window.timeZone,now);
  const rowRegex=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match:RegExpExecArray|null;
  while((match=rowRegex.exec(html))){
    const fragment=match[1];
    const cells:string[]=[];
    const cellRegex=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell:RegExpExecArray|null;
    while((cell=cellRegex.exec(fragment)))cells.push(decodeHtml(cell[1]));
    if(cells.length<5)continue;
    const timeIndex=cells.findIndex(v=>/^\d{1,2}:\d{2}$/.test(v));
    const vsIndex=cells.findIndex(v=>/^vs$/i.test(v));
    if(timeIndex<0||vsIndex<=0||vsIndex>=cells.length-1)continue;
    const time=cells[timeIndex].padStart(5,'0');
    const home=cleanTeam(cells[vsIndex-1]);
    const away=cleanTeam(cells[vsIndex+1]);
    if(!home||!away)continue;
    const kickoff=vnKickoff(window.targetDate,time,window.timeZone);
    if(kickoff===null)continue;
    if(window.targetDate===today&&kickoff<=now)continue;
    const competition=decodeHtml(cells[0])||null;
    out.push({
      provider:'BONGDAWAP',
      providerId:`BDW-${window.targetDate}-${time}-${home}-${away}`,
      home,away,competition,country:null,
      kickoff,
      kickoffIso:new Date(kickoff).toISOString(),
      kickoffLocal:time,
      targetDate:window.targetDate,
      status:'scheduled'
    });
  }
  return dedupeFixtures(out).sort((a,b)=>a.kickoff-b.kickoff);
}

async function getHtml(fetchFn:FetchLike,url:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetchFn(url,{
      headers:{
        accept:'text/html,application/xhtml+xml',
        'accept-language':'vi-VN,vi;q=0.9,en;q=0.7',
        'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      },
      signal:controller.signal
    });
    if(!response.ok)return{ok:false,status:response.status,text:null};
    return{ok:true,status:response.status,text:await response.text()};
  }catch(error:any){
    return{ok:false,status:null,text:null,error:String(error?.message||error)};
  }finally{
    clearTimeout(timer);
  }
}

export async function discoverDayFixturesFast(
  window:DiscoveryWindow,
  fetchFn:FetchLike=fetch
){
  const attempts:any[]=[];
  const rows:DiscoveredFixture[]=[];
  const jobs:Array<Promise<void>>=[];

  const addHtml=(provider:string,url:string,parser:(html:string,window:DiscoveryWindow)=>DiscoveredFixture[])=>{
    jobs.push((async()=>{
      const result:any=await getHtml(fetchFn,url);
      if(!result.ok){
        attempts.push({provider,url,ok:false,httpStatus:result.status??null,error:result.error??null,rows:0});
        return;
      }
      const parsed=parser(result.text,window);
      attempts.push({provider,url,ok:true,httpStatus:result.status,rows:parsed.length});
      rows.push(...parsed);
    })());
  };

  const add=(
    provider:string,
    url:string,
    parser:(payload:any,window:DiscoveryWindow)=>DiscoveredFixture[]
  )=>{
    jobs.push((async()=>{
      const result:any=await getJson(fetchFn,url);
      if(!result.ok){
        attempts.push({provider,url,ok:false,httpStatus:result.status??null,error:result.error??null,rows:0});
        return;
      }
      const parsed=parser(result.payload,window);
      attempts.push({provider,url,ok:true,httpStatus:result.status,rows:parsed.length});
      rows.push(...parsed);
    })());
  };

  const [year,month,day]=window.targetDate.split('-');
  addHtml(
    'BONGDAWAP',
    `https://bongdawap.com/lich-thi-dau-bong-da-ngay-${day}-${month}-${year}.html`,
    parseBongdaWapSchedule
  );
  for(const date of providerQueryDates(window.targetDate)){
    add('SOFASCORE',`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,parseSofascoreScheduled);
    add('SOFASCORE',`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,parseSofascoreScheduled);
    add('THESPORTSDB',`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${date}&s=Soccer`,parseTheSportsDbEvents);
  }

  for(const leagueId of TSDB_NEXT){
    add('THESPORTSDB',`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${leagueId}`,parseTheSportsDbEvents);
  }

  const espnDate=window.targetDate.replaceAll('-','');
  for(const league of ESPN_LEAGUES){
    add('ESPN',`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${espnDate}&limit=1000`,parseEspnScoreboard);
  }

  await Promise.allSettled(jobs);

  const merged=dedupeFixtures(rows).sort((a,b)=>a.kickoff-b.kickoff);
  const providers=[...new Set(merged.map(row=>row.provider))];
  return{
    provider:merged.length?(providers.length>1?'MULTI_SOURCE':providers[0]):'NONE',
    providers,
    rows:merged.slice(0,400),
    attempts,
    timeoutMs:REQUEST_TIMEOUT_MS,
  };
}

export async function handleFixturesDayRequest(
  request:Request,
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

  const found=await discoverDayFixturesFast({targetDate,timeZone,nowMs},fetchFn);
  return Response.json({
    status:'OK',
    action:'CFI_FIXTURES_DAY',
    source:found.provider,
    providers:found.providers,
    targetDate,
    timeZone,
    counts:{fixtures:found.rows.length},
    rows:found.rows,
    attempts:found.attempts,
    latencyPolicy:{perProviderTimeoutMs:found.timeoutMs,fanout:'parallel'}
  });
}
