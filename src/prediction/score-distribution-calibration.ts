export type DistributionRow={score:string;probability:number;total:number};
export type DistributionConstraint={name:string;target:number;matches:(row:DistributionRow)=>boolean};

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));

export function distributionIntegral(grid:DistributionRow[],matches:(row:DistributionRow)=>boolean){
  return grid.filter(matches).reduce((sum,row)=>sum+row.probability,0);
}

function normalize(grid:DistributionRow[]){
  const z=grid.reduce((sum,row)=>sum+row.probability,0);
  if(!(z>0))throw new Error('INVALID_SCORE_DISTRIBUTION_MASS');
  return grid.map(row=>({...row,probability:row.probability/z}));
}

/**
 * Adjust one event margin while preserving relative probability within the
 * event and its complement. This is the binary iterative-proportional-fitting
 * step used to calibrate a complete score distribution without breaking the
 * invariant that market probabilities are integrals of that distribution.
 */
function fitMargin(grid:DistributionRow[],constraint:DistributionConstraint){
  const target=clamp(constraint.target);
  const current=distributionIntegral(grid,constraint.matches);
  const eps=1e-15;
  if(Math.abs(current-target)<=eps)return grid;
  if(current<=eps||current>=1-eps){
    throw new Error(`UNFITTABLE_SCORE_DISTRIBUTION_MARGIN:${constraint.name}`);
  }
  const eventFactor=target/current;
  const complementFactor=(1-target)/(1-current);
  return normalize(grid.map(row=>({...row,probability:row.probability*(constraint.matches(row)?eventFactor:complementFactor)})));
}

export function calibrateScoreDistribution(grid:DistributionRow[],constraints:DistributionConstraint[],options:{iterations?:number;tolerance?:number}={}){
  let calibrated=normalize(grid);
  const iterations=Math.max(1,Math.floor(options.iterations??80));
  const tolerance=Math.max(1e-12,options.tolerance??1e-10);
  let maxError=Infinity;
  let used=0;
  for(let i=0;i<iterations;i++){
    for(const constraint of constraints)calibrated=fitMargin(calibrated,constraint);
    maxError=constraints.reduce((m,c)=>Math.max(m,Math.abs(distributionIntegral(calibrated,c.matches)-clamp(c.target))),0);
    used=i+1;
    if(maxError<=tolerance)break;
  }
  return {grid:calibrated,audit:{version:'CFI_SCORE_DISTRIBUTION_CALIBRATION_V2',iterations:used,tolerance,maxError,converged:maxError<=tolerance,constraints:constraints.map(c=>({name:c.name,target:clamp(c.target),actual:distributionIntegral(calibrated,c.matches)}))}};
}
