async function tryTierC(env:any,homeId:string,awayId:string){
  try{
    const url=new URL(env.CFI_DB_BASE_URL);
    url.pathname=url.pathname.replace(/\/cfi-db\/?$/,/cfi-db/)+"/cfi-db";
    if(!/\/cfi-db\/?$/.test(url.pathname))return null;
    url.pathname=url.pathname.replace(/\/cfi-db\/?$/,'/cfi-db/tier-c-predict');
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({home_id:homeId,away_id:awayId,neutral:false}),signal:AbortSignal.timeout(5000)});
    if(!res.ok)return null;
    const j=await res.json();
    return j?.status==='OK'?j:null;
  }catch{return null}
}
type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const score=(v:any)=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
function summarize(rows:any[],teamId:string){
  const recent=rows.map(r=>({fixtureId:r.fixture_id,matchDate:r.match_date,homeTeam:r.home_name,awayTeam:r.away_name,competition:r.competition_name??r.competition_key??null,ht:score(r.ht_home)!==null&&score(r.ht_away)!==null?{home:r.ht_home,away:r.ht_away}:null,ft:score(r.ft_home)!==null&&score(r.ft_away)!==null?{home:r.ft_home,away:r.ft_away}:null,provenance:r.provenance??[]}));
  const ft=rows.filter(r=>score(r.ft_home)!==null&&score(r.ft_away)!==null);
  const ht=rows.filter(r=>score(r.ht_home)!==null&&score(r.ht_away)!==null);
  const gf=(r:any,part:string)=>r[part+(r.home_team_id===teamId?'_home':'_away')];
  const ga=(r:any,part:string)=>r[part+(r.home_team_id===teamId?'_away':'_home')];
  const mean=(xs:any[],f:(r:any)=>number)=>xs.length?xs.reduce((sum,r)=>sum+f(r),0)/xs.length:null;
  const form=ft.map(r=>gf(r,'ft')>ga(r,'ft')?'W':gf(r,'ft')===ga(r,'ft')?'D':'L');
  return {fixtures:rows.length,completed:ft.length,wins:form.filter(x=>x==='W').length,draws:form.filter(x=>x==='D').length,losses:form.filter(x=>x==='L').length,form:form.slice(0,10),avgGoalsFor:mean(ft,r=>gf(r,'ft')),avgGoalsAgainst:mean(ft,r=>ga(r,'ft')),avgHtGoalsFor:mean(ht,r=>gf(r,'ht')),avgHtGoalsAgainst:mean(ht,r=>ga(r,'ht')),bttsRate:mean(ft,r=>r.ft_home>0&&r.ft_away>0?100:0),over25Rate:mean(ft,r=>r.ft_home+r.ft_away>2.5?100:0),scoringRate:mean(ft,r=>gf(r,'ft')>0?100:0),cleanSheetRate:mean(ft,r=>ga(r,'ft')===0?100:0),recent:recent.slice(0,20)};
}
export async function handleMatchContext(request:Request,env:Env){
  if(request.method!=='POST')return json({status:'INVALID_REQUEST',error:'METHOD_NOT_ALLOWED'},405);
  let input:any;try{input=await request.json()}catch{return json({status:'INVALID_REQUEST',error:'INVALID_JSON'},400)}
  const home=typeof input?.home==='string'?input.home.trim():'',away=typeof input?.away==='string'?input.away.trim():'',date=input?.target_date;
  if(!home||!away||home.length>200||away.length>200)return json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},400);
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return json({status:'INVALID_REQUEST',error:'TARGET_DATE_REQUIRED'},400);
  if(!env.CFI_DB_BASE_URL||!env.CFI_DB_KEY)return json({status:'CONFIG_REQUIRED',error:'BIGDB_CONFIGURATION_REQUIRED'},503);
  try{
    const url=new URL(env.CFI_DB_BASE_URL);if(!/\/cfi-db\/?$/.test(url.pathname))return json({status:'CONFIG_REQUIRED',error:'BIGDB_URL_INVALID'},503);
    url.pathname=url.pathname.replace(/\/cfi-db\/?$/,'/cfi-bigdb-retrieval');url.search='';url.hash='';
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json','x-cfi-key':env.CFI_DB_KEY},body:JSON.stringify({home,away,target_date:date}),signal:AbortSignal.timeout(10000)});
    let big:any;try{big=await res.json()}catch{return json({status:'UPSTREAM_ERROR',error:'BIGDB_NON_JSON',upstreamStatus:res.status},502)}
    if(!res.ok||big?.status!=='OK')return json({status:'UPSTREAM_ERROR',error:'BIGDB_REQUEST_FAILED',upstreamStatus:res.status},502);
    const id=big.identity||{},audit=big.temporalAudit||{};
    if(id.homeFound!==true||id.awayFound!==true||!id.homeTeamId||!id.awayTeamId||!id.homeCanonical||!id.awayCanonical)return json({status:'BLOCKED',error:'CANONICAL_IDENTITY_UNRESOLVED'},422);
    if(id.homeTeamId===id.awayTeamId)return json({status:'BLOCKED',error:'CANONICAL_SELF_MATCH_REJECTED'},422);
    if(!Array.isArray(big.fixtures?.home)||!Array.isArray(big.fixtures?.away)||!Array.isArray(big.fixtures?.h2h))return json({status:'UPSTREAM_ERROR',error:'BIGDB_FIXTURES_INVALID'},502);
    const h=big.fixtures.home,a=big.fixtures.away,h2h=big.fixtures.h2h,all=[...h,...a,...h2h];
    if(audit.verified!==true||audit.targetDate!==date||audit.futureEvidenceCount!==0||audit.sameDateEvidenceCount!==0||!audit.maxEvidenceDate||audit.maxEvidenceDate>=date||all.some(r=>!r||!/^\d{4}-\d{2}-\d{2}$/.test(r.match_date)||r.match_date>=date))return json({status:'BLOCKED',error:'STRICT_PRIOR_EVIDENCE_INVALID',temporalAudit:{verified:false,targetDate:date}},422);
    const has=(r:any,id:string)=>r.home_team_id===id||r.away_team_id===id;
    if(h.some(r=>!has(r,id.homeTeamId))||a.some(r=>!has(r,id.awayTeamId))||h2h.some(r=>!has(r,id.homeTeamId)||!has(r,id.awayTeamId)))return json({status:'BLOCKED',error:'EXACT_TEAM_EVIDENCE_MISMATCH'},422);
    const MIN_EVIDENCE=3;const evidenceHome=h.length,evidenceAway=a.length;if(evidenceHome<MIN_EVIDENCE||evidenceAway<MIN_EVIDENCE){const tc=await tryTierC(env,id.homeTeamId,id.awayTeamId);if(tc)return json({status:'OK_TIER_C',version:'CFI_MATCH_CONTEXT_V1',target:{home:id.homeCanonical,away:id.awayCanonical,date},identity:id,prediction:tc,reason:'INSUFFICIENT_TEAM_EVIDENCE',evidenceCount:{home:evidenceHome,away:evidenceAway,required:MIN_EVIDENCE},source:'CFI_TIER_C_ELO',readOnly:true});return json({status:'INSUFFICIENT_DATA',error:'INSUFFICIENT_TEAM_EVIDENCE',evidenceCount:{home:evidenceHome,away:evidenceAway,required:MIN_EVIDENCE}},422);}
    const sorted=(xs:any[])=>[...xs].sort((x,y)=>y.match_date.localeCompare(x.match_date));
    return json({status:'OK',version:'CFI_MATCH_CONTEXT_V1',target:{home:id.homeCanonical,away:id.awayCanonical,date},identity:id,temporalAudit:audit,home:summarize(sorted(h),id.homeTeamId),away:summarize(sorted(a),id.awayTeamId),h2h:{fixtures:h2h.length,recent:summarize(sorted(h2h),id.homeTeamId).recent},source:'CFI_BIGDB',readOnly:true});
  }catch(e:any){return json({status:'UPSTREAM_ERROR',error:e?.name==='TimeoutError'||e?.name==='AbortError'?'BIGDB_TIMEOUT':'BIGDB_UNAVAILABLE'},504)}
}
