import { createClient } from "npm:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type,x-cfi-node-key,x-cfi-bridge-key",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
const ALLOWED=new Set(["FOTMOB","FLASHSCORE","SOFASCORE","AISCORE","FOOTBALL_DATA","FOOTBALL_DATA_CO_UK","FOOTBALL_DATA_ORG"]);
const n=(v:any)=>{const x=Number(v);return Number.isInteger(x)&&x>=0&&x<=30?x:null;};
const normClass=(v:any)=>String(v??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(w|women)\b/g," women ").replace(/\bu[\s-]?(\d{2})\b/g," u$1 ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const entityClass=(v:string)=>{const x=normClass(v),age=x.match(/\bu(\d{2})\b/)?.[1]??null;if(/\bwomen\b/.test(x))return age?`WOMEN_U${age}`:"WOMEN";if(age)return`U${age}`;if(/\b(youth|academy)\b/.test(x))return"YOUTH";if(/\breserve\b/.test(x)||/\b(ii|b)\b$/.test(x))return"RESERVE";return"SENIOR";};
const compactKickoff=(iso:string)=>{const d=new Date(iso);if(!Number.isFinite(d.getTime()))return"NA";return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");};
const cleanId=(v:any)=>String(v??"").replace(/\|/g,"_").slice(0,96)||"NA";
const sourceFamily=(v:any)=>{const s=String(v??"").toUpperCase();if(s==="FOOTBALL_DATA")return"FOOTBALL_DATA_CO_UK";return s;};
const independent=(a:any,b:any)=>{const A=sourceFamily(a),B=sourceFamily(b);if(!A||!B||A===B)return false;if(new Set([A,B]).has("FOOTBALL_DATA_CO_UK")&&new Set([A,B]).has("FLASHSCORE"))return false;return true;};
const hasIndependentPair=(xs:any[])=>xs.some((a:any,i:number)=>xs.some((b:any,j:number)=>j>i&&independent(a.source,b.source)));
const independentPairs=(xs:any[])=>{const out:any[]=[];for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)if(independent(xs[i].source,xs[j].source))out.push([xs[i],xs[j]]);return out;};
const validKickoff=(v:any)=>Number.isFinite(Date.parse(String(v??"")));
const kickoffClose=(a:any,b:any,maxMs=30*60*1000)=>validKickoff(a)&&validKickoff(b)&&Math.abs(Date.parse(String(a))-Date.parse(String(b)))<=maxMs;


const STOP=new Set(["fc","cf","sc","afc","fk","club","football","de"]);
const norm=(v:any)=>String(v??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  .replace(/\bmanchester utd\b/g,"manchester united").replace(/\bman utd\b/g,"manchester united").replace(/\butd\b/g,"united")
  .replace(/\b(w|women)\b/g," women ").replace(/\bu[\s-]?(\d{2})\b/g," u$1 ")
  .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const toks=(v:any)=>norm(v).split(/\s+/).filter((x:string)=>x&&!STOP.has(x));
const safeCompatible=(a:any,b:any)=>{if(entityClass(String(a??""))!==entityClass(String(b??"")))return false;const A=norm(a),B=norm(b);if(!A||!B)return false;if(A===B)return true;const aa=toks(a),bb=toks(b),short=aa.length<=bb.length?aa:bb,long=new Set(aa.length<=bb.length?bb:aa);return short.length>=1&&short.every((x:string)=>long.has(x));};
// Historical ingest is an evidence boundary, not a search hint.  Never let a
// token subset turn "Newcastle University" into "Newcastle".
const exactTeamCompatible=(a:any,b:any)=>entityClass(String(a??""))===entityClass(String(b??""))&&norm(a)===norm(b)&&Boolean(norm(a));
const directHistoricalSource=(s:any)=>["FOTMOB","SOFASCORE","AISCORE","FOOTBALL_DATA_CO_UK","FOOTBALL_DATA_ORG","FLASHSCORE"].includes(String(s??"").toUpperCase());


async function resolveCanonical(raw:string,db:any){
  const name=String(raw??"").trim();if(!name)return{status:"EMPTY",canonical:null};
  const {data:exact,error:ee}=await db.from("teams").select("canonical_name").eq("canonical_name",name).limit(2);
  if(ee)throw new Error(`TEAM_EXACT_LOOKUP:${ee.message}`);
  if(exact?.length===1)return{status:"EXACT",canonical:String(exact[0].canonical_name)};
  const [h,a]=await Promise.all([
    db.from("cfi_result_resolutions").select("home_team").eq("status","VERIFIED").eq("external_home_team",name).limit(20),
    db.from("cfi_result_resolutions").select("away_team").eq("status","VERIFIED").eq("external_away_team",name).limit(20)
  ]);
  if(h.error)throw new Error(`TEAM_ALIAS_HOME:${h.error.message}`);if(a.error)throw new Error(`TEAM_ALIAS_AWAY:${a.error.message}`);
  const candidates=[...new Set([...(h.data??[]).map((r:any)=>String(r.home_team??"").trim()),...(a.data??[]).map((r:any)=>String(r.away_team??"").trim())].filter(Boolean))];
  if(candidates.length!==1)return{status:candidates.length?"AMBIGUOUS":"UNMATCHED",canonical:null,candidates};
  if(entityClass(name)!==entityClass(candidates[0]))return{status:"CLASS_MISMATCH",canonical:null,candidates};
  return{status:"VERIFIED_ALIAS",canonical:candidates[0]};
}


async function resolveHistoryName(raw:string,db:any){
  const r:any=await resolveCanonical(raw,db);
  if(r.canonical)return r;
  if(r.status==="UNMATCHED")return{status:"BOOTSTRAP_RAW",canonical:String(raw??"").trim()};
  return r;
}

async function resolveResultName(raw:string,sourceNames:string[],db:any){
  const r:any=await resolveCanonical(raw,db);
  if(r.canonical)return r;
  if(r.status!=="UNMATCHED")return r;
  const name=String(raw??"").trim(),clean=sourceNames.map(String).filter(Boolean);
  if(!name||clean.length<2)return{status:"RESULT_BOOTSTRAP_INSUFFICIENT_IDENTITY",canonical:null};
  if(clean.some((x:string)=>entityClass(name)!==entityClass(x)||!safeCompatible(name,x)))
    return{status:"RESULT_BOOTSTRAP_SOURCE_IDENTITY_CONFLICT",canonical:null,sourceNames:clean};
  return{status:"BOOTSTRAP_RESULT_DUAL_SOURCE",canonical:name};
}


const BRIDGE_BUCKET="cfi-pc-bridge-v1";
const PC_HEARTBEAT_PATH="runtime/pc-heartbeat.json";
const bridgeNorm=(v:any)=>String(v??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const bridgeId=(f:any)=>{
  const s=[String(f?.targetDate??f?.target_date??"").slice(0,10),bridgeNorm(f?.home),bridgeNorm(f?.away),String(f?.providerId??"")].join("|");
  let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return `q${(h>>>0).toString(16).padStart(8,"0")}`;
};
async function ensureBridgeBucket(db:any){
  const {data}=await db.storage.getBucket(BRIDGE_BUCKET);
  if(data)return;
  const {error}=await db.storage.createBucket(BRIDGE_BUCKET,{public:false,fileSizeLimit:1048576});
  if(error&&!/already|exists|duplicate/i.test(String(error.message??"")))throw new Error(`BRIDGE_BUCKET:${error.message}`);
}
async function pcHeartbeat(db:any,nodeId:any){
  await ensureBridgeBucket(db);
  const payload={nodeId:String(nodeId??'PC_NODE').slice(0,96),readyAt:new Date().toISOString()};
  const {error}=await db.storage.from(BRIDGE_BUCKET).upload(PC_HEARTBEAT_PATH,new TextEncoder().encode(JSON.stringify(payload)),{contentType:'application/json',upsert:true});
  if(error)throw new Error(`PC_HEARTBEAT:${error.message}`);
  return{status:'OK',available:true,nodeId:payload.nodeId};
}

async function saveFixtureDiscoveryBatch(db:any,body:any){
  const source=String(body?.source??"").trim().toUpperCase();
  if(source!=="AISCORE"&&source!=="FOOTBALL_DATA_CO_UK"&&source!=="FOOTBALL_DATA")
    return{status:"REJECTED",reason:"DISCOVERY_SOURCE_NOT_ALLOWED"};

  const targetDate=String(body?.target_date??body?.targetDate??"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))
    return{status:"REJECTED",reason:"TARGET_DATE_INVALID"};

  const input=Array.isArray(body?.fixtures)?body.fixtures.slice(0,500):[];
  const fixtures:any[]=[];

  for(const raw of input){
    const providerId=String(raw?.providerId??raw?.provider_id??"").trim().slice(0,180);
    const home=String(raw?.home??raw?.home_team??"").trim().slice(0,180);
    const away=String(raw?.away??raw?.away_team??"").trim().slice(0,180);
    const kickoffIso=String(raw?.kickoffIso??raw?.kickoff_utc??"").trim();
    const kickoffLocal=String(raw?.kickoffLocal??raw?.kickoff_local??"").trim().slice(0,8);
    const status=String(raw?.status??"scheduled").trim().toLowerCase().slice(0,40);
    const sourceUrls=(Array.isArray(raw?.sourceUrls)?raw.sourceUrls:[raw?.source_url])
      .map((x:any)=>String(x??"").trim()).filter((x:string)=>validHttps(x)).slice(0,6);

    if(!providerId||!home||!away||home===away||!sourceUrls.length)continue;
    if(kickoffIso&&!Number.isFinite(Date.parse(kickoffIso)))continue;

    fixtures.push({
      provider:source==="FOOTBALL_DATA"?"FOOTBALL_DATA_CO_UK":source,
      providerId,
      home,
      away,
      competition:raw?.competition?String(raw.competition).slice(0,180):null,
      country:raw?.country?String(raw.country).slice(0,100):null,
      kickoffIso:kickoffIso||null,
      kickoffLocal:kickoffLocal||null,
      targetDate,
      status,
      sourceUrls,
      discoveredAt:String(raw?.discoveredAt??body?.generated_at??new Date().toISOString())
    });
  }

  await ensureBridgeBucket(db);
  const provider=source==="FOOTBALL_DATA"?"FOOTBALL_DATA_CO_UK":source;
  const path=`runtime/fixture-discovery-${provider}-${targetDate}.json`;
  const payload={
    contract:"CFI_PC_FIXTURE_DISCOVERY_BATCH_V1",
    provider,
    targetDate,
    generatedAt:new Date().toISOString(),
    count:fixtures.length,
    fixtures,
    canonicalWriteAttempted:false,
    decisionUse:false
  };
  const {error}=await db.storage.from(BRIDGE_BUCKET).upload(
    path,
    new TextEncoder().encode(JSON.stringify(payload)),
    {contentType:"application/json",upsert:true}
  );
  if(error)throw new Error(`FIXTURE_DISCOVERY_UPLOAD:${error.message}`);

  return{
    status:"ACCEPTED",
    mode:"FIXTURE_DISCOVERY_BATCH",
    provider,
    targetDate,
    count:fixtures.length,
    storagePath:path,
    canonicalWriteAttempted:false,
    decisionUse:false
  };
}

async function pcPresence(db:any){
  await ensureBridgeBucket(db);const payload=await readBridgeFixture(db,PC_HEARTBEAT_PATH);
  const age=Date.now()-Date.parse(String(payload?.readyAt??''));
  const available=Number.isFinite(age)&&age>=0&&age<10*60*1000;
  return{status:'OK',available,reason:available?'PC_NODE_PRIMARY_ACTIVE':'PC_NODE_HEARTBEAT_STALE'};
}
function compactCandidate(raw:any){
  const home=String(raw?.home??"").trim(),away=String(raw?.away??"").trim(),kickoffIso=String(raw?.kickoffIso??raw?.kickoff_iso??"").trim();
  const targetDate=String(raw?.targetDate??raw?.target_date??kickoffIso.slice(0,10)).slice(0,10);
  const status=String(raw?.status??"").trim().toLowerCase();
  const sourceUrls=(Array.isArray(raw?.sourceUrls)?raw.sourceUrls:[]).map((value:any)=>String(value??"").trim()).filter(Boolean).slice(0,6);
  return{
    ...(String(raw?.provider??"").trim()?{provider:String(raw.provider).trim().slice(0,40)}:{}),
    providerId:String(raw?.providerId??"").trim().slice(0,160),
    home,away,
    competition:raw?.competition?String(raw.competition).slice(0,160):undefined,
    country:raw?.country?String(raw.country).slice(0,80):undefined,
    kickoffIso,targetDate,
    status,
    sourceUrls,
    ...(String(raw?.discoveredAt??"").trim()?{discoveredAt:String(raw.discoveredAt).trim()}: {})
  };
}
function validHttps(value:any){try{return new URL(String(value??"")).protocol==="https:";}catch{return false;}}
async function readBridgeFixture(db:any,path:string){
  const {data,error}=await db.storage.from(BRIDGE_BUCKET).download(path);
  if(error||!data){
    if(/not[ _-]?found|does not exist|object missing/i.test(String(error?.message??"")))return null;
    throw new Error(`BRIDGE_QUEUE_READ:${String(error?.message??"NO_DATA")}`);
  }
  try{return JSON.parse(await data.text());}catch{throw new Error("BRIDGE_QUEUE_CORRUPT");}
}
function queueProof(payload:any,f:any,id:string,deduped:boolean){
  if(payload?.queueId!==id||payload?.fixture?.providerId!==f.providerId||payload?.fixture?.targetDate!==f.targetDate||payload?.fixture?.home!==f.home||payload?.fixture?.away!==f.away)
    throw new Error("BRIDGE_QUEUE_IDENTITY_PROOF_FAILED");
  return{
    status:"QUEUED",queueId:id,providerId:f.providerId,queuedAt:String(payload.queuedAt),deduped,
    fixture:{targetDate:f.targetDate,home:f.home,away:f.away,kickoffIso:f.kickoffIso}
  };
}
async function queueBridgeFixture(db:any,raw:any,reason:any){
  const f=compactCandidate(raw);
  if(!f.providerId||!f.home||!f.away||!/^\d{4}-\d{2}-\d{2}$/.test(f.targetDate)||!Number.isFinite(Date.parse(f.kickoffIso))||!f.sourceUrls.length||f.sourceUrls.some((url:string)=>!validHttps(url)))
    return{status:"REJECTED",reason:"BRIDGE_FIXTURE_IDENTITY_PROVENANCE_REQUIRED"};
  if(!["scheduled","notstarted","pre"].includes(f.status))return{status:"REJECTED",reason:"BRIDGE_PREMATCH_STATUS_REQUIRED"};
  if(Date.parse(f.kickoffIso)<=Date.now()+60000)return{status:"REJECTED",reason:"BRIDGE_PREMATCH_ONLY"};
  await ensureBridgeBucket(db);
  const id=bridgeId(f),path=`urgent/${id}.json`;
  const existing=await readBridgeFixture(db,path);
  if(existing)return queueProof(existing,f,id,true);
  const payload={
    bridgeVersion:"CFI_EXTERNAL_TO_PC_BRIDGE_V1",queueId:id,status:"PENDING",
    reason:String(reason??"ZERO_EXACT_TEAM_EVIDENCE").toUpperCase(),
    queuedAt:new Date().toISOString(),entityClass:{home:entityClass(f.home),away:entityClass(f.away)},fixture:f
  };
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const {error}=await db.storage.from(BRIDGE_BUCKET).upload(path,bytes,{contentType:"application/json",upsert:false});
  if(error&&!/already|exists|duplicate/i.test(String(error.message??"")))throw new Error(`BRIDGE_QUEUE_UPLOAD:${error.message}`);
  const persisted=await readBridgeFixture(db,path);
  if(!persisted)throw new Error("BRIDGE_QUEUE_PERSISTENCE_NOT_CONFIRMED");
  return queueProof(persisted,f,id,Boolean(error));
}
async function pullBridgeFixtures(db:any,limit=12){
  await ensureBridgeBucket(db);
  const requested=Math.max(1,Math.min(30,Number(limit)||12));
  // Queue files are append-only until a targeted retry succeeds.  Pull the
  // newest bounded batch first so expired files at the head cannot starve a
  // just-queued fixture or turn the bridge request into a storage scan.
  const {data,error}=await db.storage.from(BRIDGE_BUCKET).list("urgent",{limit:requested,sortBy:{column:"created_at",order:"desc"}});
  if(error)throw new Error(`BRIDGE_LIST:${error.message}`);
  const items:any[]=[];
  for(const x of data??[]){
    if(!String(x?.name??"").endsWith(".json"))continue;
    const {data:blob,error:de}=await db.storage.from(BRIDGE_BUCKET).download(`urgent/${x.name}`);
    if(de||!blob)continue;
    try{
      const parsed=JSON.parse(await blob.text());
      const fixture=parsed?.fixture??{},kickoff=Date.parse(String(fixture?.kickoffIso??""));
      const status=String(fixture?.status??"").trim().toLowerCase();
      const pending=String(parsed?.status??"").toUpperCase()==="PENDING";
      if(pending&&parsed?.queueId&&fixture?.home&&fixture?.away&&
        ["scheduled","notstarted","pre"].includes(status)&&
        Number.isFinite(kickoff)&&kickoff>Date.now()+60000){
        items.push(parsed);
        if(items.length>=requested)break;
      }
    }catch{}
  }
  return items;
}
async function ackBridgeFixtures(db:any,ids:any[]){
  const paths=(Array.isArray(ids)?ids:[]).map(String).filter(x=>/^q[0-9a-f]{8}$/.test(x)).slice(0,30).map(x=>`urgent/${x}.json`);
  if(!paths.length)return{removed:0};
  const {error}=await db.storage.from(BRIDGE_BUCKET).remove(paths);
  if(error)throw new Error(`BRIDGE_ACK:${error.message}`);
  return{removed:paths.length};
}
async function peekBridgeFixture(db:any,raw:any){
  const f=compactCandidate(raw);
  if(!f.providerId||!f.home||!f.away||!/^\d{4}-\d{2}-\d{2}$/.test(f.targetDate))return{status:"REJECTED",reason:"BRIDGE_PEEK_EXACT_IDENTITY_REQUIRED"};
  await ensureBridgeBucket(db);
  const id=bridgeId(f),payload=await readBridgeFixture(db,`urgent/${id}.json`);
  if(!payload)return{status:"OK",mode:"URGENT_FIXTURE_PEEK",found:false,providerId:f.providerId};
  const proof=queueProof(payload,f,id,true);
  return{status:"OK",mode:"URGENT_FIXTURE_PEEK",found:true,item:{queueId:proof.queueId,providerId:proof.providerId,queuedAt:proof.queuedAt,status:String(payload.status??"PENDING"),reason:String(payload.reason??""),targetDate:String(payload.fixture?.targetDate??""),home:String(payload.fixture?.home??""),away:String(payload.fixture?.away??""),kickoffIso:String(payload.fixture?.kickoffIso??"")}};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"POST_REQUIRED"},405);
  const body=await req.json().catch(()=>({})),action=String(body?.action??"HEALTH").toUpperCase();
  const nodeExpected=Deno.env.get("CFI_PC_NODE_KEY");
  const bridgeExpected=Deno.env.get("CFI_CLOUD_BRIDGE_KEY");
  if(action==="URGENT_FIXTURE_QUEUE"||action==="URGENT_FIXTURE_PEEK"||action==="PC_NODE_PRESENCE"){
    if(!bridgeExpected)return json({error:"BRIDGE_KEY_NOT_CONFIGURED"},500);
    if(req.headers.get("x-cfi-bridge-key")!==bridgeExpected)return json({error:"UNAUTHORIZED_BRIDGE"},401);
  }else{
    if(!nodeExpected)return json({error:"NODE_KEY_NOT_CONFIGURED"},500);
    if(req.headers.get("x-cfi-node-key")!==nodeExpected)return json({error:"UNAUTHORIZED"},401);
  }
  const su=Deno.env.get("SUPABASE_URL"),sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!su||!sr)return json({error:"SERVER_SECRET_MISSING"},500);
  const db=createClient(su,sr,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==="PC_NODE_HEARTBEAT"){
    try{return json(await pcHeartbeat(db,body?.node_id));}catch(e){return json({status:'ERROR',reason:'PC_HEARTBEAT_ERROR'},500);}
  }
  if(action==="PC_NODE_PRESENCE"){
    try{return json(await pcPresence(db));}catch(e){return json({status:'ERROR',reason:'PC_PRESENCE_ERROR'},500);}
  }
  if(action==="URGENT_FIXTURE_QUEUE"){
    try{
      const result=await queueBridgeFixture(db,body?.fixture??body?.candidate??{},body?.reason);
      return json({status:result.status,service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R2",...result},result.status==="QUEUED"?202:422);
    }catch(e){return json({status:"ERROR",reason:"BRIDGE_QUEUE_ERROR",message:String((e as any)?.message??e)},500);}
  }
  if(action==="URGENT_FIXTURE_PEEK"){
    try{
      const result=await peekBridgeFixture(db,body?.fixture??body?.candidate??{});
      return json({service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R2",...result},result.status==="OK"?200:422);
    }catch(e){return json({status:"ERROR",reason:"BRIDGE_PEEK_ERROR",message:String((e as any)?.message??e)},500);}
  }
  if(action==="URGENT_FIXTURE_PULL"){
    try{
      const items=await pullBridgeFixtures(db,body?.limit??12);
      return json({status:"OK",service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R1",mode:"URGENT_FIXTURE_PULL",count:items.length,items});
    }catch(e){return json({status:"ERROR",reason:"BRIDGE_PULL_ERROR",message:String((e as any)?.message??e)},500);}
  }
  if(action==="URGENT_FIXTURE_ACK"){
    try{
      const r=await ackBridgeFixtures(db,body?.queue_ids??body?.queueIds??[]);
      return json({status:"OK",service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R1",mode:"URGENT_FIXTURE_ACK",...r});
    }catch(e){return json({status:"ERROR",reason:"BRIDGE_ACK_ERROR",message:String((e as any)?.message??e)},500);}
  }
  if(action==="HEALTH")return json({status:"OK",service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R3",nodeId:String(body?.node_id??"UNKNOWN"),time:new Date().toISOString(),capabilities:["RESULT_CONSENSUS","HISTORICAL_BACKFILL","PREDICTION_SNAPSHOT_LOOKUP","AISCORE","FIXTURE_DISCOVERY_BATCH","URGENT_FIXTURE_QUEUE","URGENT_FIXTURE_PEEK","URGENT_FIXTURE_PULL","URGENT_FIXTURE_ACK"]});



  if(action==="FIXTURE_DISCOVERY_BATCH"){
    try{
      const result=await saveFixtureDiscoveryBatch(db,body);
      return json({service:"CFI_PC_NODE_INGEST_EXTERNAL_BRIDGE_R3",...result},result.status==="ACCEPTED"?200:422);
    }catch(e){
      return json({status:"ERROR",reason:"FIXTURE_DISCOVERY_BATCH_ERROR",message:String((e as any)?.message??e)},500);
    }
  }

  if(action==="PREDICTION_SNAPSHOT_LOOKUP"){
    const targetDate=String(body?.target_date??"").slice(0,10),homeRaw=String(body?.home??"").trim(),awayRaw=String(body?.away??"").trim();
    const requestStartedAt=String(body?.request_started_at??"").trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!homeRaw||!awayRaw)return json({status:"REJECTED",reason:"TARGET_DATE_HOME_AWAY_REQUIRED"},422);
    const [hr,ar]=await Promise.all([resolveCanonical(homeRaw,db),resolveCanonical(awayRaw,db)]);
    const home=hr?.canonical??(hr?.status==="UNMATCHED"?homeRaw:null),away=ar?.canonical??(ar?.status==="UNMATCHED"?awayRaw:null);
    if(!home||!away)return json({status:"REJECTED",reason:"SNAPSHOT_LOOKUP_IDENTITY_UNRESOLVED",homeResolution:hr,awayResolution:ar},422);
    if(entityClass(home)!==entityClass(homeRaw)||entityClass(away)!==entityClass(awayRaw))return json({status:"REJECTED",reason:"SNAPSHOT_LOOKUP_CLASS_MISMATCH"},422);
    const {data,error}=await db.from("cfi_prediction_snapshots")
      .select("snapshot_id,target_date,home_team,away_team,created_at,strict_prior,prediction")
      .eq("target_date",targetDate).eq("home_team",home).eq("away_team",away)
      .order("created_at",{ascending:false}).limit(8);
    if(error)return json({status:"ERROR",reason:"SNAPSHOT_LOOKUP_DB_ERROR",message:error.message},500);
    const rows=(data??[]).map((r:any)=>({
      snapshot_id:String(r?.snapshot_id??""),
      target_date:String(r?.target_date??""),
      home_team:String(r?.home_team??""),
      away_team:String(r?.away_team??""),
      created_at:String(r?.created_at??""),
      strict_prior:r?.strict_prior===true,
      prediction_status:String(r?.prediction?.status??r?.prediction?.upstreamStatus??""),
      contract:String(r?.prediction?.presentationContract?.contract??r?.prediction?.sixTargetMatrix?.contract??"")
    }));
    return json({status:"OK",service:"CFI_PC_NODE_INGEST_R3_FINAL_COMBAT_AISCORE",mode:"PREDICTION_SNAPSHOT_LOOKUP",requestStartedAt,targetDate,home,away,count:rows.length,rows});
  }

  if(action==="HISTORICAL_BACKFILL"){
    const target=body?.target??{},fixture=body?.fixture??{};
    const targetTeam=String(target?.team??"").trim(),targetDate=String(target?.targetDate??"").slice(0,10),targetKickoffIso=String(target?.targetKickoffIso??"").trim();
    const matchDate=String(fixture?.matchDate??fixture?.match_date??"").slice(0,10),homeRaw=String(fixture?.home??"").trim(),awayRaw=String(fixture?.away??"").trim(),kickoffIso=String(fixture?.kickoffIso??fixture?.kickoff_utc??"").trim();
    if(!targetTeam||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeRaw||!awayRaw)return json({status:"REJECTED",reason:"HISTORY_IDENTITY_REQUIRED"},422);
    if(matchDate>=targetDate)return json({status:"REJECTED",reason:"STRICT_PRIOR_SAME_OR_FUTURE_DATE",strictPrior:{pass:false,targetDate,matchDate}},422);
    const tk=Date.parse(targetKickoffIso),hk=Date.parse(kickoffIso);
    if(Number.isFinite(tk)&&Number.isFinite(hk)&&hk>=tk)return json({status:"REJECTED",reason:"STRICT_PRIOR_KICKOFF_VIOLATION",strictPrior:{pass:false,targetKickoffIso,kickoffIso}},422);
    const sourceTargetNames=(Array.isArray(target?.sourceTeamNames)?target.sourceTeamNames.map(String):[]).filter((x:string)=>x&&exactTeamCompatible(targetTeam,x));
    const targetNames=[targetTeam,...sourceTargetNames].filter(Boolean);
    const targetOnHome=targetNames.some((x:string)=>exactTeamCompatible(x,homeRaw)),targetOnAway=targetNames.some((x:string)=>exactTeamCompatible(x,awayRaw));
    if((targetOnHome?1:0)+(targetOnAway?1:0)!==1)return json({status:"REJECTED",reason:"TARGET_TEAM_NOT_UNAMBIGUOUS_IN_HISTORY_FIXTURE",targetOnHome,targetOnAway},422);

    const rawSources=Array.isArray(body?.sources)?body.sources.slice(0,6):[];
    const cleanHist=rawSources.map((x:any)=>({source:String(x?.source??"").toUpperCase(),providerId:cleanId(x?.providerId??x?.id),sourceUrl:String(x?.sourceUrl??""),home:String(x?.home??homeRaw).trim(),away:String(x?.away??awayRaw).trim(),kickoffIso:String(x?.kickoffIso??kickoffIso),finished:x?.finished===true,hh:n(x?.hh??x?.ht?.home),ha:n(x?.ha??x?.ht?.away),fh:n(x?.fh??x?.ft?.home),fa:n(x?.fa??x?.ft?.away),observedAt:String(x?.observedAt??new Date().toISOString())}))
      .filter((x:any)=>ALLOWED.has(x.source)&&directHistoricalSource(x.source));
    const uniqueHist:any[]=[...new Map<string,any>(cleanHist.map((x:any)=>[sourceFamily(x.source),x])).values()];
    if(!uniqueHist.length)return json({status:"REJECTED",reason:"DIRECT_HISTORY_SOURCE_REQUIRED"},422);
    if(uniqueHist.some((x:any)=>!x.finished||[x.hh,x.ha,x.fh,x.fa].some((v:any)=>v===null)))return json({status:"REJECTED",reason:"COMPLETE_FINISHED_HT_FT_REQUIRED"},422);
    if(uniqueHist.some((x:any)=>!exactTeamCompatible(homeRaw,x.home)||!exactTeamCompatible(awayRaw,x.away)))return json({status:"REJECTED",reason:"HISTORY_SOURCE_IDENTITY_CONFLICT"},422);
    const score=(x:any)=>`${x.hh}-${x.ha}|${x.fh}-${x.fa}`,scoreKey=score(uniqueHist[0]);
    if(uniqueHist.some((x:any)=>score(x)!==scoreKey))return json({status:"CONFLICT",reason:"SOURCE_SCORE_CONFLICT",sources:uniqueHist.map((x:any)=>({source:x.source,score:score(x)}))},409);

    const targetResolved=await resolveHistoryName(targetTeam,db);
    if(!targetResolved.canonical)return json({status:"REJECTED",reason:"TARGET_CANONICALIZATION_FAILED",target:targetResolved},422);
    const [homeOther,awayOther]=await Promise.all([targetOnHome?Promise.resolve(null):resolveHistoryName(homeRaw,db),targetOnAway?Promise.resolve(null):resolveHistoryName(awayRaw,db)]);
    const home=targetOnHome?targetResolved:homeOther,away=targetOnAway?targetResolved:awayOther;
    if(!home?.canonical||!away?.canonical)return json({status:"REJECTED",reason:"HISTORY_CANONICALIZATION_FAILED",home,away},422);
    if(home.canonical===away.canonical)return json({status:"REJECTED",reason:"SELF_MATCH_AFTER_CANONICALIZATION"},422);
    const accepted:any[]=[];
    for(const src of uniqueHist){
      const label=`PCH3|${src.source}|${src.providerId}|T${targetDate.replaceAll("-","")}`;
      const{data,error}=await db.rpc("cfi_upsert_fixture",{p_match_date:matchDate,p_home_team:home.canonical,p_away_team:away.canonical,p_ht_home:src.hh,p_ht_away:src.ha,p_ft_home:src.fh,p_ft_away:src.fa,p_source_type:"PC_NODE_HISTORY",p_source_label:label,p_image_hash:null});
      if(error)return json({status:"ERROR",reason:"UPSERT_ERROR",message:error.message,accepted},500);
      const st=String(data?.status??"");
      if(st==="CONFLICT")return json({status:"CONFLICT",reason:"CANONICAL_UPSERT_CONFLICT",upsert:data,accepted},409);
      if(!["NEW","DUPLICATE_COMPATIBLE","COMPLEMENTARY"].includes(st))return json({status:"REJECTED",reason:"UPSERT_NOT_ACCEPTED",upsert:data,accepted},422);
      accepted.push({source:src.source,providerId:src.providerId,status:st,label});
    }
    return json({status:"ACCEPTED",service:"CFI_PC_NODE_INGEST_R3_FINAL_COMBAT_AISCORE",nodeId:String(body?.node_id??"UNKNOWN"),mode:"HISTORICAL_BACKFILL",fixture:{matchDate,home:home.canonical,away:away.canonical,kickoffIso:kickoffIso||null,ht:[uniqueHist[0].hh,uniqueHist[0].ha],ft:[uniqueHist[0].fh,uniqueHist[0].fa]},target:{team:targetTeam,targetDate,targetKickoffIso:targetKickoffIso||null},identity:{home:home.status,away:away.status},sourceCount:uniqueHist.length,sources:accepted,strictPrior:{pass:true,sameDateRejected:true,targetDate,matchDate,targetKickoffIso:targetKickoffIso||null,historyKickoffIso:kickoffIso||null}});
  }

  if(action!=="RESULT_CONSENSUS")return json({error:"INVALID_ACTION",allowed:["HEALTH","RESULT_CONSENSUS","HISTORICAL_BACKFILL","PREDICTION_SNAPSHOT_LOOKUP","FIXTURE_DISCOVERY_BATCH","URGENT_FIXTURE_QUEUE","URGENT_FIXTURE_PEEK","URGENT_FIXTURE_PULL","URGENT_FIXTURE_ACK"]},400);
  const fixture=body?.fixture??{},matchDate=String(fixture?.matchDate??fixture?.match_date??"").slice(0,10),homeRaw=String(fixture?.home??"").trim(),awayRaw=String(fixture?.away??"").trim(),kickoffIso=String(fixture?.kickoffIso??fixture?.kickoff_utc??"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeRaw||!awayRaw)return json({status:"REJECTED",reason:"FIXTURE_IDENTITY_REQUIRED"},422);
  const sources=Array.isArray(body?.sources)?body.sources.slice(0,6):[];
  const clean=sources.map((x:any)=>({
    source:String(x?.source??"").toUpperCase(),
    providerId:cleanId(x?.providerId??x?.id),
    sourceUrl:String(x?.sourceUrl??""),
    home:String(x?.home??homeRaw).trim(),
    away:String(x?.away??awayRaw).trim(),
    kickoffIso:String(x?.kickoffIso??kickoffIso),
    finished:x?.finished===true,
    hh:n(x?.hh??x?.ht?.home),ha:n(x?.ha??x?.ht?.away),
    fh:n(x?.fh??x?.ft?.home),fa:n(x?.fa??x?.ft?.away),
    observedAt:String(x?.observedAt??new Date().toISOString())
  })).filter((x:any)=>ALLOWED.has(x.source));
  const unique:any[]=[...new Map<string,any>(clean.map((x:any)=>[sourceFamily(x.source),x])).values()];
  if(unique.length<2||!hasIndependentPair(unique))return json({status:"REJECTED",reason:"TWO_INDEPENDENT_PRIMARY_SOURCES_REQUIRED",sourceCount:unique.length,sources:unique.map((x:any)=>x.source)},422);
  if(unique.some((x:any)=>!x.finished||[x.hh,x.ha,x.fh,x.fa].some((v:any)=>v===null)))return json({status:"REJECTED",reason:"COMPLETE_FINISHED_HT_FT_REQUIRED"},422);

  const compatible=unique.filter((x:any)=>safeCompatible(homeRaw,x.home)&&safeCompatible(awayRaw,x.away));
  const identityPairs=independentPairs(compatible);
  if(!identityPairs.length)return json({status:"REJECTED",reason:"TWO_SOURCE_FIXTURE_IDENTITY_REQUIRED",fixture:{home:homeRaw,away:awayRaw},sources:unique.map((x:any)=>({source:x.source,home:x.home,away:x.away}))},422);

  const key=(x:any)=>`${x.hh}-${x.ha}|${x.fh}-${x.fa}`,scoreKey=key(unique[0]);
  if(unique.some((x:any)=>key(x)!==scoreKey))return json({status:"CONFLICT",reason:"SOURCE_SCORE_CONFLICT",sources:unique.map((x:any)=>({source:x.source,ht:[x.hh,x.ha],ft:[x.fh,x.fa]}))},409);

  const proofPair=identityPairs.find((p:any[])=>key(p[0])===key(p[1])&&kickoffClose(p[0].kickoffIso,p[1].kickoffIso));
  if(!proofPair)return json({status:"REJECTED",reason:"TWO_INDEPENDENT_KICKOFF_VERIFIED_SOURCES_REQUIRED",sources:compatible.map((x:any)=>({source:x.source,kickoffIso:x.kickoffIso}))},422);

  const fixtureKickoffMs=Date.parse(kickoffIso);
  const proofKickoffs=proofPair.map((x:any)=>Date.parse(String(x.kickoffIso)));
  if(Number.isFinite(fixtureKickoffMs)&&proofKickoffs.some((x:number)=>Math.abs(x-fixtureKickoffMs)>30*60*1000))
    return json({status:"REJECTED",reason:"FIXTURE_KICKOFF_CONFLICT",fixtureKickoffIso:kickoffIso,proofKickoffs:proofPair.map((x:any)=>({source:x.source,kickoffIso:x.kickoffIso}))},422);

  const [home,away]=await Promise.all([
    resolveResultName(homeRaw,proofPair.map((x:any)=>x.home),db),
    resolveResultName(awayRaw,proofPair.map((x:any)=>x.away),db)
  ]);
  if(!home.canonical||!away.canonical)return json({status:"REJECTED",reason:"TEAM_CANONICALIZATION_FAILED",home,away},422);
  if(home.canonical===away.canonical)return json({status:"REJECTED",reason:"SELF_MATCH_AFTER_CANONICALIZATION"},422);

  const accepted:any[]=[];
  for(const src of unique){
    const label=`PCN2|${src.source}|${src.providerId}|${compactKickoff(src.kickoffIso||kickoffIso)}`;
    const{data,error}=await db.rpc("cfi_upsert_fixture",{p_match_date:matchDate,p_home_team:home.canonical,p_away_team:away.canonical,p_ht_home:src.hh,p_ht_away:src.ha,p_ft_home:src.fh,p_ft_away:src.fa,p_source_type:"PC_NODE_RESULT",p_source_label:label,p_image_hash:null});
    if(error)return json({status:"ERROR",reason:"UPSERT_ERROR",message:error.message,accepted},500);
    const st=String(data?.status??"");
    if(st==="CONFLICT")return json({status:"CONFLICT",reason:"CANONICAL_UPSERT_CONFLICT",upsert:data,accepted},409);
    if(!["NEW","DUPLICATE_COMPATIBLE","COMPLEMENTARY"].includes(st))return json({status:"REJECTED",reason:"UPSERT_NOT_ACCEPTED",upsert:data,accepted},422);
    accepted.push({source:src.source,providerId:src.providerId,status:st,label});
  }
  return json({status:"ACCEPTED",service:"CFI_PC_NODE_INGEST_R3_FINAL_COMBAT_AISCORE",nodeId:String(body?.node_id??"UNKNOWN"),mode:"RESULT_CONSENSUS",fixture:{matchDate,home:home.canonical,away:away.canonical,kickoffIso:kickoffIso||null,ht:[unique[0].hh,unique[0].ha],ft:[unique[0].fh,unique[0].fa]},identity:{home:home.status,away:away.status},sourceCount:unique.length,proofPair:proofPair.map((x:any)=>x.source),sources:accepted});
});
