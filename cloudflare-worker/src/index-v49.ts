import base from './index-v48.ts';
import { buildPrediction, FINAL_VERSION, MARKET_CODES, PRIMARY_TARGETS } from '../../src/prediction/final-engine.ts';

const RUNTIME_VERSION='CFI_SIX_TARGET_RUNTIME_V1.1';
const BIG_DB_RETRIEVAL_VERSION='CFI_BIG_DB_RETRIEVAL_V1';
type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

function unwrap(x:any){return x?.body??x}
async function readJson(res:Response){try{return await res.clone().json()}catch{return null}}
async function internal(request:Request,env:Env,ctx:ExecutionContext,path:string){
  return base.fetch(new Request(new URL(path,request.url),{method:'GET',headers:{accept:'application/json'}}),env,ctx);
}
function payloadBody(x:any){return unwrap(x)??x??{}}
function payloadFixtures(x:any){const b=payloadBody(x);return Array.isArray(b?.fixtures)?b.fixtures:[]}
function retrievalStatus(x:any){const b=payloadBody(x);return String(b?.status??x?.status??'UNKNOWN')}
async function evidence(request:Request,env:Env,ctx:ExecutionContext,home:string,away:string){
  const [hr,ar,xr]=await Promise.all([
    internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(home)}`),
    internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(away)}`),
    internal(request,env,ctx,`/api/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`),
  ]);
  return Promise.all([readJson(hr),readJson(ar),readJson(xr)]);
}

async function recordAudit(env:Env,input:any,prediction:any){
  const date=String(input?.target_date||input?.matchDate||prediction?.target?.date||'').slice(0,10);
  const home=String(input?.home||prediction?.target?.home||'').trim();
  const away=String(input?.away||prediction?.target?.away||'').trim();
  if(!date)return{status:'SKIPPED',reason:'TARGET_DATE_REQUIRED'};
  if(!env.CFI_DB_BASE_URL)return{status:'SKIPPED',reason:'DATABASE_NOT_CONFIGURED'};
  const auditUrl=env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/,'/cfi-prediction-audit');
  const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
  if(env.CFI_DB_KEY)headers['x-cfi-key']=env.CFI_DB_KEY;
  try{
    const res=await fetch(auditUrl,{method:'POST',headers,body:JSON.stringify({action:'SNAPSHOT',target_date:date,home,away,language:String(input?.language||prediction?.language||'vi'),source:'GPT_ACTION',prediction})});
    const text=await res.text();let body:any=text;try{body=JSON.parse(text)}catch{}
    return{status:res.ok?'RECORDED':'ERROR',httpStatus:res.status,body};
  }catch(e:any){return{status:'ERROR',message:String(e?.message||e)}}
}

function sixTargetMatrix(prediction:any){
  const threshold=Object.fromEntries(MARKET_CODES.map((market)=>{
    const row=prediction?.markets?.[market]??{};
    return[market,{methodA:row.methodA??null,methodB:row.methodB??null,final:row.final??null,confidence:row.confidence??null,hits:row.hits??null,eligible:row.eligible??null}];
  }));
  const ht=prediction?.scoreline?.ht??{};
  const ft=prediction?.scoreline?.ft??{};
  const scoreline={
    'Top-3 HT':{methodA:ht.methodA??null,methodB:ht.methodB??null,final:ht.final??null},
    'Top-3 FT':{methodA:ft.methodA??null,methodB:ft.methodB??null,final:ft.final??null},
  };
  const allThreshold=MARKET_CODES.every(m=>['methodA','methodB','final'].every(k=>Number.isFinite(Number((threshold as any)[m]?.[k]))));
  const validTop=(x:any)=>Array.isArray(x)&&x.length===3&&x.every((r:any)=>typeof r?.score==='string'&&Number.isFinite(Number(r?.probability)));
  const allScoreline=['Top-3 HT','Top-3 FT'].every(t=>['methodA','methodB','final'].every(k=>validTop((scoreline as any)[t]?.[k])));
  return{
    contract:'CFI_2_METHODS_X_6_TARGETS_V1',
    primaryTargets:[...PRIMARY_TARGETS],
    methods:['Method A','Method B','FINAL'],
    threshold,
    scoreline,
    verification:{thresholdComplete:allThreshold,scorelineComplete:allScoreline,complete:allThreshold&&allScoreline},
  };
}

