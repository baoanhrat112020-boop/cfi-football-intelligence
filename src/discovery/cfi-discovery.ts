import { evaluateEvidenceSufficiency } from '../prediction/evidence-sufficiency.ts';

export const CFI_DISCOVERY_VERSION='CFI_AUTO_DISCOVERY_V1.4';

export type DiscoveredFixture={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoff:number;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string};
export type DiscoveryWindow={targetDate:string;timeZone:string;startTime?:string|null;endTime?:string|null;nowMs?:number;minimumRows?:number};
export type AiFixtureCandidate={provider?:string;providerId?:string;home?:string;away?:string;competition?:string|null;country?:string|null;kickoffIso?:string;targetDate?:string;status?:string;sourceUrls?:string[];discoveredAt?:string};

const ESPN_LEAGUES=[
 'uefa.champions','uefa.europa','uefa.europa.conf','eng.1','eng.2','eng.3','eng.4','eng.5',
 'esp.1','esp.2','ger.1','ger.2','ita.1','ita.2','fra.1','fra.2','ned.1','por.1',
 'bel.1','sco.1','tur.1','usa.1','mex.1','bra.1','arg.1','col.1','aus.1','jpn.1',
 'kor.1','eng.w.1','usa.nwsl','uefa.wchampions',
] as const;
const ESPN_BATCH_SIZE=6;

const TERMINAL=new Set(['finished','inprogress','canceled','cancelled','postponed','abandoned','match finished','ft','in']);
const clean=(v:any)=>String(v??'').trim();
function parts(ms:number,timeZone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const get=(t:string)=>p.find(x=>x.type===t)?.value??'';return{date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};}
function inWindow(time:string,start?:string|null,end?:string|null){if(start&&time<start)return false;if(end&&time>end)return false;return true;}
export function localDateNow(timeZone:string,nowMs=Date.now()){return parts(nowMs,timeZone).date;}
export function providerQueryDates(targetDate:string){const base=Date.parse(`${targetDate}T00:00:00Z`);if(!Number.isFinite(base))return[targetDate];return[-1,0,1].map(delta=>new Date(base+delta*86400000).toISOString().slice(0,10));}
export function dedupeFixtures(rows:DiscoveredFixture[]){const seen=new Set<string>();return rows.filter(r=>{const key=`${r.home.toLowerCase()}|${r.away.toLowerCase()}|${Math.floor(r.kickoff/60000)}`;if(seen.has(key))return false;seen.add(key);return true;});}

function isHttpsUrl(value:any){try{return new URL(clean(value)).protocol==='https:';}catch{return false;}}
export function normalizeAiFixtureCandidates(candidates:AiFixtureCandidate[],window:DiscoveryWindow){
 const accepted:Array<DiscoveredFixture&{sourceUrls:string[];discoveredAt:string;discoveryMode:'GPT_SEARCH_FIRST'}>=[],rejected:any[]=[];
 for(const [index,candidate] of (Array.isArray(candidates)?candidates:[]).entries()){
  const home=clean(candidate?.home),away=clean(candidate?.away),kickoff=Date.parse(clean(candidate?.kickoffIso));
  const sourceUrls=[...new Set((Array.isArray(candidate?.sourceUrls)?candidate.sourceUrls:[]).map(clean).filter(isHttpsUrl))];
  const discoveredAt=clean(candidate?.discoveredAt),discoveredMs=Date.parse(discoveredAt);
  const providerId=clean(candidate?.providerId),status=clean(candidate?.status||'scheduled').toLowerCase();
  const reason=!home||!away?'TEAM_REQUIRED':!providerId?'PROVIDER_ID_REQUIRED':!Number.isFinite(kickoff)?'KICKOFF_REQUIRED':!sourceUrls.length?'HTTPS_PROVENANCE_REQUIRED':!Number.isFinite(discoveredMs)?'DISCOVERED_AT_REQUIRED':discoveredMs>Number(window.nowMs??Date.now())?'FUTURE_DISCOVERY_TIMESTAMP':TERMINAL.has(status)?'NOT_PREMATCH':null;
  if(reason){rejected.push({index,home,away,reason});continue;}
  const local=parts(kickoff,window.timeZone);
  if(local.date!==window.targetDate){rejected.push({index,home,away,reason:'TARGET_DATE_MISMATCH'});continue;}
  if(!inWindow(local.time,window.startTime,window.endTime)){rejected.push({index,home,away,reason:'OUTSIDE_TIME_WINDOW'});continue;}
  if(kickoff<=Number(window.nowMs??Date.now())&&window.targetDate===localDateNow(window.timeZone,window.nowMs)){rejected.push({index,home,away,reason:'KICKOFF_NOT_FUTURE'});continue;}
  accepted.push({provider:'GPT_WEB_SEARCH',providerId,home,away,competition:clean(candidate?.competition)||null,country:clean(candidate?.country)||null,kickoff,kickoffIso:new Date(kickoff).toISOString(),kickoffLocal:local.time,targetDate:window.targetDate,status:status||'scheduled',sourceUrls,discoveredAt:new Date(discoveredMs).toISOString(),discoveryMode:'GPT_SEARCH_FIRST'});
 }
 return{rows:dedupeFixtures(accepted),rejected};
}

