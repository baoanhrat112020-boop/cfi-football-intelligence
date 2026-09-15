import {
  dedupeFixtures,
  parseEspnScoreboard,
  parseSofascoreScheduled,
  parseTheSportsDbEvents,
  providerQueryDates,
  type DiscoveredFixture,
  type DiscoveryWindow,
} from '../discovery/cfi-discovery.ts';

type FetchLike=typeof fetch;

const ESPN_LEAGUES=[
  'uefa.champions','uefa.europa','uefa.europa.conf','eng.1','eng.2','eng.3',
  'esp.1','esp.2','ger.1','ger.2','ita.1','ita.2',
  'fra.1','fra.2','ned.1','por.1','bel.1','sco.1',
  'tur.1','usa.1','mex.1','bra.1','arg.1','col.1',
] as const;
const TSDB_NEXT=['4480','4481','5071','4328'] as const;

const MAX_CONCURRENT=6;
const TARGET_ROWS=40;
const PRIMARY_TIMEOUT_MS=1800;
const ESPN_TIMEOUT_MS=1500;
const TSDB_TIMEOUT_MS=1400;

async function getJson(fetchFn:FetchLike,url:string,timeoutMs:number){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchFn(url,{
      headers:{accept:'application/json','user-agent':'CFI-Football-Intelligence/1.3'},
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

export async function discoverDayFixturesFast(
  window:DiscoveryWindow,
  fetchFn:FetchLike=fetch
){
  const attempts:any[]=[];
  const rows:DiscoveredFixture[]=[];

  const runBatch=async(
    stage:string,
    jobs:Array<{
      provider:string;
      url:string;
      timeoutMs:number;
      parser:(payload:any,window:DiscoveryWindow)=>DiscoveredFixture[];
    }>
  )=>{
    await Promise.allSettled(jobs.slice(0,MAX_CONCURRENT).map(async job=>{
      const result:any=await getJson(fetchFn,job.url,job.timeoutMs);
      if(!result.ok){
        attempts.push({stage,provider:job.provider,url:job.url,ok:false,httpStatus:result.status??null,error:result.error??null,rows:0});
        return;
      }
      const parsed=job.parser(result.payload,window);
      attempts.push({stage,provider:job.provider,url:job.url,ok:true,httpStatus:result.status,rows:parsed.length});
      rows.push(...parsed);
    }));
  };

  const merged=()=>dedupeFixtures(rows).sort((a,b)=>a.kickoff-b.kickoff);

  // Stage 1: the two Sofascore hosts across the three UTC-adjacent dates.
  // This is intentionally capped at six concurrent fetches, matching the
  // Worker connection ceiling instead of queueing dozens of requests.
  const sofaJobs:Array<any>=[];
  for(const date of providerQueryDates(window.targetDate)){
    sofaJobs.push(
      {provider:'SOFASCORE',url:`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,timeoutMs:PRIMARY_TIMEOUT_MS,parser:parseSofascoreScheduled},
      {provider:'SOFASCORE',url:`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,timeoutMs:PRIMARY_TIMEOUT_MS,parser:parseSofascoreScheduled},
    );
  }
  await runBatch('PRIMARY_SOFA',sofaJobs);
  if(merged().length>=TARGET_ROWS)return finish(merged(),attempts,'PRIMARY_SOFA');

  // Stage 2: ESPN in fixed batches of six. Stop as soon as coverage is useful;
  // do not fan out the whole league catalog at once.
  const espnDate=window.targetDate.replaceAll('-','');
  for(let i=0;i<ESPN_LEAGUES.length;i+=MAX_CONCURRENT){
    const jobs=ESPN_LEAGUES.slice(i,i+MAX_CONCURRENT).map(league=>({
      provider:'ESPN',
      url:`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${espnDate}&limit=1000`,
      timeoutMs:ESPN_TIMEOUT_MS,
      parser:parseEspnScoreboard
    }));
    await runBatch(`ESPN_BATCH_${Math.floor(i/MAX_CONCURRENT)+1}`,jobs);
    if(merged().length>=TARGET_ROWS)break;
  }

  // Stage 3: small independent fallback only when broad providers are sparse.
  if(merged().length<12){
    const tsdbJobs:Array<any>=[
      {provider:'THESPORTSDB',url:`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${window.targetDate}&s=Soccer`,timeoutMs:TSDB_TIMEOUT_MS,parser:parseTheSportsDbEvents},
      ...TSDB_NEXT.map(leagueId=>({
        provider:'THESPORTSDB',
        url:`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${leagueId}`,
        timeoutMs:TSDB_TIMEOUT_MS,
        parser:parseTheSportsDbEvents
      }))
    ];
    await runBatch('TSDB_FALLBACK',tsdbJobs);
  }

  return finish(merged(),attempts,'STAGED_MULTI_SOURCE');
}

function finish(rows:DiscoveredFixture[],attempts:any[],latencyMode:string){
  const providers=[...new Set(rows.map(row=>row.provider))];
  return{
    provider:rows.length?(providers.length>1?'MULTI_SOURCE':providers[0]):'NONE',
    providers,
    rows:rows.slice(0,400),
    attempts,
    timeoutMs:Math.max(PRIMARY_TIMEOUT_MS,ESPN_TIMEOUT_MS,TSDB_TIMEOUT_MS),
    latencyMode,
    targetRows:TARGET_ROWS,
    maxConcurrent:MAX_CONCURRENT,
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
    counts:{fixtures:found.rows.length,targetRows:found.targetRows},
    rows:found.rows,
    attempts:found.attempts,
    latencyPolicy:{
      perProviderTimeoutMs:found.timeoutMs,
      maxConcurrent:found.maxConcurrent,
      mode:found.latencyMode
    }
  });
}
