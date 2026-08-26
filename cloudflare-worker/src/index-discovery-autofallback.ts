import base from './index-p0-router.ts';
import { normalizeAiFixtureCandidates, localDateNow } from '../../src/discovery/cfi-discovery.ts';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

async function withDiscoveryFallback(request:Request){
  const input:any=await request.clone().json().catch(()=>null);
  if(!input||typeof input!=='object')return request;
  const timezone=String(input.timezone??'Asia/Ho_Chi_Minh');
  const targetDate=String(input.target_date??localDateNow(timezone)).slice(0,10);
  const maxMatches=Math.max(1,Math.min(10,Number(input.max_matches??5)||5));
  const window={
    targetDate,
    timeZone:timezone,
    startTime:input.start_time??null,
    endTime:input.end_time??null,
    minimumRows:maxMatches,
  };
  const accepted=normalizeAiFixtureCandidates(Array.isArray(input.fixture_candidates)?input.fixture_candidates:[],window).rows.length;
  // Search-first remains primary. The internal provider catalog is only enabled when
  // the verified same-day GPT candidate pool is smaller than the requested pool.
  // This prevents a few bad/misdated web candidates from terminating Discovery.
  const shouldFallback=input.internal_provider_diagnostics===true||accepted<maxMatches;
  if(!shouldFallback)return request;
  const headers=new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type','application/json');
  return new Request(request.url,{method:request.method,headers,body:JSON.stringify({...input,target_date:targetDate,timezone,internal_provider_diagnostics:true})});
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(request.url);
    if(url.pathname==='/api/discover'&&request.method==='POST'){
      return base.fetch(await withDiscoveryFallback(request),env,ctx);
    }
    return base.fetch(request,env,ctx);
  }
} satisfies ExportedHandler<Env>;
