import base from './index-v42';

const SCORELINE_UI = `<div class="card" id="scoreline-card" style="margin-top:14px"><div class="title">SCORELINE INTELLIGENCE — TỶ SỐ DỰ KIẾN</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><b>HT — Top 3</b><div class="small" id="scoreHT">Chờ dữ liệu</div></div><div><b>FT — Top 3</b><div class="small" id="scoreFT">Chờ dữ liệu</div></div></div><div class="small" id="scorePath" style="margin-top:10px">Most likely path: —</div><div class="small" id="scoreSpread">Scoreline Spread: —</div><div class="small" id="scoreConsistency">Cross-check 4 markets: —</div></div>`;

const SCORELINE_SCRIPT = `<script>
(function(){
 const oldFetch=window.fetch.bind(window);
 window.fetch=async function(input,init){
   const r=await oldFetch(input,init);
   try{
     const u=typeof input==='string'?input:input.url;
     if(u&&u.includes('/api/predict')){
       const c=r.clone(); const d=await c.json(); const x=d.body||d; const s=x.scoreline||x.scorelineForecast||x.result?.scoreline;
       if(s){
         const fmt=(arr)=>Array.isArray(arr)?arr.slice(0,3).map(v=>{const p=typeof v.probability==='number'?(v.probability<=1?v.probability*100:v.probability):0;return '<b>'+v.score+'</b> '+p.toFixed(1)+'%'}).join(' · '):'—';
         document.getElementById('scoreHT').innerHTML=fmt(s.ht);
         document.getElementById('scoreFT').innerHTML=fmt(s.ft);
         document.getElementById('scorePath').textContent='Most likely path: '+(s.mostLikelyPath||'—');
         const un=s.spread?.uncertainty||s.uncertainty||'—';
         document.getElementById('scoreSpread').textContent='Scoreline Spread / Uncertainty: '+un;
         const w=s.consistencyWarnings||[];
         document.getElementById('scoreConsistency').textContent=w.length?'Cross-check: '+w.join(', '):'Cross-check 4 markets: CONSISTENT';
       }
     }
   }catch(e){}
   return r;
 };
})();
</script>`;

export default {
  async fetch(request:Request, env:any, ctx:ExecutionContext){
    const url=new URL(request.url);
    const res=await base.fetch(request,env,ctx);
    if(url.pathname!=='/'||!String(res.headers.get('content-type')).includes('text/html')) return res;
    let html=await res.text();
    html=html.replaceAll('CFI v4.2','CFI v4.3');
    html=html.replace('<div class="card analysis"', SCORELINE_UI+'<div class="card analysis"');
    html=html.replace('</body>',SCORELINE_SCRIPT+'</body>');
    return new Response(html,{status:res.status,headers:res.headers});
  }
} satisfies ExportedHandler<any>;
