export type Score = { home: number; away: number };
export type ForecastFixture = { id: string; matchDate: string; ht?: Score | null; ft?: Score | null };

export const FORECAST_TARGETS = ['3+ HT','7+ FT','Other HT','Other FT','Top-3 HT','Top-3 FT'] as const;
export type ForecastTarget = typeof FORECAST_TARGETS[number];
export type ModelName = 'BASE_RATE' | 'RECENCY_WEIGHTED' | 'POISSON_SCORE';

export type ModelMetric = {
  model: ModelName;
  target: ForecastTarget;
  samples: number;
  brier?: number;
  top3Accuracy?: number;
};

export type TournamentResult = {
  version: 'CFI_FORECAST_TOURNAMENT_V1';
  walkForward: true;
  minHistory: number;
  metrics: ModelMetric[];
  winners: Partial<Record<ForecastTarget, ModelMetric>>;
};

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const fact=(n:number)=>{let v=1;for(let i=2;i<=n;i++)v*=i;return v};
const pois=(k:number,l:number)=>Math.exp(-l)*Math.pow(l,k)/fact(k);

function binaryTruth(f:ForecastFixture,t:ForecastTarget){
  if(t==='3+ HT') return f.ht ? Number(f.ht.home+f.ht.away>=3) : null;
  if(t==='7+ FT') return f.ft ? Number(f.ft.home+f.ft.away>=7) : null;
  if(t==='Other HT') return f.ht ? Number(f.ht.home>=4 || f.ht.away>=4) : null;
  if(t==='Other FT') return f.ft ? Number(f.ft.home>=5 || f.ft.away>=5) : null;
  return null;
}

function historicalProb(rows:ForecastFixture[],t:ForecastTarget,recency=false){
  const ys=rows.map((r,i)=>({y:binaryTruth(r,t),w:recency?Math.pow(0.97,rows.length-1-i):1})).filter(x=>x.y!==null) as Array<{y:number,w:number}>;
  if(!ys.length) return 0.5;
  const sw=ys.reduce((s,x)=>s+x.w,0);
  return clamp(ys.reduce((s,x)=>s+x.y*x.w,0)/sw);
}

function avgScore(rows:ForecastFixture[],part:'ht'|'ft',recency=false){
  const xs=rows.map((r,i)=>({s:r[part],w:recency?Math.pow(0.97,rows.length-1-i):1})).filter(x=>x.s) as Array<{s:Score,w:number}>;
  if(!xs.length) return {home:1,away:1};
  const sw=xs.reduce((s,x)=>s+x.w,0);
  return {home:xs.reduce((s,x)=>s+x.s.home*x.w,0)/sw,away:xs.reduce((s,x)=>s+x.s.away*x.w,0)/sw};
}

function scoreGrid(rows:ForecastFixture[],part:'ht'|'ft'){
  const l=avgScore(rows,part,true); const out:Array<{score:string,p:number}>=[];
  const max=part==='ht'?6:9;
  for(let h=0;h<=max;h++)for(let a=0;a<=max;a++)out.push({score:`${h}-${a}`,p:pois(h,l.home)*pois(a,l.away)});
  return out.sort((a,b)=>b.p-a.p);
}

function poissonBinary(rows:ForecastFixture[],t:ForecastTarget){
  const part=t==='3+ HT'||t==='Other HT'?'ht':'ft'; const grid=scoreGrid(rows,part);
  return clamp(grid.reduce((s,x)=>{const [h,a]=x.score.split('-').map(Number); let hit=false;
    if(t==='3+ HT')hit=h+a>=3; else if(t==='7+ FT')hit=h+a>=7; else if(t==='Other HT')hit=h>=4||a>=4; else if(t==='Other FT')hit=h>=5||a>=5;
    return s+(hit?x.p:0)},0));
}

function top3(rows:ForecastFixture[],part:'ht'|'ft',model:ModelName){
  if(model==='POISSON_SCORE') return scoreGrid(rows,part).slice(0,3).map(x=>x.score);
  const counts=new Map<string,number>();
  rows.forEach((r,i)=>{const s=r[part];if(!s)return;const key=`${s.home}-${s.away}`;const w=model==='RECENCY_WEIGHTED'?Math.pow(0.97,rows.length-1-i):1;counts.set(key,(counts.get(key)||0)+w)});
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
}

export function runForecastingTournament(fixtures:ForecastFixture[],minHistory=40):TournamentResult{
  const rows=[...fixtures].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
  const models:ModelName[]=['BASE_RATE','RECENCY_WEIGHTED','POISSON_SCORE'];
  const binary:ForecastTarget[]=['3+ HT','7+ FT','Other HT','Other FT'];
  const acc=new Map<string,{n:number,sum:number}>();

  for(let i=minHistory;i<rows.length;i++){
    const hist=rows.slice(0,i); const cur=rows[i];
    for(const model of models){
      for(const t of binary){const y=binaryTruth(cur,t);if(y===null)continue;const p=model==='BASE_RATE'?historicalProb(hist,t,false):model==='RECENCY_WEIGHTED'?historicalProb(hist,t,true):poissonBinary(hist,t);const k=`${model}|${t}`;const a=acc.get(k)||{n:0,sum:0};a.n++;a.sum+=(p-y)**2;acc.set(k,a)}
      for(const [target,part] of [['Top-3 HT','ht'],['Top-3 FT','ft']] as const){const actual=cur[part];if(!actual)continue;const preds=top3(hist,part,model);const k=`${model}|${target}`;const a=acc.get(k)||{n:0,sum:0};a.n++;a.sum+=preds.includes(`${actual.home}-${actual.away}`)?1:0;acc.set(k,a)}
    }
  }

  const metrics:ModelMetric[]=[];
  for(const model of models)for(const target of FORECAST_TARGETS){const a=acc.get(`${model}|${target}`)||{n:0,sum:0};metrics.push(target.startsWith('Top-3')?{model,target,samples:a.n,top3Accuracy:a.n?a.sum/a.n:0}:{model,target,samples:a.n,brier:a.n?a.sum/a.n:1})}
  const winners:Partial<Record<ForecastTarget,ModelMetric>>={};
  for(const target of FORECAST_TARGETS){const ms=metrics.filter(m=>m.target===target&&m.samples>0);if(!ms.length)continue;winners[target]=target.startsWith('Top-3')?ms.sort((a,b)=>(b.top3Accuracy??0)-(a.top3Accuracy??0))[0]:ms.sort((a,b)=>(a.brier??1)-(b.brier??1))[0]}
  return {version:'CFI_FORECAST_TOURNAMENT_V1',walkForward:true,minHistory,metrics,winners};
}
