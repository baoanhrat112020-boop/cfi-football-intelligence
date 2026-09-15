import { createClient } from "npm:@supabase/supabase-js@2";
import { bridgeProviderTeamName } from "../_shared/cfi-provider-team-bridge.ts";

const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"authorization, x-client-info, apikey, content-type, x-cfi-key"}});
const isScreenshot=(s:string)=>/screenshot|image|session/i.test(s||"");

const CLUB_DESIGNATORS=new Set(['fc','cf','afc','ac','sc','fk','sk','if','bk','bsc','pfc','ec','cd','ca','rcd','rc','ssc','sv','vfb','vfl','tsg','fsv','kv','rsc','krc','gnk','nk','club','clube','calcio','futebol','football','soccer']);
const foldName=(value:string)=>String(value||'').normalize('NFKD').replace(/\p{M}+/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const clubIdentityKey=(value:string)=>foldName(value).split(' ').filter(token=>token&&!CLUB_DESIGNATORS.has(token)).join(' ');

type IdentityCandidate={team_id:string;canonical_name:string};
type IdentityCatalog={expiresAt:number;folded:Map<string,Map<string,IdentityCandidate>>;club:Map<string,Map<string,IdentityCandidate>>};
let identityCatalog:IdentityCatalog|null=null;

const addCandidate=(map:Map<string,Map<string,IdentityCandidate>>,key:string,candidate:IdentityCandidate)=>{
  if(!key||key.length<2)return;
  const bucket=map.get(key)||new Map<string,IdentityCandidate>();
  bucket.set(candidate.team_id,candidate);
  map.set(key,bucket);
};

async function fetchAll(db:any,table:string,columns:string){
  const out:any[]=[]; const pageSize=1000;
  for(let offset=0;offset<20000;offset+=pageSize){
    const {data,error}=await db.from(table).select(columns).range(offset,offset+pageSize-1);
    if(error)throw new Error(`${table.toUpperCase()}_CATALOG_FAILED:${error.code||''}:${error.message}`);
    const rows=Array.isArray(data)?data:[]; out.push(...rows);
    if(rows.length<pageSize)break;
  }
  return out;
}

async function loadIdentityCatalog(db:any){
  const now=Date.now();
  if(identityCatalog&&identityCatalog.expiresAt>now)return identityCatalog;
  const [teams,aliases]=await Promise.all([
    fetchAll(db,'teams','team_id,canonical_name'),
    fetchAll(db,'team_aliases','team_id,alias_display')
  ]);
  const teamById=new Map<string,string>();
  for(const row of teams){
    const id=String(row?.team_id||''),canonical=String(row?.canonical_name||'').trim();
    if(id&&canonical)teamById.set(id,canonical);
  }
  const folded=new Map<string,Map<string,IdentityCandidate>>(),club=new Map<string,Map<string,IdentityCandidate>>();
  const index=(label:string,teamId:string)=>{
    const canonical=teamById.get(teamId); if(!canonical)return;
    const candidate={team_id:teamId,canonical_name:canonical};
    addCandidate(folded,foldName(label),candidate);
    const clubKey=clubIdentityKey(label); if(clubKey.length>=3)addCandidate(club,clubKey,candidate);
  };
  for(const [teamId,canonical] of teamById)index(canonical,teamId);
  for(const row of aliases){const teamId=String(row?.team_id||''),label=String(row?.alias_display||'').trim();if(teamId&&label)index(label,teamId);}
  identityCatalog={expiresAt:now+5*60*1000,folded,club};
  return identityCatalog;
}

const uniqueCandidate=(bucket:Map<string,IdentityCandidate>|undefined)=>{
  const values=bucket?[...bucket.values()]:[];
  return values.length===1?values[0]:null;
};

const AUTO_ALIAS_DECORATOR_TOKENS=new Set(['town','city','united','utd']);

const autoAliasClass=(value:string)=>{
  const tokens=foldName(value).split(' ').filter(Boolean);
  const youth=tokens.find(t=>/^u(?:17|18|19|20|21|23)$/.test(t));
  if(youth)return youth.toUpperCase();
  if(tokens.some(t=>['women','woman','ladies','lady','feminine','feminin','femenino','femenina'].includes(t)))return 'WOMEN';
  const last=tokens[tokens.length-1]??'';
  if(tokens.includes('reserve')||tokens.includes('reserves')||last==='ii'||last==='b')return 'RESERVE';
  return 'SENIOR';
};

const autoAliasKey=(value:string)=>
  clubIdentityKey(value)
    .split(' ')
    .filter(t=>t&&!AUTO_ALIAS_DECORATOR_TOKENS.has(t))
    .join(' ');

async function deterministicFallback(db:any,name:string){
  const catalog=await loadIdentityCatalog(db);

  const foldedKey=foldName(name);
  const foldedBucket=catalog.folded.get(foldedKey);
  const folded=uniqueCandidate(foldedBucket);

  if(folded){
    return{
      status:'RESOLVED',
      team_id:folded.team_id,
      canonical_name:folded.canonical_name,
      resolution:'CANONICAL_FOLDED_EXACT',
      confidence:1
    };
  }

  if(foldedBucket&&foldedBucket.size>1){
    return{
      status:'UNRESOLVED',
      resolution:'AMBIGUOUS_EXACT_IDENTITY_KEY',
      input:name
    };
  }

  const clubKey=clubIdentityKey(name);
  const clubBucket=clubKey.length>=3
    ? catalog.club.get(clubKey)
    : undefined;

  const club=uniqueCandidate(clubBucket);

  if(club){
    return{
      status:'RESOLVED',
      team_id:club.team_id,
      canonical_name:club.canonical_name,
      resolution:'CANONICAL_CLUB_KEY_EXACT',
      confidence:1
    };
  }

  if(clubBucket&&clubBucket.size>1){
    return{
      status:'UNRESOLVED',
      resolution:'AMBIGUOUS_EXACT_IDENTITY_KEY',
      input:name
    };
  }

  const key=autoAliasKey(name);
  const klass=autoAliasClass(name);
  const hits=new Map<string,IdentityCandidate>();

  if(key.length>=3){
    for(const [label,bucket] of catalog.folded){
      if(autoAliasClass(label)!==klass)continue;
      if(autoAliasKey(label)!==key)continue;

      for(const candidate of bucket.values()){
        hits.set(candidate.team_id,candidate);
      }
    }
  }

  if(hits.size===1){
    const candidate=[...hits.values()][0];

    return{
      status:'RESOLVED',
      team_id:candidate.team_id,
      canonical_name:candidate.canonical_name,
      resolution:'AUTO_ALIAS_UNIQUE_DECORATOR_EXACT',
      confidence:1
    };
  }

  if(hits.size>1){
    return{
      status:'UNRESOLVED',
      resolution:'AMBIGUOUS_AUTO_ALIAS_KEY',
      input:name
    };
  }

  return{
    status:'UNRESOLVED',
    resolution:'NO_EXACT_IDENTITY_KEY',
    input:name
  };
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return json({ok:true});
  if(req.method!=='POST')return json({error:'POST_REQUIRED'},405);

  const expected=Deno.env.get('CFI_ACTION_KEY');
  if(!expected)return json({error:'SERVER_KEY_NOT_CONFIGURED'},500);
  if(req.headers.get('x-cfi-key')!==expected)return json({error:'UNAUTHORIZED'},401);

  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return json({error:'SERVER_SECRET_MISSING'},500);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

  const body=await req.json().catch(()=>({}));
  const mode=String(body?.mode||'').trim().toUpperCase();
  const targetDate=String(body?.target_date||body?.matchDate||'').slice(0,10)||null;

  if(mode==='FIXTURES_BY_DATE'){
    if(!targetDate||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return json({error:'TARGET_DATE_REQUIRED'},400);
    const limit=Math.max(1,Math.min(400,Number(body?.limit??200)||200));
    const {data,error}=await db.from('fixtures')
      .select(`
        fixture_id,
        match_date,
        status,
        competition_key,
        competition_name,
        country,
        season,
        competition_segment,
        home:teams!fixtures_home_team_id_fkey(team_id,canonical_name),
        away:teams!fixtures_away_team_id_fkey(team_id,canonical_name)
      `)
      .eq('match_date',targetDate)
      .order('fixture_id',{ascending:true})
      .limit(limit);
    if(error)return json({error:'FIXTURES_BY_DATE_FAILED',message:error.message},500);
    const rows=(data||[]).map((r:any)=>({
      fixtureId:r.fixture_id,
      targetDate:String(r.match_date).slice(0,10),
      home:String(r.home?.canonical_name||''),
      away:String(r.away?.canonical_name||''),
      homeTeamId:r.home?.team_id??null,
      awayTeamId:r.away?.team_id??null,
      competition:r.competition_name??r.competition_key??null,
      country:r.country??null,
      season:r.season??null,
      segment:r.competition_segment??null,
      status:r.status??null
    })).filter((r:any)=>r.home&&r.away);
    return json({
      status:'OK',
      version:'CFI_BIG_DB_FIXTURES_BY_DATE_V1',
      source:'BIGDB_CANONICAL',
      targetDate,
      count:rows.length,
      rows
    });
  }

  const home=String(body?.home||'').trim(),away=String(body?.away||'').trim();
  if(!home||!away)return json({error:'HOME_AWAY_REQUIRED'},400);
  if(!targetDate)return json({error:'TARGET_DATE_REQUIRED'},400);

  const resolve=async(name:string)=>{
    const bridged=bridgeProviderTeamName(name);
    const {data,error}=await db.rpc('cfi_resolve_team_name',{p_name:bridged});
    if(!error&&data?.status==='RESOLVED')return bridged===name?data:{...data,resolution:'PROVIDER_ALIAS_TO_RPC_EXACT',providerInput:name,bridgedInput:bridged};
    const fallback=await deterministicFallback(db,bridged);
    if(fallback?.status==='RESOLVED')return bridged===name?fallback:{...fallback,resolution:'PROVIDER_ALIAS_TO_DETERMINISTIC_EXACT',providerInput:name,bridgedInput:bridged};
    if(error)return{...fallback,rpcError:`${error.code||''}:${error.message}`};
    return{...fallback,rpcResolution:data?.resolution??data?.status??null};
  };
  let homeResolution:any,awayResolution:any;
  try{[homeResolution,awayResolution]=await Promise.all([resolve(home),resolve(away)]);}
  catch(error:any){return json({error:'TEAM_LOOKUP_FAILED',message:String(error?.message||error)},500);}
  const hr=homeResolution?.status==='RESOLVED'?{team_id:homeResolution.team_id,canonical_name:homeResolution.canonical_name}:null;
  const ar=awayResolution?.status==='RESOLVED'?{team_id:awayResolution.team_id,canonical_name:awayResolution.canonical_name}:null;
  const ids=[hr?.team_id,ar?.team_id].filter(Boolean);

  const {data:rows,error:fe}=await db.from('fixtures')
    .select('fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,competition_key,competition_name,country,season,competition_segment')
    .or(ids.length?ids.map((id:string)=>`home_team_id.eq.${id},away_team_id.eq.${id}`).join(','):'fixture_id.is.null')
    .lt('match_date',targetDate)
    .order('match_date',{ascending:false});
  if(fe)return json({error:'FIXTURE_LOOKUP_FAILED',message:fe.message},500);

  const allTeamIds=[...new Set((rows||[]).flatMap((r:any)=>[r.home_team_id,r.away_team_id]).filter(Boolean))];
  const teamNameById=new Map<string,string>();
  for(let i=0;i<allTeamIds.length;i+=100){
    const batch=allTeamIds.slice(i,i+100);
    const {data:tn,error:tne}=await db.from('teams').select('team_id,canonical_name').in('team_id',batch);
    if(tne)return json({error:'TEAM_NAME_HYDRATION_FAILED',message:tne.message,batchStart:i,batchSize:batch.length,totalTeamIds:allTeamIds.length},500);
    for(const t of tn||[])teamNameById.set((t as any).team_id,(t as any).canonical_name);
  }
  const namedRows=(rows||[]).map((r:any)=>({...r,home_name:teamNameById.get(r.home_team_id)||String(r.home_team_id||''),away_name:teamNameById.get(r.away_team_id)||String(r.away_team_id||'')}));

  const fixtureIds=[...new Set(namedRows.map((r:any)=>r.fixture_id).filter(Boolean))];
  const provBy=new Map<string,any[]>();
  for(let i=0;i<fixtureIds.length;i+=100){
    const batch=fixtureIds.slice(i,i+100);if(!batch.length)continue;
    const {data:p,error:pe}=await db.from('provenance').select('fixture_id,source_type,source_label,image_hash,observed_at').in('fixture_id',batch);
    if(pe)return json({error:'PROVENANCE_LOOKUP_FAILED',message:pe.message,batchStart:i,batchSize:batch.length,totalFixtureIds:fixtureIds.length},500);
    for(const x of p||[]){const a=provBy.get((x as any).fixture_id)||[];a.push(x);provBy.set((x as any).fixture_id,a)}
  }

  const classify=(r:any)=>{const p=provBy.get(r.fixture_id)||[],shot=p.some((x:any)=>isScreenshot(String(x.source_type||''))),non=p.some((x:any)=>!isScreenshot(String(x.source_type||'')));return{...r,provenance:p,provenanceClass:shot&&non?'OVERLAP':shot?'SCREENSHOT_ONLY':non?'BIG_DB_ONLY':'UNKNOWN'}};
  const enriched=namedRows.map(classify);
  const teamRows=(id:string|undefined)=>id?enriched.filter((r:any)=>r.home_team_id===id||r.away_team_id===id):[];
  const h=teamRows(hr?.team_id),a=teamRows(ar?.team_id);
  const h2h=hr&&ar?enriched.filter((r:any)=>(r.home_team_id===hr.team_id&&r.away_team_id===ar.team_id)||(r.home_team_id===ar.team_id&&r.away_team_id===hr.team_id)):[];
  const stats=(xs:any[])=>({retrieved:xs.length,screenshotOnly:xs.filter(x=>x.provenanceClass==='SCREENSHOT_ONLY').length,bigDbOnly:xs.filter(x=>x.provenanceClass==='BIG_DB_ONLY').length,overlap:xs.filter(x=>x.provenanceClass==='OVERLAP').length,unknown:xs.filter(x=>x.provenanceClass==='UNKNOWN').length});

  const [{data:prior,error:ge},{data:scorelinePrior,error:se}]=await Promise.all([
    db.rpc('cfi_global_prior_before',{p_before:targetDate}),
    db.rpc('cfi_global_scoreline_prior_before',{p_before:targetDate})
  ]);
  if(ge)return json({error:'GLOBAL_PRIOR_FAILED',message:ge.message},500);
  if(se)return json({error:'GLOBAL_SCORELINE_PRIOR_FAILED',message:se.message},500);

  const g=Array.isArray(prior)?prior[0]:prior;
  const rate=(hits:any,eligible:any)=>Number(eligible)>0?Number(hits)/Number(eligible):null;
  const globalPrior={fixtureCount:Number(g?.fixture_count||0),markets:{
    '3+ HT':{eligible:Number(g?.eligible_3plus_ht||0),hits:Number(g?.hits_3plus_ht||0),rate:rate(g?.hits_3plus_ht,g?.eligible_3plus_ht)},
    '7+ FT':{eligible:Number(g?.eligible_7plus_ft||0),hits:Number(g?.hits_7plus_ft||0),rate:rate(g?.hits_7plus_ft,g?.eligible_7plus_ft)},
    'Other HT':{eligible:Number(g?.eligible_other_ht||0),hits:Number(g?.hits_other_ht||0),rate:rate(g?.hits_other_ht,g?.eligible_other_ht)},
    'Other FT':{eligible:Number(g?.eligible_other_ft||0),hits:Number(g?.hits_other_ft||0),rate:rate(g?.hits_other_ft,g?.eligible_other_ft)}
  }};

  const dates=enriched.map((r:any)=>String(r.match_date).slice(0,10));
  const maxExact=dates.length?[...dates].sort().at(-1):null;
  const futureExact=enriched.filter((r:any)=>String(r.match_date).slice(0,10)>targetDate).length;
  const sameExact=enriched.filter((r:any)=>String(r.match_date).slice(0,10)===targetDate).length;
  const {data:maxGlobal,error:me}=await db.from('fixtures').select('match_date').lt('match_date',targetDate).order('match_date',{ascending:false}).limit(1);
  if(me)return json({error:'TEMPORAL_AUDIT_FAILED',message:me.message},500);
  const maxGlobalDate=maxGlobal?.[0]?.match_date?String(maxGlobal[0].match_date).slice(0,10):null;
  const maxEvidenceDate=[maxExact,maxGlobalDate].filter(Boolean).sort().at(-1)||null;
  const temporalAudit={targetDate,maxEvidenceDate,exactTeamMaxEvidenceDate:maxExact,globalPriorMaxEvidenceDate:maxGlobalDate,futureEvidenceCount:futureExact,sameDateEvidenceCount:sameExact,observable:maxEvidenceDate!==null,verified:maxEvidenceDate!==null&&maxEvidenceDate<targetDate&&futureExact===0&&sameExact===0,rule:'fixtureDate < targetDate'};

  return json({
    status:'OK',version:'CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE',targetDate,
    identity:{homeFound:!!hr,awayFound:!!ar,homeTeamId:hr?.team_id??null,awayTeamId:ar?.team_id??null,homeInput:home,awayInput:away,homeCanonical:hr?.canonical_name??null,awayCanonical:ar?.canonical_name??null,homeResolution:homeResolution?.resolution??null,awayResolution:awayResolution?.resolution??null},
    hydration:{teamNames:true,hydratedTeamCount:teamNameById.size},
    currentSessionProvenance:'NOT_OBSERVABLE_WITHOUT_SESSION_ID_OR_IMAGE_HASHES',
    exactTeam:{home:stats(h),away:stats(a),h2h:stats(h2h)},
    bigDbOnlyAdded:stats(h).bigDbOnly+stats(a).bigDbOnly-stats(h2h).bigDbOnly,
    globalPrior,globalScorelinePrior:scorelinePrior,
    temporalAudit,maxEvidenceDate,futureEvidenceCount:futureExact,sameDateEvidenceCount:sameExact,
    fixtures:{home:h,away:a,h2h}
  });
});
