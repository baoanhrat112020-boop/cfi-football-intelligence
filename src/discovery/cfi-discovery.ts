export const CFI_DISCOVERY_VERSION='CFI_AUTO_DISCOVERY_V1.1';

export type DiscoveredFixture={provider:string;providerId:string;home:string;away:string;competition:string|null;country:string|null;kickoff:number;kickoffIso:string;kickoffLocal:string;targetDate:string;status:string};
export type DiscoveryWindow={targetDate:string;timeZone:string;startTime?:string|null;endTime?:string|null;nowMs?:number};

const TERMINAL=new Set(['finished','inprogress','canceled','cancelled','postponed','abandoned','match finished','ft','in']);
const clean=(v:any)=>String(v??'').trim();
function parts(ms:number,timeZone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const get=(t:string)=>p.find(x=>x.type===t)?.value??'';return{date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};}
function inWindow(time:string,start?:string|null,end?:string|null){if(start&&time<start)return false;if(end&&time>end)return false;return true;}
export function localDateNow(timeZone:string,nowMs=Date.now()){return parts(nowMs,timeZone).date;}
export function providerQueryDates(targetDate:string){const base=Date.parse(`${targetDate}T00:00:00Z`);if(!Number.isFinite(base))return[targetDate];return[-1,0,1].map(delta=>new Date(base+delta*86400000).toISOString().slice(0,10));}
export function dedupeFixtures(rows:DiscoveredFixture[]){const seen=new Set<string>();return rows.filter(r=>{const key=`${r.home.toLowerCase()}|${r.away.toLowerCase()}|${Math.floor(r.kickoff/60000)}`;if(seen.has(key))return false;seen.add(key);return true;});}

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
 for(const date of queryDates){
  const sofaUrls=[`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`];
  for(const url of sofaUrls)await tryProvider('SOFASCORE',url,parseSofascoreScheduled);
  const tsdbUrl=`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;await tryProvider('THESPORTSDB',tsdbUrl,parseTheSportsDbEvents);
  const espnDate=date.replaceAll('-',''),espnUrl=`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${espnDate}&limit=1000`;await tryProvider('ESPN',espnUrl,parseEspnScoreboard);
 }
 const rows=dedupeFixtures(sources.flatMap(s=>s.rows)).sort((a,b)=>a.kickoff-b.kickoff);
 const providers=[...new Set(sources.map(s=>s.provider))];
 return{provider:rows.length?(providers.length>1?'MULTI_SOURCE':providers[0]):'NONE',providers,rows,sourceUrl:sources.map(s=>s.sourceUrl).join(',' )||null,attempts};
}

const confidencePoints=(v:any)=>{const x=clean(v).toUpperCase();return x==='HIGH'?15:x==='MEDIUM'||x==='MED_HIGH'?10:x==='LOW'?3:6;};
const uncertaintyPenalty=(v:any)=>{const x=clean(v).toUpperCase();return x==='HIGH'?12:x==='MEDIUM'?5:0;};
export function scorePrediction(body:any){
 if(body?.status!=='SUCCESS'&&body?.status!=='DATA_READY')return{score:0,best:null,eligible:false,reason:'PREDICTION_NOT_SUCCESS'};
 if(body?.strictPrior?.verified!==true&&body?.strictPriorAudit?.evidence?.verified!==true)return{score:0,best:null,eligible:false,reason:'STRICT_PRIOR_NOT_VERIFIED'};
 if(body?.consistencyGuard?.status&&body.consistencyGuard.status!=='PASS')return{score:0,best:null,eligible:false,reason:'CONSISTENCY_FAIL'};
 const ranking=Array.isArray(body?.ranking)?body.ranking.filter((r:any)=>Number.isFinite(Number(r?.probability))):[];const best=ranking.sort((a:any,b:any)=>Number(b.probability)-Number(a.probability))[0]??null;if(!best)return{score:0,best:null,eligible:false,reason:'NO_RANKING'};
 const p=Number(best.probability),exact=body?.bigDbRetrieval?.exactTeam??{},h=Number(exact?.home?.retrieved??body?.evidence?.counts?.homeFixtures??0),a=Number(exact?.away?.retrieved??body?.evidence?.counts?.awayFixtures??0),hh=Number(exact?.h2h?.retrieved??body?.evidence?.counts?.h2hFixtures??0);const evidence=Math.min(20,Math.log2(1+Math.max(0,h)+Math.max(0,a)+2*Math.max(0,hh))*3.5),conf=confidencePoints(best?.confidence??best?.predictiveConfidence),strict=5,consistency=5,penalty=uncertaintyPenalty(body?.scoreline?.uncertainty),score=Math.max(0,Math.min(100,p*55+evidence+conf+strict+consistency-penalty));
 return{score:Math.round(score*10)/10,best:{market:String(best.target),probability:p,fairOdds:p>0?Math.round((1/p)*1000)/1000:null,confidence:best?.confidence??best?.predictiveConfidence??null},eligible:true,reason:null,evidence:{home:h,away:a,h2h:hh}};
}
