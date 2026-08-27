import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-cfi-key'}});
const clean=(v:any)=>String(v??'').trim();
const terminal=new Set(['finished','inprogress','canceled','cancelled','postponed','abandoned','match finished','ft','in']);
const clubDesignators=new Set(['fc','cf','afc','ac','sc','fk','sk','if','bk','bsc','pfc','ec','cd','ca','rcd','rc','ssc','sv','vfb','vfl','tsg','fsv','kv','rsc','krc','gnk','nk','club','clube','calcio','futebol','football','soccer']);
const espnLeagues=['uefa.europa','uefa.europa.conf','esp.1','eng.league_cup','eng.1','eng.2','eng.3','sco.1','ned.1','por.1','bel.1','usa.1','mex.1','bra.1','arg.1','col.1'] as const;

type Resolved={team_id:string;canonical_name:string;resolution:string};
type Candidate={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoffIso:string;status:string;sourceUrl:string|null;canonicalHomeId?:string|null;canonicalAwayId?:string|null};
type Catalog={teamById:Map<string,string>;folded:Map<string,Map<string,Resolved>>;club:Map<string,Map<string,Resolved>>};

const fold=(value:string)=>clean(value).normalize('NFKD').replace(/\p{M}+/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const clubKey=(value:string)=>fold(value).split(' ').filter(token=>token&&!clubDesignators.has(token)).join(' ');
const add=(map:Map<string,Map<string,Resolved>>,key:string,value:Resolved)=>{if(!key||key.length<2)return;const bucket=map.get(key)||new Map<string,Resolved>();bucket.set(value.team_id,value);map.set(key,bucket);};
const unique=(bucket:Map<string,Resolved>|undefined)=>{const xs=bucket?[...bucket.values()]:[];return xs.length===1?xs[0]:null;};

async function fetchAll(db:any,table:string,columns:string){const out:any[]=[];for(let from=0;from<20000;from+=1000){const {data,error}=await db.from(table).select(columns).range(from,from+999);if(error)throw new Error(`${table.toUpperCase()}_CATALOG_FAILED:${error.message}`);const rows=Array.isArray(data)?data:[];out.push(...rows);if(rows.length<1000)break;}return out;}
async function loadCatalog(db:any):Promise<Catalog>{
 const [teams,aliases]=await Promise.all([fetchAll(db,'teams','team_id,canonical_name'),fetchAll(db,'team_aliases','team_id,alias_display')]);
 const teamById=new Map<string,string>();for(const row of teams){const id=clean(row?.team_id),name=clean(row?.canonical_name);if(id&&name)teamById.set(id,name);}
 const folded=new Map<string,Map<string,Resolved>>(),club=new Map<string,Map<string,Resolved>>();
 const index=(label:string,teamId:string,resolution:string)=>{const canonical=teamById.get(teamId);if(!canonical)return;const value={team_id:teamId,canonical_name:canonical,resolution};add(folded,fold(label),value);const ck=clubKey(label);if(ck.length>=3)add(club,ck,value);};
 for(const [id,name] of teamById)index(name,id,'CANONICAL_FOLDED_EXACT');
 for(const row of aliases){const id=clean(row?.team_id),label=clean(row?.alias_display);if(id&&label)index(label,id,'ALIAS_FOLDED_EXACT');}
 return{teamById,folded,club};
}
async function resolve(db:any,catalog:Catalog,name:string):Promise<Resolved|null>{
 const {data,error}=await db.rpc('cfi_resolve_team_name',{p_name:name});
 if(!error&&data?.status==='RESOLVED'&&data?.team_id&&data?.canonical_name)return{team_id:String(data.team_id),canonical_name:String(data.canonical_name),resolution:String(data.resolution??'RPC_EXACT')};
 const exactBucket=catalog.folded.get(fold(name)),exact=unique(exactBucket);if(exact)return exact;if(exactBucket&&exactBucket.size>1)return null;
 const ck=clubKey(name),clubBucket=ck.length>=3?catalog.club.get(ck):undefined,club=unique(clubBucket);if(club)return{...club,resolution:'CANONICAL_CLUB_KEY_EXACT'};
 return null;
}

function localParts(iso:string,tz:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));const g=(t:string)=>p.find(x=>x.type===t)?.value??'';return{date:`${g('year')}-${g('month')}-${g('day')}`,time:`${g('hour')}:${g('minute')}`};}
function queryDates(targetDate:string){const base=Date.parse(`${targetDate}T00:00:00Z`);if(!Number.isFinite(base))return[targetDate];return[-1,0,1].map(d=>new Date(base+d*86400000).toISOString().slice(0,10));}
function futureOnTarget(iso:string,targetDate:string,tz:string){const ms=Date.parse(iso);if(!Number.isFinite(ms))return false;const lp=localParts(iso,tz);if(lp.date!==targetDate)return false;const localNow=localParts(new Date().toISOString(),tz).date;if(targetDate===localNow&&ms<=Date.now())return false;return true;}
function parseTsdb(payload:any,url:string):Candidate[]{const events=Array.isArray(payload?.events)?payload.events:[],out:Candidate[]=[];for(const e of events){const home=clean(e?.strHomeTeam),away=clean(e?.strAwayTeam),status=clean(e?.strStatus||'scheduled').toLowerCase();let ms=Date.parse(clean(e?.strTimestamp));if(!Number.isFinite(ms)){const d=clean(e?.dateEvent),t=clean(e?.strTime)||'00:00:00';ms=Date.parse(`${d}T${t.endsWith('Z')?t:t+'Z'}`);}if(!home||!away||!Number.isFinite(ms)||terminal.has(status)||status.includes('finish')||status.includes('postpon'))continue;out.push({provider:'THESPORTSDB',providerId:clean(e?.idEvent)||`${home}-${away}-${ms}`,home,away,competition:clean(e?.strLeague)||null,country:clean(e?.strCountry)||null,kickoffIso:new Date(ms).toISOString(),status:status||'scheduled',sourceUrl:url});}return out;}
function parseEspn(payload:any,url:string):Candidate[]{const events=Array.isArray(payload?.events)?payload.events:[],out:Candidate[]=[];for(const e of events){const c=e?.competitions?.[0],teams=Array.isArray(c?.competitors)?c.competitors:[],h=teams.find((x:any)=>x?.homeAway==='home'),a=teams.find((x:any)=>x?.homeAway==='away'),home=clean(h?.team?.displayName||h?.team?.name),away=clean(a?.team?.displayName||a?.team?.name),ms=Date.parse(clean(e?.date)),status=clean(e?.status?.type?.state||e?.status?.type?.name||'pre').toLowerCase();if(!home||!away||!Number.isFinite(ms)||terminal.has(status))continue;out.push({provider:'ESPN',providerId:clean(e?.id)||`${home}-${away}-${ms}`,home,away,competition:clean(e?.league?.name||e?.name)||null,country:null,kickoffIso:new Date(ms).toISOString(),status:status||'pre',sourceUrl:url});}return out;}

