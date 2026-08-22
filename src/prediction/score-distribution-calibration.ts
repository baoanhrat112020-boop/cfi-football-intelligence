export type DistributionRow={score:string;probability:number;total:number};
export type DistributionConstraint={name:string;target:number;matches:(row:DistributionRow)=>boolean};

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const EPS=1e-14;

export function distributionIntegral(grid:DistributionRow[],matches:(row:DistributionRow)=>boolean){
  return grid.filter(matches).reduce((sum,row)=>sum+row.probability,0);
}

function normalize(grid:DistributionRow[]){
  const z=grid.reduce((sum,row)=>sum+row.probability,0);
  if(!(z>0))throw new Error('INVALID_SCORE_DISTRIBUTION_MASS');
  return grid.map(row=>({...row,probability:row.probability/z}));
}

function partitionMass(grid:DistributionRow[],a:DistributionConstraint,b:DistributionConstraint){
  const q=[0,0,0,0];
  for(const row of grid){const av=a.matches(row),bv=b.matches(row),i=av?(bv?3:2):(bv?1:0);q[i]+=row.probability;}
  return q;
}

function solveIntersection(base:number[],a:number,b:number){
  const lower=Math.max(0,a+b-1),upper=Math.min(a,b);
  const forced:number[]=[];
  if(base[3]<=EPS)forced.push(0);
  if(base[2]<=EPS)forced.push(a);
  if(base[1]<=EPS)forced.push(b);
  if(base[0]<=EPS)forced.push(a+b-1);
  if(forced.length){
    const x=forced[0];
    if(forced.some(v=>Math.abs(v-x)>1e-10)||x<lower-1e-10||x>upper+1e-10)throw new Error('INFEASIBLE_SCORE_DISTRIBUTION_CONSTRAINTS');
    return clamp(x,lower,upper);
  }
  if(upper-lower<=EPS)return lower;
  const baseLogOdds=Math.log(base[3])+Math.log(base[0])-Math.log(base[2])-Math.log(base[1]);
  let lo=lower,hi=upper;
  for(let i=0;i<90;i++){
    const x=(lo+hi)/2;
    const p11=Math.max(EPS,x),p10=Math.max(EPS,a-x),p01=Math.max(EPS,b-x),p00=Math.max(EPS,1-a-b+x);
    const logOdds=Math.log(p11)+Math.log(p00)-Math.log(p10)-Math.log(p01);
    if(logOdds<baseLogOdds)lo=x;else hi=x;
  }
  return (lo+hi)/2;
}

/** Exact two-margin calibration of a complete score grid. */
function fitTwoMargins(grid:DistributionRow[],a:DistributionConstraint,b:DistributionConstraint){
  const targetA=clamp(a.target),targetB=clamp(b.target),base=partitionMass(grid,a,b);
  const x=solveIntersection(base,targetA,targetB);
  const target=[1-targetA-targetB+x,targetB-x,targetA-x,x];
  const factors=base.map((q,i)=>q>EPS?target[i]/q:(Math.abs(target[i])<=1e-10?0:NaN));
  if(factors.some(v=>!Number.isFinite(v)||v<0))throw new Error('UNFITTABLE_SCORE_DISTRIBUTION_PARTITION');
  return normalize(grid.map(row=>{const av=a.matches(row),bv=b.matches(row),i=av?(bv?3:2):(bv?1:0);return{...row,probability:row.probability*factors[i]};}));
}

function fitMargin(grid:DistributionRow[],constraint:DistributionConstraint){
  const target=clamp(constraint.target),current=distributionIntegral(grid,constraint.matches);
  if(Math.abs(current-target)<=EPS)return grid;
  if(current<=EPS||current>=1-EPS)throw new Error(`UNFITTABLE_SCORE_DISTRIBUTION_MARGIN:${constraint.name}`);
  const eventFactor=target/current,complementFactor=(1-target)/(1-current);
  return normalize(grid.map(row=>({...row,probability:row.probability*(constraint.matches(row)?eventFactor:complementFactor)})));
}

export function calibrateScoreDistribution(grid:DistributionRow[],constraints:DistributionConstraint[],options:{iterations?:number;tolerance?:number}={}){
  let calibrated=normalize(grid);
  const tolerance=Math.max(1e-12,options.tolerance??1e-10);
  let used=0;
  if(constraints.length===2){calibrated=fitTwoMargins(calibrated,constraints[0],constraints[1]);used=1;}
  else {
    const iterations=Math.max(1,Math.floor(options.iterations??80));
    for(let i=0;i<iterations;i++){for(const constraint of constraints)calibrated=fitMargin(calibrated,constraint);used=i+1;const e=constraints.reduce((m,c)=>Math.max(m,Math.abs(distributionIntegral(calibrated,c.matches)-clamp(c.target))),0);if(e<=tolerance)break;}
  }
  const maxError=constraints.reduce((m,c)=>Math.max(m,Math.abs(distributionIntegral(calibrated,c.matches)-clamp(c.target))),0);
  return {grid:calibrated,audit:{version:'CFI_SCORE_DISTRIBUTION_CALIBRATION_V2',iterations:used,tolerance,maxError,converged:maxError<=tolerance,constraints:constraints.map(c=>({name:c.name,target:clamp(c.target),actual:distributionIntegral(calibrated,c.matches)}))}};
}
