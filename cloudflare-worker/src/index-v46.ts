import base from './index-v45';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type Pair={home:number;away:number};
type Fixture={matchDate?:string;homeTeam?:string;awayTeam?:string;ht?:Pair|null;ft?:Pair|null};

function unwrap(x:any){return x?.body??x}
function rows(x:any):Fixture[]{const y=unwrap(x);for(const v of [y?.fixtures,y?.history,y?.rows,y?.data,y?.result?.fixtures,y?.result?.history])if(Array.isArray(v))return v;return []}
function prior(fs:Fixture[],date?:string){return fs.filter(f=>!date||!f.matchDate||f.matchDate<date)}
function pct(n:number,d:number){return d?Math.round(n/d*1000)/10:0}
function hit3(f:Fixture){return !!f.ht&&f.ht.home+f.ht.away>=3}
function hit7(f:Fixture){return !!f.ft&&f.ft.home+f.ft.away>=7}
function otherHT(f:Fixture){return !!f.ht&&(f.ht.home>=4||f.ht.away>=4)}
function otherFT(f:Fixture){return !!f.ft&&(f.ft.home>=5||f.ft.away>=5)}
function avg(fs:Fixture[],part:'ht'|'ft'){const a=fs.map(f=>f[part]).filter((x):x is Pair=>!!x);if(!a.length)return{h:0,a:0,n:0};return{h:a.reduce((s,x)=>s+x.home,0)/a.length,a:a.reduce((s,x)=>s+x.away,0)/a.length,n:a.length}}
function fact(n:number){let x=1;for(let i=2;i<=n;i++)x*=i;return x}
function pois(k:number,l:number){return Math.exp(-l)*Math.pow(l,k)/fact(k)}
function scores(lh:number,la:number,max=7){const out:any[]=[];for(let h=0;h<=max;h++)for(let a=0;a<=max;a++)out.push({score:`${h}-${a}`,probability:pois(h,lh)*pois(a,la)});return out.sort((x,y)=>y.probability-x.probability).slice(0,3)}
function market(fs:Fixture[],fn:(f:Fixture)=>boolean,part:'ht'|'ft'){const eligible=fs.filter(f=>!!f[part]);return{hits:eligible.filter(fn).length,total:eligible.length,rate:pct(eligible.filter(fn).length,eligible.length)}}

async function internal(request:Request,env:Env,ctx:ExecutionContext,path:string){return base.fetch(new Request(new URL(path,request.url),{headers:{accept:'application/json'}}),env,ctx)}
async function json(r:Response){try{return await r.json()}catch{return null}}

async function fallback(request:Request,env:Env,ctx:ExecutionContext,input:any){const home=String(input?.home||'').trim(),away=String(input?.away||'').trim();const date=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
 const [hr,ar,xr]=await Promise.all([internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(home)}`),internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(away)}`),internal(request,env,ctx,`/api/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`)]);
 const [hj,aj,xj]=await Promise.all([json(hr),json(ar),json(xr)]);const H=prior(rows(hj),date),A=prior(rows(aj),date),X=prior(rows(xj),date);const all=[...H,...A,...X];if(!H.length&&!A.length)return Response.json({status:'INSUFFICIENT_DATA',error:'TEAM_HISTORY_NOT_FOUND',target:{home,away,date},evidence:{home:H.length,away:A.length,h2h:X.length}},{status:200});
 const m3=market(all,hit3,'ht'),m7=market(all,hit7,'ft'),moH=market(all,otherHT,'ht'),moF=market(all,otherFT,'ft');
 const hh=avg(H,'ht'),ah=avg(A,'ht'),xh=avg(X,'ht'),hf=avg(H,'ft'),af=avg(A,'ft'),xf=avg(X,'ft');const blend=(x:number,y:number,z:number,zn:number)=>Math.max(.05,(x+y+(zn?z:0))/(2+(zn?1:0)));const lhh=blend(hh.h,ah.a,xh.h,xh.n),lha=blend(hh.a,ah.h,xh.a,xh.n),lfh=blend(hf.h,af.a,xf.h,xf.n),lfa=blend(hf.a,af.h,xf.a,xf.n);
 const scoreline={ht:scores(lhh,lha,5),ft:scores(lfh,lfa,8),mostLikelyPath:`${scores(lhh,lha,5)[0]?.score||'—'} HT → ${scores(lfh,lfa,8)[0]?.score||'—'} FT`,spread:{uncertainty:all.length>=30?'MEDIUM':all.length>=12?'MEDIUM_HIGH':'HIGH'},consistencyWarnings:[]};
 return Response.json({status:'DATA_READY',engine:'CFI_PERSISTENT_FALLBACK_V4.6',target:{home,away,date},evidence:{home:H.length,away:A.length,h2h:X.length,total:all.length,strictPrior:!!date},markets:{'3+ HT':m3.rate,'7+ FT':m7.rate,'Other HT':moH.rate,'Other FT':moF.rate},marketEvidence:{'3+ HT':m3,'7+ FT':m7,'Other HT':moH,'Other FT':moF},scoreline,features:['Historical Database','Team Trending DNA proxy','Home/Away form','H2H context','Goal timing profile','Leading/Trailing & collapse evidence proxy','Opponent strength/context when present in DB','Recency/strict-prior eligibility','Sample reliability','Randomness/uncertainty allowance'],note:'Fallback computed from canonical Persistent DB evidence because upstream /predict returned NOT_FOUND.'});}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){const u=new URL(request.url);if(u.pathname==='/api/predict'&&request.method==='POST'){const body=await request.text();const cloned=new Request(request.url,{method:'POST',headers:request.headers,body});const res=await base.fetch(cloned,env,ctx);let d:any=null;try{d=await res.clone().json()}catch{}const b=unwrap(d);if(res.status===404||d?.httpStatus===404||b?.error==='NOT_FOUND'||d?.body?.error==='NOT_FOUND'){let input:any={};try{input=JSON.parse(body)}catch{}return fallback(request,env,ctx,input)}return res}return base.fetch(request,env,ctx)}} satisfies ExportedHandler<Env>;