async function providerCandidates(targetDate:string){
 const attempts:any[]=[],out:Candidate[]=[];const headers={'accept':'application/json, text/plain, */*','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36'};
 const probe=async(provider:string,url:string,parse:(body:any,url:string)=>Candidate[])=>{try{const r=await fetch(url,{headers});if(!r.ok){attempts.push({provider,url,httpStatus:r.status,ok:false,rows:0});return;}const rows=parse(await r.json(),url);attempts.push({provider,url,httpStatus:r.status,ok:true,rows:rows.length});out.push(...rows);}catch(e:any){attempts.push({provider,url,httpStatus:null,ok:false,rows:0,error:String(e?.message||e)});}};
 const jobs:Promise<void>[]=[];for(const d of queryDates(targetDate)){const u=`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${d}&s=Soccer`;jobs.push(probe('THESPORTSDB',u,parseTsdb));}
 const day=targetDate.replaceAll('-','');for(const league of espnLeagues){const u=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${day}&limit=1000`;jobs.push(probe('ESPN',u,parseEspn));}
 await Promise.all(jobs);return{rows:out,attempts};
}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return json({ok:true});
 if(req.method!=='POST')return json({error:'POST_REQUIRED'},405);
 const expected=Deno.env.get('CFI_ACTION_KEY');if(!expected)return json({error:'SERVER_KEY_NOT_CONFIGURED'},500);if(req.headers.get('x-cfi-key')!==expected)return json({error:'UNAUTHORIZED'},401);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json({error:'SERVER_SECRET_MISSING'},500);const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const body=await req.json().catch(()=>({})),tz=clean(body?.timezone)||'Asia/Ho_Chi_Minh',targetDate=clean(body?.target_date).slice(0,10),start=body?.start_time?clean(body.start_time):null,end=body?.end_time?clean(body.end_time):null,limit=Math.max(1,Math.min(80,Number(body?.limit??40)||40));if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return json({error:'TARGET_DATE_INVALID'},400);
 const catalog=await loadCatalog(db);
 const nowIso=new Date().toISOString();
 const {data:verified,error:ve}=await db.from('cfi_living_verified_fixtures').select('fixture_id,home_team,away_team,competition,kickoff_at,source_name,source_url,verification_status,canonical_home_team_id,canonical_away_team_id').eq('verification_status','VERIFIED').gt('kickoff_at',nowIso).order('kickoff_at',{ascending:true}).limit(200);if(ve)return json({error:'VERIFIED_FIXTURE_LOOKUP_FAILED',message:ve.message},500);
 const {data:caps,error:ce}=await db.from('cfi_forward_market_captures').select('capture_id,external_fixture_key,home_team,away_team,competition,kickoff_at,source_name,source_url,verification_status,research_only').eq('verification_status','VERIFIED_PREMATCH').gt('kickoff_at',nowIso).order('kickoff_at',{ascending:true}).limit(200);if(ce)return json({error:'CAPTURE_LOOKUP_FAILED',message:ce.message},500);
 const candidates:Candidate[]=[...(verified??[]).map((v:any)=>({provider:'CFI_LIVING_VERIFIED_FIXTURE',providerId:String(v.fixture_id),home:clean(v.home_team),away:clean(v.away_team),competition:v.competition??null,country:null,kickoffIso:String(v.kickoff_at),status:'scheduled',sourceUrl:v.source_url??null,canonicalHomeId:v.canonical_home_team_id??null,canonicalAwayId:v.canonical_away_team_id??null})),...(caps??[]).map((c:any)=>({provider:'CFI_FORWARD_CAPTURE',providerId:String(c.capture_id),home:clean(c.home_team),away:clean(c.away_team),competition:c.competition??null,country:null,kickoffIso:String(c.kickoff_at),status:'scheduled',sourceUrl:c.source_url??null}))];
 const provider=await providerCandidates(targetDate);candidates.push(...provider.rows);
 const rows:any[]=[],rejected:any[]=[],seen=new Set<string>();
 for(const c of candidates){if(rows.length>=limit)break;if(!futureOnTarget(c.kickoffIso,targetDate,tz))continue;const lp=localParts(c.kickoffIso,tz);if(start&&lp.time<start)continue;if(end&&lp.time>end)continue;
  let homeRes:Resolved|null=null,awayRes:Resolved|null=null;
  if(c.canonicalHomeId&&catalog.teamById.has(c.canonicalHomeId))homeRes={team_id:c.canonicalHomeId,canonical_name:catalog.teamById.get(c.canonicalHomeId)!,resolution:'CANONICAL_ID_VERIFIED'};else homeRes=await resolve(db,catalog,c.home);
  if(c.canonicalAwayId&&catalog.teamById.has(c.canonicalAwayId))awayRes={team_id:c.canonicalAwayId,canonical_name:catalog.teamById.get(c.canonicalAwayId)!,resolution:'CANONICAL_ID_VERIFIED'};else awayRes=await resolve(db,catalog,c.away);
  if(!homeRes||!awayRes){rejected.push({provider:c.provider,providerId:c.providerId,home:c.home,away:c.away,reason:'ZERO_EXACT_TEAM_EVIDENCE',homeResolved:!!homeRes,awayResolved:!!awayRes});continue;}
  const key=`${homeRes.team_id}|${awayRes.team_id}|${c.kickoffIso}`;if(seen.has(key))continue;seen.add(key);
  rows.push({provider:c.provider,providerId:c.providerId,home:homeRes.canonical_name,away:awayRes.canonical_name,competition:c.competition,country:c.country,kickoffIso:c.kickoffIso,kickoffLocal:lp.time,targetDate,status:c.status||'scheduled',sourceUrl:c.sourceUrl,sourceUrls:c.sourceUrl?[c.sourceUrl]:[],canonicalExact:true,canonicalHomeTeamId:homeRes.team_id,canonicalAwayTeamId:awayRes.team_id,identityResolution:{home:homeRes.resolution,away:awayRes.resolution},providerNames:{home:c.home,away:c.away}});
 }
 return json({status:'OK',version:'CFI_DISCOVERY_FEED_V3_CANONICAL_PROVIDER_FALLBACK',targetDate,timeZone:tz,source:'VERIFIED_DB_THEN_PROVIDER_CANONICAL_BRIDGE',rows,count:rows.length,localCandidates:(verified??[]).length+(caps??[]).length,providerCandidates:provider.rows.length,providerAttempts:provider.attempts,rejected:rejected.slice(0,100)});
});
