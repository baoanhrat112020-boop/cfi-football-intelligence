import { discoverFixtures } from '../discovery/cfi-discovery.ts';
import {
  buildMatchContextPayload,
  bigDbContextHttpStatus,
  strictPriorRetrievalCutoff,
  verifyMatchContextTemporalAudit
} from './match-context.ts';

export type IosApiEnv={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string};
type FetchLike=typeof fetch;
type DiscoverLike=typeof discoverFixtures;
const WINDOW_MS=60_000,LIMIT=18;
const rate=new Map<string,{startedAt:number;count:number}>();

export function resetIosApiRateLimitForTest(){rate.clear();}

function allowed(request:Request,now:number){
  const key=request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const row=rate.get(key);
  if(!row||now-row.startedAt>=WINDOW_MS){rate.set(key,{startedAt:now,count:1});return true;}
  row.count++;
  if(rate.size>500)for(const [k,v] of rate)if(now-v.startedAt>=WINDOW_MS)rate.delete(k);
  return row.count<=LIMIT;
}

async function readJson(response:Response){try{return await response.clone().json()}catch{return null}}

export async function handleMatchContext(
  request:Request,
  env:IosApiEnv,
  deps:{fetchFn?:FetchLike;nowMs?:number}={}
){
  const now=deps.nowMs??Date.now(),fetchFn=deps.fetchFn??fetch;
  if(!allowed(request,now))return Response.json({status:'RATE_LIMITED',error:'MATCH_CONTEXT_RATE_LIMIT'},{status:429,headers:{'retry-after':'60'}});
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return Response.json({status:'CONFIG_REQUIRED',error:'BIGDB_CONTEXT_UNAVAILABLE'},{status:503});
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});}
  const home=String(input?.home??'').trim(),away=String(input?.away??'').trim(),targetDate=String(input?.target_date??'').slice(0,10);
  if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});

  const cutoffDate=strictPriorRetrievalCutoff(targetDate,now,'Asia/Ho_Chi_Minh');
  const url=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');
  let response:Response;
  try{
    response=await fetchFn(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({home,away,target_date:cutoffDate}),signal:AbortSignal.timeout(9000)});
  }catch(error:any){
    return Response.json({status:'UPSTREAM_UNAVAILABLE',error:'BIGDB_CONTEXT_FETCH_FAILED',message:String(error?.message||error)},{status:503});
  }
  const big:any=await readJson(response);
  if(!response.ok||big?.status!=='OK'){
    return Response.json({status:'UPSTREAM_ERROR',error:'BIGDB_CONTEXT_REJECTED',upstreamStatus:response.status,upstreamError:big?.error??null,message:big?.message??null},{status:bigDbContextHttpStatus(response.status)});
  }
  const temporal=verifyMatchContextTemporalAudit(big?.temporalAudit,targetDate,cutoffDate);
  if(!temporal.verified)return Response.json({status:'TEMPORAL_REJECTED',error:'MATCH_CONTEXT_STRICT_PRIOR_FAILED',temporalAudit:temporal},{status:422});

  const payload:any=buildMatchContextPayload(big,home,away,targetDate);
  payload.temporalAudit={...payload.temporalAudit,...temporal};
  payload.retrievalCutoffDate=cutoffDate;
  return Response.json(payload);
}

export async function handleDayFixtures(
  request:Request,
  deps:{discoverFn?:DiscoverLike;nowMs?:number}={}
){
  let input:any={};try{input=await request.clone().json()}catch{return Response.json({status:'INVALID_REQUEST',error:'INVALID_JSON'},{status:400});}
  const targetDate=String(input?.target_date??'').slice(0,10),timeZone=String(input?.timezone??'Asia/Ho_Chi_Minh');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return Response.json({status:'INVALID_REQUEST',error:'TARGET_DATE_INVALID'},{status:400});
  try{
    const found=await (deps.discoverFn??discoverFixtures)({targetDate,timeZone,minimumRows:100,nowMs:deps.nowMs??Date.now()},fetch);
    return Response.json({status:'OK',action:'CFI_FIXTURES_DAY',source:found.provider,providers:found.providers,targetDate,timeZone,counts:{fixtures:found.rows.length,requestedRows:100},rows:found.rows.slice(0,400),attempts:found.attempts});
  }catch(error:any){
    return Response.json({status:'UPSTREAM_UNAVAILABLE',error:'FIXTURE_DISCOVERY_FAILED',message:String(error?.message||error)},{status:503});
  }
}