function renderedReport(prediction:any,matrix:any){
  const pct=(v:any)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(1)}%`:'—';
  const list=(rows:any)=>Array.isArray(rows)?rows.map((r:any,i:number)=>`${i+1}) ${r.score} ${pct(r.probability)}`).join(' · '):'—';
  const t=matrix.threshold;
  const s=matrix.scoreline;
  const lines=[
    `CFI 2 METHODS × 6 TARGETS — ${matrix.contract}`,
    `MATCH: ${prediction?.target?.home??'—'} vs ${prediction?.target?.away??'—'} | ${prediction?.target?.date??'—'} | ENGINE ${prediction?.engine??FINAL_VERSION}`,
    '',
    'THRESHOLD TARGETS — METHOD A | METHOD B | FINAL',
    ...MARKET_CODES.map(m=>`${m}: A ${pct(t[m]?.methodA)} | B ${pct(t[m]?.methodB)} | FINAL ${pct(t[m]?.final)} | ${t[m]?.confidence??'—'}`),
    '',
    'TOP-3 HT — PRIMARY TARGET',
    `Method A: ${list(s['Top-3 HT']?.methodA)}`,
    `Method B: ${list(s['Top-3 HT']?.methodB)}`,
    `FINAL: ${list(s['Top-3 HT']?.final)}`,
    '',
    'TOP-3 FT — PRIMARY TARGET',
    `Method A: ${list(s['Top-3 FT']?.methodA)}`,
    `Method B: ${list(s['Top-3 FT']?.methodB)}`,
    `FINAL: ${list(s['Top-3 FT']?.final)}`,
    '',
    `VERDICT: ${prediction?.verdict??'—'} | UNCERTAINTY: ${prediction?.scoreline?.uncertainty??'—'}`,
    `CONTRACT COMPLETE: ${matrix.verification.complete?'YES':'NO'}`,
  ];
  return lines.join('\n');
}

const PRIVACY_HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CFI Football Intelligence — Privacy Policy</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;line-height:1.65;color:#18202a}h1,h2{line-height:1.25}h1{margin-bottom:4px}.muted{color:#667085}</style></head><body><h1>CFI Football Intelligence — Privacy Policy</h1><p class="muted"><strong>Last Updated:</strong> August 20, 2026</p><p>CFI Football Intelligence ("CFI", "we", "our", or "the Service") provides football data analysis, prediction, historical analysis, and related football intelligence services.</p><h2>1. Information Processed</h2><p>CFI may process football team names, match and competition information, target dates, historical football statistics, user-submitted football screenshots or extracted match information, prediction requests, and technical request/response information necessary to operate the Service.</p><p>CFI does not require sensitive personal information to perform football predictions. Users should not submit passwords, authentication credentials, financial account information, government identification numbers, or other unnecessary sensitive personal information.</p><h2>2. How Information Is Used</h2><p>Information may be used to identify football matches and teams, retrieve historical football evidence, generate strict-prior predictions, store immutable pre-match prediction snapshots, compare predictions with verified results, perform settlement, calibration, auditing, debugging, and improve model reliability and service performance.</p><h2>3. Prediction History</h2><p>CFI may retain football prediction snapshots and related audit data, including teams, target dates, probabilities, exact-score predictions, engine/version information, timestamps, identifiers, hashes, settlement status, verified outcomes, and evaluation metrics. These records help preserve the integrity of pre-match predictions and prevent reconstruction after actual results are known.</p><h2>4. User-Provided Screenshots</h2><p>Users may submit screenshots containing football match information. CFI may analyze visible football information when necessary to perform the requested analysis. Users should avoid submitting unnecessary personal or sensitive information.</p><h2>5. Third-Party Services</h2><p>CFI may rely on third-party hosting, database, AI, and infrastructure providers. When CFI is accessed through ChatGPT, information processed by ChatGPT is also subject to OpenAI's applicable terms and privacy policies. Third-party services operate under their own terms and privacy policies.</p><h2>6. Data Sharing</h2><p>CFI does not sell users' personal information. Information may be processed by infrastructure or service providers when technically necessary to operate CFI, or disclosed when required by applicable law, regulation, legal process, or valid governmental request.</p><h2>7. Security</h2><p>CFI uses reasonable technical and organizational measures intended to protect its systems and stored information. No Internet-based service or electronic storage system can guarantee absolute security.</p><h2>8. Data Retention</h2><p>Football prediction and technical records may be retained for historical analysis, settlement, auditing, calibration, model evaluation, security, debugging, reliability, and integrity verification as reasonably necessary.</p><h2>9. Football Predictions and Betting</h2><p>CFI provides probabilistic football analysis. A prediction probability is not a guarantee that an event will occur. CFI does not guarantee betting outcomes, profits, or financial returns. Users remain responsible for their own decisions and for complying with applicable laws and age restrictions in their jurisdiction.</p><h2>10. Children</h2><p>CFI is not intended to knowingly collect unnecessary personal information from children. Users must comply with the age requirements of the platform through which they access CFI and applicable local laws.</p><h2>11. Changes</h2><p>This Privacy Policy may be updated as CFI develops or its services, infrastructure, or legal requirements change. The latest published version will show its most recent update date.</p><h2>12. Contact</h2><p>Questions or requests concerning this Privacy Policy may be directed to the CFI Football Intelligence operator through the contact method published with the CFI service.</p><p class="muted">CFI Football Intelligence · Privacy Policy Version 1.0</p></body></html>`;