export function dedupeCanonicalFixtureRows<T extends {home:string;away:string;kickoff?:number;kickoffIso?:string;targetDate?:string;canonicalHomeTeamId?:string|null;canonicalAwayTeamId?:string|null}>(rows:T[]){
 const seen=new Set<string>();
 return rows.filter(row=>{
  const home=clean(row.canonicalHomeTeamId)||clean(row.home).toLowerCase();
  const away=clean(row.canonicalAwayTeamId)||clean(row.away).toLowerCase();
  const parsed=finiteKickoff(row.kickoff,row.kickoffIso);
  const matchDate=clean(row.targetDate)||(parsed===null?'':new Date(parsed).toISOString().slice(0,10));
  const key=`${home}|${away}|${matchDate}`;
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}

export function fixtureCohort(row:{home?:string;away?:string;competition?:string|null}){
 const value=`${clean(row.home)} ${clean(row.away)} ${clean(row.competition)}`.toLowerCase();
 return{
  women:/\b(w|women|women's|womens|female|femenin[oa]|femminile|dames)\b/.test(value),
  youth:/\b(u[- ]?(?:15|16|17|18|19|20|21|22|23)|under[- ]?(?:15|16|17|18|19|20|21|22|23)|youth|academy|junior)\b/.test(value),
  reserve:/\b(reserve|reserves|res\.|b team|ii)\b/.test(value),
  amateur:/\b(amateur|regional|county|state league|non[- ]league)\b/.test(value),
 };
}

export function mergeDiscoveryRows<T extends {home:string;away:string;kickoff?:number;kickoffIso?:string;targetDate?:string;canonicalHomeTeamId?:string|null;canonicalAwayTeamId?:string|null}>(groups:T[][],limit=200){
 const merged=dedupeCanonicalFixtureRows(groups.flat());
 return merged.slice(0,Math.max(1,Math.min(1000,Math.floor(limit)||200)));
}
function finiteKickoff(kickoff:any,kickoffIso:any){
 const numeric=Number(kickoff);if(Number.isFinite(numeric))return numeric;
 const parsed=Date.parse(clean(kickoffIso));return Number.isFinite(parsed)?parsed:null;
}

export function parseSofascoreScheduled(payload:any,window:DiscoveryWindow):DiscoveredFixture[]{
 const now=window.nowMs??Date.now();const events=Array.isArray(payload?.events)?payload.events:[];const out:DiscoveredFixture[]=[];
 for(const e of events){const home=clean(e?.homeTeam?.name),away=clean(e?.awayTeam?.name),ts=Number(e?.startTimestamp)*1000,status=clean(e?.status?.type||e?.status?.description).toLowerCase();if(!home||!away||!Number.isFinite(ts)||TERMINAL.has(status))continue;const lp=parts(ts,window.timeZone);if(lp.date!==window.targetDate||!inWindow(lp.time,window.startTime,window.endTime))continue;if(ts<=now&&window.targetDate===localDateNow(window.timeZone,now))continue;out.push({provider:'SOFASCORE',providerId:String(e?.id??`${home}-${away}-${ts}`),home,away,competition:clean(e?.tournament?.name)||null,country:clean(e?.tournament?.category?.country?.name||e?.tournament?.category?.name)||null,kickoff:ts,kickoffIso:new Date(ts).toISOString(),kickoffLocal:lp.time,targetDate:window.targetDate,status:status||'notstarted'});}
 return dedupeFixtures(out).sort((a,b)=>a.kickoff-b.kickoff);
}

export function parseTheSportsDbEvents(payload:any,window:DiscoveryWindow):DiscoveredFixture[]{
 const now=window.nowMs??Date.now(),events=Array.isArray(payload?.events)?payload.events:[],out:DiscoveredFixture[]=[];
 for(const e of events){const home=clean(e?.strHomeTeam),away=clean(e?.strAwayTeam),status=clean(e?.strStatus).toLowerCase();let ts=Date.parse(clean(e?.strTimestamp));if(!Number.isFinite(ts)){const d=clean(e?.dateEvent),t=clean(e?.strTime)||'00:00:00';ts=Date.parse(`${d}T${t.endsWith('Z')?t:t+'Z'}`);}if(!home||!away||!Number.isFinite(ts)||TERMINAL.has(status)||status.includes('finish')||status.includes('postpon'))continue;const lp=parts(ts,window.timeZone);if(lp.date!==window.targetDate||!inWindow(lp.time,window.startTime,window.endTime))continue;if(ts<=now&&window.targetDate===localDateNow(window.timeZone,now))continue;out.push({provider:'THESPORTSDB',providerId:String(e?.idEvent??`${home}-${away}-${ts}`),home,away,competition:clean(e?.strLeague)||null,country:clean(e?.strCountry)||null,kickoff:ts,kickoffIso:new Date(ts).toISOString(),kickoffLocal:lp.time,targetDate:window.targetDate,status:status||'not started'});}
 return dedupeFixtures(out).sort((a,b)=>a.kickoff-b.kickoff);
}

export function parseEspnScoreboard(payload:any,window:DiscoveryWindow):DiscoveredFixture[]{
 const now=window.nowMs??Date.now(),events=Array.isArray(payload?.events)?payload.events:[],out:DiscoveredFixture[]=[];
 for(const e of events){const c=e?.competitions?.[0],teams=Array.isArray(c?.competitors)?c.competitors:[],homeRow=teams.find((x:any)=>x?.homeAway==='home'),awayRow=teams.find((x:any)=>x?.homeAway==='away');const home=clean(homeRow?.team?.displayName||homeRow?.team?.name),away=clean(awayRow?.team?.displayName||awayRow?.team?.name),ts=Date.parse(String(e?.date??'')),status=clean(e?.status?.type?.state||e?.status?.type?.name).toLowerCase();if(!home||!away||!Number.isFinite(ts)||TERMINAL.has(status))continue;const lp=parts(ts,window.timeZone);if(lp.date!==window.targetDate||!inWindow(lp.time,window.startTime,window.endTime))continue;if(ts<=now&&window.targetDate===localDateNow(window.timeZone,now))continue;out.push({provider:'ESPN',providerId:String(e?.id??`${home}-${away}-${ts}`),home,away,competition:clean(e?.league?.name||e?.name)||null,country:null,kickoff:ts,kickoffIso:new Date(ts).toISOString(),kickoffLocal:lp.time,targetDate:window.targetDate,status:status||'pre'});}
 return dedupeFixtures(out).sort((a,b)=>a.kickoff-b.kickoff);
}

export async function discoverFixtures(window:DiscoveryWindow,fetchFn:typeof fetch=fetch){
 const attempts:any[]=[];
 const sources:Array<{provider:string;rows:DiscoveredFixture[];sourceUrl:string}>=[];
 const tryProvider=async(provider:string,url:string,parse:(p:any,w:DiscoveryWindow)=>DiscoveredFixture[])=>{try{const r=await fetchFn(url,{headers:{accept:'application/json','user-agent':'CFI-Football-Intelligence/1.1'}});const status=r.status;if(!r.ok){attempts.push({provider,url,httpStatus:status,ok:false,rows:0});return;}const rows=parse(await r.json(),window);attempts.push({provider,url,httpStatus:status,ok:true,rows:rows.length});if(rows.length)sources.push({provider,rows,sourceUrl:url});}catch(e:any){attempts.push({provider,url,httpStatus:null,ok:false,rows:0,error:String(e?.message||e)});}};
 const queryDates=providerQueryDates(window.targetDate);
 const jobs:Promise<void>[]=[];
 for(const date of queryDates){
  const sofaUrls=[`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`];
  for(const url of sofaUrls)jobs.push(tryProvider('SOFASCORE',url,parseSofascoreScheduled));
  const tsdbUrl=`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;jobs.push(tryProvider('THESPORTSDB',tsdbUrl,parseTheSportsDbEvents));
 }
 await Promise.all(jobs);
 const minimumRows=Math.max(1,Math.min(100,Math.floor(Number(window.minimumRows??5))||5));
 const espnDate=window.targetDate.replaceAll('-','');
 for(let offset=0;offset<ESPN_LEAGUES.length;offset+=ESPN_BATCH_SIZE){
  if(dedupeFixtures(sources.flatMap(source=>source.rows)).length>=minimumRows)break;
  await Promise.all(ESPN_LEAGUES.slice(offset,offset+ESPN_BATCH_SIZE).map(league=>
   tryProvider('ESPN',`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${espnDate}&limit=1000`,parseEspnScoreboard)
  ));
 }
 const rows=dedupeFixtures(sources.flatMap(s=>s.rows)).sort((a,b)=>a.kickoff-b.kickoff);
 const providers=[...new Set(sources.map(s=>s.provider))];
 const espnAttempts=attempts.filter(attempt=>attempt.provider==='ESPN').length;
 return{provider:rows.length?(providers.length>1?'MULTI_SOURCE':providers[0]):'NONE',providers,rows,sourceUrl:sources.map(s=>s.sourceUrl).join(',' )||null,attempts,search:{requestedRows:minimumRows,foundRows:rows.length,targetSatisfied:rows.length>=minimumRows,espnLeaguesAttempted:espnAttempts,espnLeagueCatalogSize:ESPN_LEAGUES.length,exhausted:rows.length<minimumRows&&espnAttempts>=ESPN_LEAGUES.length}};
}

const confidencePoints=(v:any)=>{const x=clean(v).toUpperCase();return x==='HIGH'?15:x==='MEDIUM'||x==='MED_HIGH'?10:x==='LOW'?3:6;};
const uncertaintyPenalty=(v:any)=>{const x=clean(v).toUpperCase();return x==='HIGH'?12:x==='MEDIUM'?5:0;};
export function scorePrediction(body:any){
 if(body?.status!=='SUCCESS'&&body?.status!=='DATA_READY')return{score:0,best:null,eligible:false,reason:'PREDICTION_NOT_SUCCESS'};
 if(body?.strictPrior?.verified!==true&&body?.strictPriorAudit?.evidence?.verified!==true)return{score:0,best:null,eligible:false,reason:'STRICT_PRIOR_NOT_VERIFIED'};
 if(body?.consistencyGuard?.status&&body.consistencyGuard.status!=='PASS')return{score:0,best:null,eligible:false,reason:'CONSISTENCY_FAIL'};
 const ranking=Array.isArray(body?.ranking)?body.ranking.filter((r:any)=>Number.isFinite(Number(r?.probability))):[];const best=ranking.sort((a:any,b:any)=>Number(b.probability)-Number(a.probability))[0]??null;if(!best)return{score:0,best:null,eligible:false,reason:'NO_RANKING'};
 const p=Number(best.probability),sufficiency=evaluateEvidenceSufficiency(body),h=sufficiency.homeFixtures,a=sufficiency.awayFixtures,hh=sufficiency.h2hFixtures;const evidence=Math.min(20,Math.log2(1+Math.max(0,h)+Math.max(0,a)+2*Math.max(0,hh))*3.5),conf=confidencePoints(best?.confidence??best?.predictiveConfidence),strict=5,consistency=5,penalty=uncertaintyPenalty(body?.scoreline?.uncertainty)+(sufficiency.decisionEligible?0:18),score=Math.max(0,Math.min(100,p*55+evidence+conf+strict+consistency-penalty));
 return{score:Math.round(score*10)/10,best:{market:String(best.target),probability:p,fairOdds:p>0?Math.round((1/p)*1000)/1000:null,confidence:best?.confidence??best?.predictiveConfidence??null},eligible:sufficiency.displayEligible,reason:sufficiency.displayEligible?null:sufficiency.reason,evidence:{home:h,away:a,h2h:hh},evidenceSufficiency:sufficiency};
}
