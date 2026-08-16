import base from './index-v45';
import { buildPrediction, FINAL_VERSION } from '../../src/prediction/final-engine.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};
type Pair={home:number;away:number};
type Fixture={matchDate?:string;homeTeam?:string;awayTeam?:string;ht?:Pair|null;ft?:Pair|null};

function unwrap(x:any){return x?.body??x}
function num(x:any){const n=Number(x);return Number.isFinite(n)?n:null}
function pair(v:any):Pair|null{
 if(!v)return null;
 if(Array.isArray(v)&&v.length>=2){const h=num(v[0]),a=num(v[1]);return h!==null&&a!==null?{home:h,away:a}:null}
 if(typeof v==='object'){const h=num(v.home??v.h??v.homeGoals),a=num(v.away??v.a??v.awayGoals);return h!==null&&a!==null?{home:h,away:a}:null}
 if(typeof v==='string'){const m=v.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);if(m)return{home:+m[1],away:+m[2]}}
 return null;
}
function normalize(r:any):Fixture{
 const src=r?.fixture??r?.match??r;
 const ht=pair(src.ht??src.htScore??src.ht_score??src.halfTime??src.half_time??src.halftimeScore)
   ??(()=>{const h=num(src.ht_home??src.hthg??src.home_ht),a=num(src.ht_away??src.htag??src.away_ht);return h!==null&&a!==null?{home:h,away:a}:null})();
 const ft=pair(src.ft??src.ftScore??src.ft_score??src.fullTime??src.full_time??src.fulltimeScore)
   ??(()=>{const h=num(src.ft_home??src.fthg??src.home_ft),a=num(src.ft_away??src.ftag??src.away_ft);return h!==null&&a!==null?{home:h,away:a}:null})();
 return{matchDate:String(src.matchDate??src.match_date??src.date??''),homeTeam:String(src.homeTeam??src.home_team??src.home_name??''),awayTeam:String(src.awayTeam??src.away_team??src.away_name??''),ht,ft};
}
function rows(x:any):Fixture[]{const y=unwrap(x);for(const v of [y?.fixtures,y?.history,y?.rows,y?.data,y?.result?.fixtures,y?.result?.history])if(Array.isArray(v))return v.map(normalize);return []}
function prior(fs:Fixture[],date?:string){return fs.filter(f=>!date||!f.matchDate||f.matchDate<date)}
function pct(n:number,d:number){return d?Math.round(n/d*1000)/10:0}
function hit3(f:Fixture){return !!f.ht&&f.ht.home+f.ht.away>=3}
function hit7(f:Fixture){return !!f.ft&&f.ft.home+f.ft.away>=7}
function otherHT(f:Fixture){return !!f.ht&&(f.ht.home>=4||f.ht.away>=4)}
function otherFT(f:Fixture){return !!f.ft&&(f.ft.home>=5||f.ft.away>=5)}
function avg(fs:Fixture[],part:'ht'|'ft'){const a=fs.map(f=>f[part]).filter((x):x is Pair=>!!x);if(!a.length)return{h:0,a:0,n:0};return{h:a.reduce((s,x)=>s+x.home,0)/a.length,a:a.reduce((s,x)=>s+x.away,0)/a.length,n:a.length}}
function fact(n:number){let x=1;for(let i=2;i<=n;i++)x*=i;return x}
function pois(k:number,l:number){return Math.exp(-l)*Math.pow(l,k)/fact(k)}
function grid(lh:number,la:number,max:number){const out:any[]=[];for(let h=0;h<=max;h++)for(let a=0;a<=max;a++)out.push({h,a,p:pois(h,lh)*pois(a,la)});return out}
function scores(lh:number,la:number,max=7){return grid(lh,la,max).map(x=>({score:`${x.h}-${x.a}`,probability:x.p})).sort((x,y)=>y.probability-x.probability).slice(0,3)}
function market(fs:Fixture[],fn:(f:Fixture)=>boolean,part:'ht'|'ft'){const eligible=fs.filter(f=>!!f[part]);const hits=eligible.filter(fn).length;return{hits,total:eligible.length,rate:pct(hits,eligible.length),smoothed:eligible.length?(hits+1)/(eligible.length+2):null}}
function modelB(g:any[],kind:'3HT'|'7FT'|'OHT'|'OFT'){let p=0;for(const x of g){if(kind==='3HT'&&x.h+x.a>=3)p+=x.p;if(kind==='7FT'&&x.h+x.a>=7)p+=x.p;if(kind==='OHT'&&(x.h>=4||x.a>=4))p+=x.p;if(kind==='OFT'&&(x.h>=5||x.a>=5))p+=x.p}return p}
function finalProb(a:number|null,b:number,n:number){if(a===null)return b;const wA=Math.min(.75,.45+n/200);return a*wA+b*(1-wA)}

async function internal(request:Request,env:Env,ctx:ExecutionContext,path:string){return base.fetch(new Request(new URL(path,request.url),{headers:{accept:'application/json'}}),env,ctx)}
async function json(r:Response){try{return await r.json()}catch{return null}}

async function fallback(request:Request,env:Env,ctx:ExecutionContext,input:any){
 const home=String(input?.home||'').trim(),away=String(input?.away||'').trim();const date=String(input?.target_date||input?.matchDate||'').slice(0,10)||undefined;
 if(!home||!away)return Response.json({status:'INVALID_REQUEST',error:'HOME_AWAY_REQUIRED'},{status:400});
 const [hr,ar,xr]=await Promise.all([internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(home)}`),internal(request,env,ctx,`/api/team-history?team=${encodeURIComponent(away)}`),internal(request,env,ctx,`/api/h2h?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`)]);
 const [homePayload,awayPayload,h2hPayload]=await Promise.all([json(hr),json(ar),json(xr)]);
 const prediction=buildPrediction({home,away,targetDate:date,language:String(input?.language||'vi'),homePayload,awayPayload,h2hPayload});
 return Response.json({...prediction,engine:FINAL_VERSION,note:'Native prediction computed from canonical Persistent DB evidence because upstream /predict returned NOT_FOUND.'});
}

export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){const u=new URL(request.url);
 if(u.pathname==='/health')return Response.json({status:'OK',service:'CFI Football Intelligence',version:FINAL_VERSION,webApp:true,gptAction:true});
 if(u.pathname==='/api/status'){const res=await base.fetch(request,env,ctx);let payload:any=null;try{payload=await res.clone().json()}catch{}return Response.json({...payload,runtime:{version:FINAL_VERSION,predictionPath:'native-persistent-fallback',databaseConfigured:!!env.CFI_DB_BASE_URL}})}
 if(u.pathname==='/api/predict'&&request.method==='POST'){const body=await request.text();const cloned=new Request(request.url,{method:'POST',headers:request.headers,body});const res=await base.fetch(cloned,env,ctx);let d:any=null;try{d=await res.clone().json()}catch{}const b=unwrap(d);if(res.status===404||d?.httpStatus===404||b?.error==='NOT_FOUND'||d?.body?.error==='NOT_FOUND'){let input:any={};try{input=JSON.parse(body)}catch{}return fallback(request,env,ctx,input)}return res}return base.fetch(request,env,ctx)}} satisfies ExportedHandler<Env>;