const UI=`<section id="sixTargetPanel" style="display:none;margin:14px 0;background:#101c2e;border:1px solid #624c8d;border-radius:12px;padding:14px;color:#eef5ff"><div style="font-weight:900;color:#c5a6ff;margin-bottom:4px">🧠 CFI — 2 METHODS × 6 TARGETS</div><div style="font-size:12px;color:#9aabc0;margin-bottom:12px">Method A · Method B Future Six · FINAL</div><div id="sixThreshold" style="display:grid;gap:6px"></div><div style="font-weight:800;margin:14px 0 8px">TOP-3 HT / FT — A · B · FINAL</div><div id="sixScoreline" style="display:grid;gap:8px"></div></section>`;
const SCRIPT=`<script>(()=>{const nativeFetch=window.fetch.bind(window);const pct=v=>Number.isFinite(Number(v))?(Number(v)*100).toFixed(1)+'%':'—';const scores=x=>Array.isArray(x)?x.map(r=>r.score+' '+pct(r.probability)).join(' · '):'—';function render(d){const m=d?.sixTargetMatrix;if(!m)return;sixTargetPanel.style.display='block';sixThreshold.innerHTML=Object.entries(m.threshold||{}).map(([k,v])=>'<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;background:#0b1627;padding:8px;border-radius:8px"><b>'+k+'</b><span>A '+pct(v.methodA)+'</span><span style="color:#c5a6ff">B '+pct(v.methodB)+'</span><span>FINAL '+pct(v.final)+'</span></div>').join('');sixScoreline.innerHTML=Object.entries(m.scoreline||{}).map(([k,v])=>'<div style="background:#0b1627;padding:9px;border-radius:8px"><b>'+k+'</b><div>A: '+scores(v.methodA)+'</div><div style="color:#c5a6ff">B: '+scores(v.methodB)+'</div><div>FINAL: '+scores(v.final)+'</div></div>').join('')}window.fetch=async(...args)=>{const res=await nativeFetch(...args);try{const u=typeof args[0]==='string'?args[0]:args[0]?.url||'';if(String(u).includes('/api/predict'))res.clone().json().then(render).catch(()=>{})}catch{}return res}})();</script>`;

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/privacy'&&request.method==='GET')return new Response(PRIVACY_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}});
  if(url.pathname==='/api/predict'&&request.method==='POST'){
    let input:any={};try{input=await request.clone().json()}catch{}
    const home=String(input?.home||'').trim();
    const away=String(input?.away||'').trim();
    const targetDate=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
    if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
    try{
      // BIG DB retrieval is mandatory for every GPT production prediction.
      // Screenshot/import evidence can enrich Persistent DB, but never replaces this lookup.
      const [homePayload,awayPayload,h2hPayload]=await evidence(request,env,ctx,home,away);
      if(!homePayload||!awayPayload||!h2hPayload){
        return Response.json({status:'BIG_DB_RETRIEVAL_ERROR',error:'PERSISTENT_DB_EVIDENCE_UNAVAILABLE',retrieval:{version:BIG_DB_RETRIEVAL_VERSION,required:true,home,away}},{status:503});
      }
      const homeFixtures=payloadFixtures(homePayload);
      const awayFixtures=payloadFixtures(awayPayload);
      const h2hFixtures=payloadFixtures(h2hPayload);
      const retrieval={
        version:BIG_DB_RETRIEVAL_VERSION,
        required:true,
        mode:'EXACT_TEAM_HISTORY_PLUS_H2H',
        source:'PERSISTENT_DB',
        screenshotRole:'IDENTITY_CURRENT_CONTEXT_AND_DB_ENRICHMENT',
        targetDate:targetDate??null,
        home:{team:home,status:retrievalStatus(homePayload),fixtureCount:homeFixtures.length},
        away:{team:away,status:retrievalStatus(awayPayload),fixtureCount:awayFixtures.length},
        h2h:{status:retrievalStatus(h2hPayload),fixtureCount:h2hFixtures.length},
        note:'Prediction always retrieves Persistent DB history after HOME/AWAY identity is known. Strict-prior filtering is applied by the prediction engine against targetDate.'
      };
      const prediction=buildPrediction({home,away,targetDate,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload});
      const matrix=sixTargetMatrix(prediction);
      if(!matrix.verification.complete){
        return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION},status:'RUNTIME_CONTRACT_ERROR',error:'INCOMPLETE_2_METHODS_X_6_TARGETS'},{status:500});
      }
      const report=renderedReport(prediction,matrix);
      const audit=await recordAudit(env,input,{...prediction,bigDbRetrieval:retrieval});
      return Response.json({...prediction,bigDbRetrieval:retrieval,sixTargetMatrix:matrix,renderedReport:report,presentationContract:{mode:'RENDER_RENDERED_REPORT_VERBATIM',source:'renderedReport',contract:matrix.contract},runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR',primaryTargets:6,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION},audit});
    }catch(e:any){
      return Response.json({status:'ERROR',error:'PREDICTION_RUNTIME_FAILURE',message:String(e?.message||e),runtime:{version:RUNTIME_VERSION,engine:FINAL_VERSION,bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:500});
    }
  }
  if(url.pathname==='/api/status'&&request.method==='GET'){
    const res=await base.fetch(request,env,ctx);const body=await readJson(res);
    return Response.json({...unwrap(body),runtime:{...(unwrap(body)?.runtime??{}),version:RUNTIME_VERSION,engine:FINAL_VERSION,predictionPath:'NATIVE_V5_2_STRICT_PRIOR',primaryTargets:6,sixTargetContract:'CFI_2_METHODS_X_6_TARGETS_V1',bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION}},{status:res.status});
  }
  if(url.pathname==='/health'){
    const res=await base.fetch(request,env,ctx);const body=await readJson(res);
    return Response.json({...body,status:'OK',service:'CFI Football Intelligence',version:FINAL_VERSION,runtimeVersion:RUNTIME_VERSION,primaryTargets:6,sixTargetContract:'CFI_2_METHODS_X_6_TARGETS_V1',bigDbRetrieval:BIG_DB_RETRIEVAL_VERSION});
  }
  const res=await base.fetch(request,env,ctx);
  if(url.pathname!=='/'||!String(res.headers.get('content-type')).includes('text/html'))return res;
  let html=await res.text();html=html.replace('</body>',UI+SCRIPT+'</body>');return new Response(html,{status:res.status,headers:res.headers});
}} satisfies ExportedHandler<Env>;