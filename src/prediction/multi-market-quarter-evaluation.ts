export type QuarterState='FULL_WIN'|'HALF_WIN'|'PUSH'|'HALF_LOSS'|'FULL_LOSS';
export type QuarterDistribution={fullWin:number;halfWin:number;push:number;halfLoss:number;fullLoss:number};
const EPS=1e-12;
const probs=(p:QuarterDistribution)=>({FULL_WIN:p.fullWin,HALF_WIN:p.halfWin,PUSH:p.push,HALF_LOSS:p.halfLoss,FULL_LOSS:p.fullLoss} as Record<QuarterState,number>);
export function quarterStateFromDifference(diff:number,line:number):QuarterState{
 const q=Math.round(line*4)/4,a=q-.25,b=q+.25;
 const classify=(x:number)=>x>1e-9?1:x<-1e-9?-1:0;
 const x=classify(diff+a),y=classify(diff+b);
 if(x===1&&y===1)return'FULL_WIN'; if(x===-1&&y===-1)return'FULL_LOSS';
 if((x===1&&y===0)||(x===0&&y===1))return'HALF_WIN';
 if((x===-1&&y===0)||(x===0&&y===-1))return'HALF_LOSS';
 return'PUSH';
}
export function quarterMetrics(rows:Array<{p:QuarterDistribution;y:QuarterState}>){
 if(!rows.length)return{n:0,brier:null,logLoss:null};
 let bs=0,ll=0;
 for(const r of rows){const p=probs(r.p),z=Object.values(p).reduce((a,b)=>a+b,0);if(Math.abs(z-1)>1e-8)throw new Error('QUARTER_DISTRIBUTION_SUM');for(const k of Object.keys(p) as QuarterState[])bs+=(p[k]-(k===r.y?1:0))**2/5;ll+=-Math.log(Math.max(EPS,p[r.y]));}
 return{n:rows.length,brier:bs/rows.length,logLoss:ll/rows.length};
}
export const QUARTER_EVAL_CONTRACT={version:'CFI_QUARTER_LINE_EVAL_V1',states:['FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS'] as QuarterState[],decisionUse:false,status:'RESEARCH_ONLY'} as const;
